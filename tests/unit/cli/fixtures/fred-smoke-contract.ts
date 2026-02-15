import { mock } from 'bun:test';

type SessionSummary = {
  id: string;
  updatedAt: Date;
  title: string | null;
  messageCount: number;
  preview: string | null;
  agent: { id: string; name: string };
};

export type MockContextManager = {
  setStorage: ReturnType<typeof mock>;
  generateConversationId: () => string;
  listSessions: () => Promise<SessionSummary[]>;
  getContext: (id: string) => Promise<{ id: string }>;
  updateMetadata: (id: string, metadata: Record<string, unknown>) => Promise<void>;
  getSession: (id: string) => Promise<{ summary: SessionSummary; messages: Array<{ role: string; content: string; timestamp: Date }> } | null>;
  deleteSession: (id: string) => Promise<void>;
};

export function createMockContextManager(overrides: Partial<MockContextManager> = {}): MockContextManager {
  const setStorage = overrides.setStorage ?? mock(() => {});

  return {
    setStorage,
    generateConversationId: overrides.generateConversationId ?? (() => 'conv_smoke_test'),
    listSessions: overrides.listSessions ?? (async () => []),
    getContext: overrides.getContext ?? (async (id: string) => ({ id })),
    updateMetadata: overrides.updateMetadata ?? (async () => undefined),
    getSession: overrides.getSession ?? (async () => null),
    deleteSession: overrides.deleteSession ?? (async () => undefined),
  };
}

export class MockSqliteContextStorage {
  options: { path?: string };

  constructor(options: { path?: string } = {}) {
    this.options = options;
  }
}

type MockFredClassOptions = {
  contextManager?: MockContextManager;
  defaultStreamDelta?: string;
};

export function createMockFredClass(options: MockFredClassOptions = {}) {
  const contextManager = options.contextManager ?? createMockContextManager();
  const defaultStreamDelta = options.defaultStreamDelta ?? 'test';

  return class MockFred {
    private agents: any[] = [];
    private providers = new Map<string, any>();
    private defaultAgentId: string | null = null;

    async registerDefaultProviders() {
      this.providers.set('openai', { id: 'openai' });
      this.providers.set('anthropic', { id: 'anthropic' });
      this.providers.set('google', { id: 'google' });
      this.providers.set('groq', { id: 'groq' });
      this.providers.set('openrouter', { id: 'openrouter' });
    }

    async initializeFromConfig() {
      this.agents.push({ id: '__mock__', platform: 'openai', model: 'gpt-4o-mini' });
      this.providers.set('openai', { id: 'openai' });
    }

    async setToolPolicies() {}

    getAgents() {
      return this.agents;
    }

    getAgent(id: string) {
      return this.agents.find((agent) => agent.id === id);
    }

    getContextManager() {
      return contextManager;
    }

    getDefaultAgentId() {
      return this.defaultAgentId;
    }

    setDefaultAgent(agentId: string) {
      this.defaultAgentId = agentId;
    }

    useProvider(platform: string) {
      if (!this.providers.has(platform)) {
        this.providers.set(platform, { id: platform });
      }
      return Promise.resolve({ id: platform });
    }

    createAgent(config: any) {
      const agent = { ...config, id: config.id || '__test_agent__' };
      this.agents.push(agent);
      if (!this.defaultAgentId) {
        this.defaultAgentId = agent.id;
      }
      return Promise.resolve(agent);
    }

    streamMessage() {
      return {
        fullStream: (async function* () {
          yield { type: 'token', delta: defaultStreamDelta };
        })(),
      };
    }
  };
}

export function installFredSmokeContractMock(options: {
  FredClass?: ReturnType<typeof createMockFredClass>;
  registerBuiltinPack?: ReturnType<typeof mock>;
} = {}): void {
  const FredClass = options.FredClass ?? createMockFredClass();
  const registerBuiltinPack = options.registerBuiltinPack ?? mock(() => {});

  mock.module('@fancyrobot/fred', () => ({
    Fred: FredClass,
    SqliteContextStorage: MockSqliteContextStorage,
    registerBuiltinPack,
  }));
}
