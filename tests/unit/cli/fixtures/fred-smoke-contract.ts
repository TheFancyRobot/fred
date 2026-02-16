import { mock } from 'bun:test';
import type { ChatDependencies } from '../../../../packages/cli/src/commands/chat';

/**
 * Create a `ChatDependencies` object for smoke tests.
 *
 * This replaces `installFredSmokeContractMock` + `installCommonSmokeModuleMocks`
 * by injecting mocks through the DI interface rather than replacing global modules
 * with `mock.module()`.  Using DI avoids polluting the module registry for the
 * entire Bun test process, which previously caused 50+ unrelated test failures.
 */
export function createSmokeTestDeps(options: {
  FredClass?: ReturnType<typeof createMockFredClass>;
  createFredTuiApp?: (...args: any[]) => any;
} = {}): ChatDependencies {
  const FredClass = options.FredClass ?? createMockFredClass();
  const createFredTuiApp = options.createFredTuiApp ?? mock(async () => ({
    stop: mock(() => {}),
    isRunning: () => true,
    getState: () => ({}),
    updateTelemetryModel: mock(() => {}),
  }));

  return {
    createFred: () => new FredClass() as any,
    createStorage: (opts) => new MockSqliteContextStorage(opts),
    resolveProjectConfig: () => ({ success: false, diagnostics: [] }) as any,
    ensureDefaultChatAgent: async (fred: any) => {
      if (fred.getAgents().length === 0) {
        await fred.createAgent({
          id: '__tui_agent__',
          name: 'Chat',
          platform: 'openai',
          model: 'gpt-4o-mini',
        });
      }
      return {
        agentId: '__tui_agent__',
        model: 'gpt-4o-mini',
        provider: 'openai',
        created: fred.getAgents().length === 1,
      };
    },
    createFredTuiApp: createFredTuiApp as any,
  };
}

type SessionSummary = {
  id: string;
  updatedAt: Date;
  title: string | null;
  messageCount: number;
  preview: string | null;
  agent: { id: string; name: string };
};

// ---------------------------------------------------------------------------
// Process double helpers — concurrency-safe stdin/stdout/exit doubles
// ---------------------------------------------------------------------------

/**
 * Create a complete process.stdin double with all APIs that OpenTUI renderer
 * and the CLI runtime exercise (pause, resume, on, off, setRawMode, etc.).
 *
 * Partial doubles that omit `pause`/`resume` cause `TypeError: process.stdin.pause
 * is not a function` when OpenTUI's renderer tears down during concurrent tests.
 */
export function createStdinDouble(overrides: Record<string, unknown> = {}): any {
  const listeners = new Map<string, Function[]>();
  return {
    isTTY: false,
    isRaw: false,
    setRawMode: mock((mode: boolean) => { /* no-op for tests */ }),
    pause: mock(() => {}),
    resume: mock(() => {}),
    on: mock((event: string, fn: Function) => { listeners.set(event, [...(listeners.get(event) ?? []), fn]); }),
    off: mock((event: string, fn: Function) => {
      const fns = listeners.get(event) ?? [];
      listeners.set(event, fns.filter(f => f !== fn));
    }),
    once: mock((event: string, fn: Function) => { listeners.set(event, [...(listeners.get(event) ?? []), fn]); }),
    removeListener: mock((event: string, fn: Function) => {
      const fns = listeners.get(event) ?? [];
      listeners.set(event, fns.filter(f => f !== fn));
    }),
    removeAllListeners: mock((event?: string) => {
      if (event) listeners.delete(event); else listeners.clear();
    }),
    addListener: mock((event: string, fn: Function) => { listeners.set(event, [...(listeners.get(event) ?? []), fn]); }),
    emit: mock(() => false),
    destroyed: false,
    readable: true,
    ref: mock(() => {}),
    unref: mock(() => {}),
    ...overrides,
  };
}

/**
 * Create a complete process.stdout double with APIs exercised by OpenTUI renderer
 * and the CLI runtime (write, columns, rows, on, etc.).
 */
export function createStdoutDouble(overrides: Record<string, unknown> = {}): any {
  return {
    isTTY: false,
    columns: 120,
    rows: 40,
    write: mock(() => true),
    on: mock(() => {}),
    off: mock(() => {}),
    once: mock(() => {}),
    removeListener: mock(() => {}),
    removeAllListeners: mock(() => {}),
    addListener: mock(() => {}),
    emit: mock(() => false),
    destroyed: false,
    writable: true,
    ...overrides,
  };
}

/**
 * Deterministic global process state cleanup for use in afterEach.
 *
 * Restores process.stdin, process.stdout, and process.exit to their saved
 * originals. Call this AFTER mock.restore() / mock.clearAllMocks().
 */
export function restoreProcessDoubles(originals: {
  stdin: typeof process.stdin;
  stdout: typeof process.stdout;
  exit: typeof process.exit;
}): void {
  Object.defineProperty(process, 'stdin', {
    value: originals.stdin,
    configurable: true,
  });
  Object.defineProperty(process, 'stdout', {
    value: originals.stdout,
    configurable: true,
  });
  (process as any).exit = originals.exit;
}

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


