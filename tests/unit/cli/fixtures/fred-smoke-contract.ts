import { mock } from 'bun:test';
import { Context, Effect, Runtime, Stream } from 'effect';
import type * as Schema from 'effect/Schema';
import {
  createFred,
  type AgentConfig,
  type AgentInstance,
  type CreateFredOptions,
  type FredClient,
  type SessionDetails,
  type StreamEvent,
} from '@fancyrobot/fred';
import {
  ContextStorageService,
  MessageProcessorService,
  type ContextStorageService as ContextStorageServiceApi,
  type MessageProcessorService as MessageProcessorServiceApi,
} from '@fancyrobot/fred/effect';
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
  client?: MockFredClientOptions;
  createFredTuiApp?: (...args: any[]) => any;
  onCreate?: (options: CreateFredOptions | undefined) => void;
} = {}): ChatDependencies {
  const createFredTuiApp = options.createFredTuiApp ?? mock(async () => ({
    stop: mock(() => {}),
    isRunning: () => true,
    getState: () => ({}),
    updateTelemetryModel: mock(() => {}),
  }));

  return {
    createFred: async (createOptions) => {
      options.onCreate?.(createOptions);
      return createMockFredClient(options.client);
    },
    createStorage: (opts) => new MockSqliteContextStorage(opts),
    resolveProjectConfig: () => ({ success: false, diagnostics: [] }) as any,
    loadProjectRuntimeHook: async () => null,
    ensureDefaultChatAgent: async (fred) => {
      const existingAgents = await fred.agents.list();
      if (existingAgents.length === 0) {
        await fred.agents.register({
          id: '__tui_agent__',
          systemMessage: 'Chat',
          platform: 'openai',
          model: 'gpt-4o-mini',
        });
      }
      return {
        agentId: '__tui_agent__',
        model: 'gpt-4o-mini',
        provider: 'openai',
        created: existingAgents.length === 0,
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
  getContext: (id: string) => Promise<unknown>;
  updateMetadata: (id: string, metadata: Record<string, unknown>) => Promise<void>;
  getSession: (id: string) => Promise<SessionDetails | null>;
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

export type MockFredClientOptions = {
  contextManager?: MockContextManager;
  stream?: () => Stream.Stream<StreamEvent>;
};

const activeClients = new Set<FredClient>();

const makeMockAgent = <
  InputSchema extends Schema.Schema.AnyNoContext,
  OutputSchema extends Schema.Schema.AnyNoContext,
>(config: AgentConfig<InputSchema, OutputSchema>): AgentInstance<InputSchema, OutputSchema> => ({
  id: config.id,
  config,
  run: () => Effect.succeed({ content: '' }),
  processMessage: () => Effect.succeed({ content: '' }),
});

const defaultStream = (): Stream.Stream<StreamEvent> => Stream.fromIterable([
  {
    type: 'token',
    runId: 'run_smoke_test',
    threadId: 'conv_smoke_test',
    sequence: 1,
    emittedAt: 1,
    messageId: 'message_smoke_test',
    step: 0,
    delta: 'test',
    accumulated: 'test',
  },
]);

export async function createMockFredClient(options: MockFredClientOptions = {}): Promise<FredClient> {
  const contextManager = options.contextManager ?? createMockContextManager();
  const base = await createFred();
  const agents: AgentInstance[] = [];

  const contextService: ContextStorageServiceApi = {
    generateConversationId: () => Effect.sync(() => contextManager.generateConversationId()),
    getContext: (id) => Effect.promise(async () => {
      const conversationId = id ?? contextManager.generateConversationId();
      await contextManager.getContext(conversationId);
      const now = new Date();
      return { id: conversationId, messages: [], metadata: { createdAt: now, updatedAt: now } };
    }),
    getContextById: (id) => Effect.promise(async () => {
      await contextManager.getContext(id);
      const now = new Date();
      return { id, messages: [], metadata: { createdAt: now, updatedAt: now } };
    }),
    addMessage: () => Effect.void,
    addMessages: () => Effect.void,
    getHistory: () => Effect.succeed([]),
    updateMetadata: (id, metadata) => Effect.promise(() => contextManager.updateMetadata(id, metadata)),
    clearContext: (id) => Effect.promise(() => contextManager.deleteSession(id)),
    resetContext: (id) => Effect.promise(async () => {
      const existed = await contextManager.getSession(id) !== null;
      await contextManager.deleteSession(id);
      return existed;
    }),
    clearAll: () => Effect.void,
    setDefaultPolicy: () => Effect.void,
    setContextPolicy: () => Effect.void,
    replaceStorage: (storage) => Effect.sync(() => contextManager.setStorage(storage)),
    listSessions: () => Effect.promise(() => contextManager.listSessions()),
  };

  const messageProcessor: MessageProcessorServiceApi = {
    routeMessage: () => Effect.dieMessage('routeMessage is not used by this fixture'),
    processMessage: () => Effect.succeed({ content: 'test' }),
    processChatMessage: () => Effect.succeed({ content: 'test' }),
    streamMessage: () => options.stream?.() ?? defaultStream(),
    updateConfig: () => Effect.void,
    getConfig: () => Effect.succeed({ memoryDefaults: {} }),
  };

  const context = Context.add(
    Context.add(base.runtime.context, ContextStorageService, contextService),
    MessageProcessorService,
    messageProcessor,
  );
  const runtime = Runtime.make({
    context,
    runtimeFlags: base.runtime.runtimeFlags,
    fiberRefs: base.runtime.fiberRefs,
  });
  const run = Runtime.runPromise(runtime);

  const client: FredClient = {
    ...base,
    agents: {
      register: async (config) => {
        const agent = makeMockAgent(config);
        agents.push(agent);
        return agent;
      },
      remove: async (id) => {
        const index = agents.findIndex((agent) => agent.id === id);
        if (index < 0) return false;
        agents.splice(index, 1);
        return true;
      },
      get: async (id) => agents.find((agent) => agent.id === id) ?? null,
      list: async () => [...agents],
    },
    sessions: {
      ...base.sessions,
      get: (id) => contextManager.getSession(id),
      list: () => contextManager.listSessions(),
      delete: (id) => contextManager.deleteSession(id),
    },
    effects: { run },
    runtime,
    shutdown: async () => {
      activeClients.delete(client);
      await base.shutdown();
    },
  };

  activeClients.add(client);
  return client;
}

export async function shutdownMockFredClients(): Promise<void> {
  await Promise.all([...activeClients].map((client) => client.shutdown()));
}
