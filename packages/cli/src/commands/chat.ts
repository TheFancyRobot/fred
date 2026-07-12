/**
 * Chat command handler
 * Explicit interactive entrypoint for fred chat
 */

import { Effect, Stream } from 'effect';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFred, type CreateFredOptions, type FredClient } from '@fancyrobot/fred';
import type { SubagentExecutionSummary, SubagentInfo } from '@fancyrobot/fred';
import {
  AgentStatusService,
  ContextStorageService,
  MessageProcessorService,
  ToolGateService,
} from '@fancyrobot/fred/effect';
import { SqliteContextStorage } from '@fancyrobot/fred/context/sqlite';
import { smoothStream, createTextSmoother } from '@fancyrobot/fred/stream';
import {
  DEV_CHAT_PROVIDER_PACKAGES,
  detectAvailableProvider as detectAvailableProviderFromDev,
  loadProviderPackage as loadProviderPackageFromDev,
  ensureDefaultChatAgent,
} from '../chat-defaults.js';
import { detectTerminalMode } from '../runtime/tty-mode.js';
import { withTerminalLifecycle } from '../runtime/terminal-lifecycle.js';
import { createFredTuiApp, type PluginSlashCommandRuntime } from '../tui/app.js';
import { DEFAULT_PATIENCE_MESSAGES } from '../tui/patience.js';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { loadPluginsFromConfig } from '../plugin/manager.js';
import type { RegisteredPluginContributions } from '../plugin/registry.js';
import { sanitizeErrorForCli } from './error-sanitize.js';

/**
 * Injectable dependencies for the chat command.
 * Production code uses the defaults; tests can supply mocks
 * without polluting the global module registry.
 */
export interface ChatDependencies {
  /** Factory that creates a Fred instance. */
  createFred: (options?: CreateFredOptions) => FredClient | PromiseLike<FredClient>;
  /** Storage factory for fallback persistence. */
  createStorage: (opts: { path: string }) => unknown;
  /** Resolve project config. */
  resolveProjectConfig: typeof resolveProjectConfig;
  /** Load an optional project runtime hook. */
  loadProjectRuntimeHook: typeof loadProjectRuntimeHook;
  /** Ensure a default chat agent exists. */
  ensureDefaultChatAgent: typeof ensureDefaultChatAgent;
  /** Create the TUI app. */
  createFredTuiApp: typeof createFredTuiApp;
  /** Optional programmatic setup hook used by the deprecated dev-chat adapter. */
  projectSetupHook?: (fred: FredClient) => Promise<void> | void;
}

const DEFAULT_DEPS: ChatDependencies = {
  createFred,
  createStorage: (opts) => new SqliteContextStorage(opts),
  resolveProjectConfig,
  loadProjectRuntimeHook,
  ensureDefaultChatAgent,
  createFredTuiApp,
};

export type ProjectRuntimeHook = (
  fred: FredClient,
  context: { configPath: string; projectRoot: string }
) => Promise<void> | void;

export async function loadProjectRuntimeHook(configPath: string): Promise<ProjectRuntimeHook | null> {
  const projectRoot = dirname(configPath);
  const candidates = [
    join(projectRoot, 'fred.runtime.ts'),
    join(projectRoot, 'fred.runtime.js'),
    join(projectRoot, 'fred.runtime.mjs'),
  ];

  const hookPath = candidates.find((candidate) => existsSync(candidate));
  if (!hookPath) {
    return null;
  }

  const runtimeModule = await import(pathToFileURL(hookPath).href);
  const hook = runtimeModule.setupFredProject;
  return typeof hook === 'function' ? hook as ProjectRuntimeHook : null;
}

function formatSubagentList(subagents: SubagentInfo[]): string {
  if (subagents.length === 0) {
    return 'No active subagents.';
  }

  return [
    'Active subagents',
    '',
    ...subagents.map((subagent) => {
      const currentPid = subagent.currentExecution?.pid;
      const executionSuffix = currentPid ? ` pid=${currentPid}` : '';
      return `- ${subagent.id} (${subagent.name}) status=${subagent.status} executions=${subagent.executionCount}${executionSuffix}`;
    }),
  ].join('\n');
}

function formatExecutionBlock(
  label: string,
  execution: SubagentExecutionSummary | undefined,
): string[] {
  if (!execution) {
    return [`- ${label}: none`];
  }

  return [
    `- ${label}: started=${execution.startedAt}${execution.endedAt ? ` ended=${execution.endedAt}` : ''}`,
    `  args: ${execution.args.join(' ') || '(none)'}`,
    `  pid: ${execution.pid ?? 'n/a'} exit=${execution.exitCode ?? 'n/a'} signal=${execution.signal ?? 'none'} timedOut=${execution.timedOut === true ? 'yes' : 'no'}`,
    ...(execution.stdoutPreview ? [`  stdout: ${execution.stdoutPreview}`] : []),
    ...(execution.stderrPreview ? [`  stderr: ${execution.stderrPreview}`] : []),
  ];
}

function formatSubagentDetails(subagent: SubagentInfo): string {
  const commandLine = [subagent.command, ...subagent.args].join(' ').trim();
  return [
    `Subagent ${subagent.id}`,
    '',
    `- name: ${subagent.name}`,
    `- status: ${subagent.status}`,
    `- command: ${commandLine || subagent.command}`,
    `- cwd: ${subagent.cwd ?? '(inherit)'}`,
    `- env keys: ${subagent.envKeys.join(', ') || '(none)'}`,
    `- execution count: ${subagent.executionCount}`,
    `- metadata: ${JSON.stringify(subagent.metadata)}`,
    ...formatExecutionBlock('current', subagent.currentExecution),
    ...formatExecutionBlock('last', subagent.lastExecution),
  ].join('\n');
}

function parseSubagentIdArg(args: string, usage: string): string {
  const subagentId = args.trim();
  if (subagentId.length === 0) {
    throw new Error(`Missing subagent id. Usage: ${usage}`);
  }
  return subagentId;
}

export function buildBuiltinSlashCommands(fred: FredClient): PluginSlashCommandRuntime[] {
  return [
    {
      pluginId: 'fred',
      commandId: 'subagents',
      summary: 'List active subagents',
      usage: '/fred:subagents',
      available: true,
      execute: async () => formatSubagentList(await fred.subagents.list()),
    },
    {
      pluginId: 'fred',
      commandId: 'subagent-inspect',
      summary: 'Inspect one subagent',
      usage: '/fred:subagent-inspect <id>',
      available: true,
      execute: async (args) => {
        const subagentId = parseSubagentIdArg(args, '/fred:subagent-inspect <id>');
        const subagent = await fred.subagents.inspect(subagentId);
        if (!subagent) {
          return `Subagent not found: ${subagentId}`;
        }
        return formatSubagentDetails(subagent);
      },
    },
    {
      pluginId: 'fred',
      commandId: 'subagent-destroy',
      summary: 'Destroy one subagent',
      usage: '/fred:subagent-destroy <id>',
      available: true,
      execute: async (args) => {
        const subagentId = parseSubagentIdArg(args, '/fred:subagent-destroy <id>');
        const destroyed = await fred.subagents.destroy(subagentId);
        return destroyed
          ? `Destroyed subagent: ${subagentId}`
          : `Subagent not found or already destroyed: ${subagentId}`;
      },
    },
  ];
}

export interface NonInteractiveFallbackPayload {
  mode: 'non-interactive';
  reason: string;
  suggestion: string;
  help: string;
}

export interface AssistantSegmentRenderer {
  enqueueText: (text: string) => void;
  flushAll: () => void;
  clear: () => void;
  stop: () => void;
}

/**
 * Create an assistant segment renderer that delegates to the shared
 * {@link createTextSmoother} from `@fancyrobot/fred/stream`.
 *
 * This is a thin CLI adapter that preserves the existing interface while
 * using the provider-agnostic smoothing implementation from core.
 */
export function createAssistantSegmentRenderer(options: {
  pushSegment: (segment: string, tokenCount?: number) => void;
  intervalMs?: number;
}): AssistantSegmentRenderer {
  const smoother = createTextSmoother({
    onChunk: options.pushSegment,
    delayMs: options.intervalMs ?? 12,
    chunking: 'word',
  });

  return {
    enqueueText: smoother.push,
    flushAll: smoother.flushAll,
    clear: smoother.clear,
    stop: smoother.stop,
  };
}

type GlobalProgressSink = {
  start: (event: {
    toolCallId: string;
    toolName: string;
    input?: Record<string, unknown>;
    originAgentId?: string;
    parentToolCallId?: string;
    startedAt?: number;
    kind?: 'tool' | 'task';
    depth?: number;
  }) => void;
  complete: (event: {
    toolCallId: string;
    toolName: string;
    output?: unknown;
    completedAt?: number;
    durationMs?: number;
  }) => void;
  fail: (event: {
    toolCallId: string;
    toolName: string;
    error: { message: string };
    completedAt?: number;
    durationMs?: number;
  }) => void;
};

export function createNonInteractiveFallbackPayload(reason: string): NonInteractiveFallbackPayload {
  return {
    mode: 'non-interactive',
    reason,
    suggestion: 'Run fred chat in a terminal for interactive mode',
    help: 'Use fred --help for other commands',
  };
}

// ---------------------------------------------------------------------------
// XML tag filter — stream transform
// ---------------------------------------------------------------------------

const XML_TAG_PATTERN = /<\/?[a-z][a-z0-9_-]*(?:\s[^>]*)?\/?>/gi;
const MAX_XML_FILTER_PASSES = 8;
const MAX_XML_BUFFER_CHARS = 8_192;

/**
 * Strip XML tags from token deltas in a streaming pipeline.
 *
 * Handles partial XML tags that span multiple token events by buffering
 * text until a complete tag boundary is found. Non-token events pass
 * through immediately (after flushing any safe buffered text).
 *
 * Returns a curried transform: `filterXmlTokenStream(source) => AsyncIterable<E>`.
 */
export function filterXmlTokenStream<
  E extends { type: string; delta?: string },
>(source: AsyncIterable<E>): AsyncIterable<E> {
  async function* generate(): AsyncGenerator<E> {
    let buffer = '';
    let templateEvent: E | null = null;

    const filterXml = (text: string): string => {
      let filtered = text;
      let previous = '';
      let passes = 0;
      while (filtered !== previous && passes < MAX_XML_FILTER_PASSES) {
        previous = filtered;
        filtered = filtered.replace(XML_TAG_PATTERN, '');
        passes += 1;
      }
      return filtered;
    };

    const makeTokenEvent = (delta: string): E => {
      return { ...templateEvent!, delta } as E;
    };

    for await (const event of source) {
      if (event.type !== 'token' || !event.delta) {
        // Flush buffer before non-token events
        if (buffer.length > 0 && templateEvent) {
          const filtered = filterXml(buffer);
          buffer = '';
          if (filtered) {
            yield makeTokenEvent(filtered);
          }
        }
        yield event;
        continue;
      }

      templateEvent = event;
      buffer += event.delta;

      // Check for partial XML tag at end of buffer
      const lastOpenBracket = buffer.lastIndexOf('<');
      if (lastOpenBracket >= 0) {
        const afterBracket = buffer.slice(lastOpenBracket);
        if (/^<[a-z/]/i.test(afterBracket) && !afterBracket.includes('>')) {
          // Partial tag detected — flush safe prefix, keep the rest
          const safe = buffer.slice(0, lastOpenBracket);
          if (safe) {
            const filtered = filterXml(safe);
            if (filtered) {
              yield makeTokenEvent(filtered);
            }
          }
          buffer = afterBracket;

          // Safety cap
          if (buffer.length > MAX_XML_BUFFER_CHARS) {
            const filtered = filterXml(buffer);
            buffer = '';
            if (filtered) {
              yield makeTokenEvent(filtered);
            }
          }
          continue;
        }
      }

      // No partial tags — filter and flush
      const filtered = filterXml(buffer);
      buffer = '';
      if (filtered) {
        yield makeTokenEvent(filtered);
      }
    }

    // Flush any remaining buffer
    if (buffer.length > 0 && templateEvent) {
      const filtered = filterXml(buffer);
      if (filtered) {
        yield makeTokenEvent(filtered);
      }
    }
  }

  return generate();
}

/**
 * Map platform ID to its provider package name.
 * Dynamic import triggers the package's self-registration via registerBuiltinPack().
 */
export const PROVIDER_PACKAGES: Record<string, string> = {
  ...DEV_CHAT_PROVIDER_PACKAGES,
};

export async function loadProviderPackage(platform: string): Promise<void> {
  await loadProviderPackageFromDev(platform);
}

/**
 * Detect which AI provider is available based on environment variables
 * Returns platform and model, or null if no provider available
 */
export function detectAvailableProvider(): { platform: string; model: string } | { platform: null; model: null } {
  return detectAvailableProviderFromDev();
}

export function createChatFallbackOptions(
  sqlitePath = process.env.FRED_SQLITE_PATH || './fred.db',
  createStorage: ChatDependencies['createStorage'] = DEFAULT_DEPS.createStorage,
): CreateFredOptions {
  return {
    storage: createStorage({ path: sqlitePath }) as CreateFredOptions['storage'],
  };
}

/**
 * Initialize Fred instance with config or auto-detection
 * Returns Fred instance and model/provider info
 */
async function initializeFred(deps: ChatDependencies = DEFAULT_DEPS): Promise<{
  fred: FredClient;
  model: string;
  provider: string;
  pluginSlashCommands: PluginSlashCommandRuntime[];
  startupWarning: string | null;
}> {
  let fred: FredClient | undefined;
  let pluginSlashCommands: PluginSlashCommandRuntime[] = [];
  let startupWarning: string | null = null;

  // Try to load project config
  const configResult = deps.resolveProjectConfig();

  if (configResult.success && configResult.config && configResult.configPath) {
    // Config found - initialize from it
    try {
      const runtimeHook = await deps.loadProjectRuntimeHook(configResult.configPath);
      fred = await deps.createFred({ configPath: configResult.configPath });
      pluginSlashCommands = buildBuiltinSlashCommands(fred);

        if (configResult.config.plugins && configResult.config.plugins.length > 0) {
          const pluginResult = loadPluginsFromConfig(configResult.config.plugins, configResult.configPath);
          pluginSlashCommands = [
            ...buildBuiltinSlashCommands(fred),
            ...(await buildPluginSlashRuntime(pluginResult.plugins)),
          ];
        }

      if (runtimeHook) {
        await runtimeHook(fred, {
          configPath: configResult.configPath,
          projectRoot: dirname(configResult.configPath),
        });
      }

      await deps.projectSetupHook?.(fred);

      const result = await deps.ensureDefaultChatAgent(fred, {
        agentId: '__tui_agent__',
      });

      if ((await fred.agents.list()).length === 1) {
        await fred.effects.run(Effect.flatMap(ToolGateService, (service) => service.reloadPolicies({
          agents: {
            [result.agentId]: {
              deny: ['handoff_to_agent'],
              conflictResolution: 'deny-overrides',
            },
          },
        })));
      }

      return {
        fred,
        model: result.model,
        provider: result.provider,
        pluginSlashCommands,
        startupWarning,
      };
    } catch (error) {
      // Config exists but failed to initialize - fall through to auto-detection
      const reason = sanitizeErrorForCli(error);
      startupWarning = `Config load failed, using defaults: ${reason}`;
      await fred?.shutdown().catch(() => undefined);
      fred = undefined;
    }
  }

  // No config or config failed - apply shared dev-chat fallback behavior
  fred = await deps.createFred(createChatFallbackOptions(undefined, deps.createStorage));
  pluginSlashCommands = buildBuiltinSlashCommands(fred);

  await deps.projectSetupHook?.(fred);

  const result = await deps.ensureDefaultChatAgent(fred, {
    agentId: '__tui_agent__',
  });

  if ((await fred.agents.list()).length === 1) {
    await fred.effects.run(Effect.flatMap(ToolGateService, (service) => service.reloadPolicies({
      agents: {
        [result.agentId]: {
          deny: ['handoff_to_agent'],
          conflictResolution: 'deny-overrides',
        },
      },
    })));
  }

  return {
    fred,
    model: result.model,
    provider: result.provider,
    pluginSlashCommands,
    startupWarning,
  };
}

async function buildPluginSlashRuntime(
  plugins: ReadonlyArray<RegisteredPluginContributions>,
): Promise<PluginSlashCommandRuntime[]> {
  const runtime: PluginSlashCommandRuntime[] = [];

  for (const plugin of plugins) {
    for (const slashCommand of plugin.slashCommands) {
      let available = true;
      if (slashCommand.available) {
        try {
          available = await slashCommand.available({ cwd: process.cwd() });
        } catch {
          available = false;
        }
      }

      runtime.push({
        pluginId: plugin.pluginId,
        commandId: slashCommand.name,
        summary: slashCommand.summary,
        usage: slashCommand.usage,
        available,
        execute: slashCommand.execute,
      });
    }
  }

  return runtime;
}

/**
 * Actionable recovery guidance emitted when terminal restoration fails.
 * Helps users restore their terminal if cleanup couldn't complete.
 */
export const TERMINAL_RECOVERY_GUIDANCE =
  'Terminal may be in an inconsistent state. ' +
  'Run `reset` or `stty sane` to restore normal terminal behavior.';

export const CHAT_SHUTDOWN_TIMEOUT_MS = 5_000;

export async function shutdownFredBeforeExit(
  fred: Pick<FredClient, 'shutdown'>,
  timeoutMs = CHAT_SHUTDOWN_TIMEOUT_MS,
): Promise<number> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Fred shutdown timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([fred.shutdown(), timeout]);
    return 0;
  } catch (error) {
    console.error(`Failed to shut down Fred cleanly: ${sanitizeErrorForCli(error)}`);
    return 1;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Handle chat command
 *
 * Routes to interactive TUI when TTY is available, or non-interactive mode otherwise.
 * In interactive mode, terminal lifecycle is managed by Effect acquire/use/release
 * via withTerminalLifecycle, guaranteeing cleanup on success, error, and interruption.
 */
export async function handleChatCommand(deps: Partial<ChatDependencies> = {}): Promise<void> {
  const resolvedDeps: ChatDependencies = { ...DEFAULT_DEPS, ...deps };
  const mode = detectTerminalMode();

  // Interactive TTY mode — launch TUI shell with Effect-scoped lifecycle
  if (mode.mode === 'interactive-tty') {
    // Build the interactive TUI program as an Effect
    const interactiveProgram = Effect.gen(function* () {
      // Initialize Fred
      const initResult = yield* Effect.tryPromise({
        try: () => initializeFred(resolvedDeps),
        catch: (error) =>
          new Error(
            `Failed to initialize AI provider: ${sanitizeErrorForCli(error)}`
          ),
      });

      const { fred, model, provider, pluginSlashCommands, startupWarning } = initResult;
      const contextManager = {
        listSessions: () => fred.sessions.list(),
        generateConversationId: () => fred.effects.run(
          Effect.flatMap(ContextStorageService, (service) => service.generateConversationId()),
        ),
        getContext: (id: string) => fred.effects.run(
          Effect.flatMap(ContextStorageService, (service) => service.getContext(id)),
        ),
        updateMetadata: (id: string, metadata: Record<string, unknown>) => fred.effects.run(
          Effect.flatMap(ContextStorageService, (service) => service.updateMetadata(id, metadata)),
        ),
        getSession: (id: string) => fred.sessions.get(id),
        deleteSession: (id: string) => fred.sessions.delete(id),
      };

      // Track active stream abort controller for explicit exit cancellation
      let activeStreamAbort: AbortController | null = null;
      let isQuitting = false;

      // Create TUI app — resolves a long-lived app that runs until quit
      const app = yield* Effect.tryPromise({
        try: () =>
          resolvedDeps.createFredTuiApp(
            {
              onSubmit: (text: string, sessionId: string | null) => {
                // Fire-and-forget async streaming (don't await to avoid blocking TUI)
                (async () => {
                  const globalWithProgress = globalThis as typeof globalThis & {
                    __FRED_TUI_TOOL_PROGRESS__?: GlobalProgressSink;
                  };
                  let progressSink: GlobalProgressSink | null = null;
                  let streamAbort: AbortController | null = null;
                  try {
                    activeStreamAbort?.abort();
                    streamAbort = new AbortController();
                    activeStreamAbort = streamAbort;
                    const signal = streamAbort.signal;
                    const activeSessionId = sessionId ?? await contextManager.generateConversationId();
                    const eventStream = await fred.effects.run(
                      Effect.map(MessageProcessorService, (processor) =>
                        processor.streamMessage(text, {
                          conversationId: activeSessionId,
                          signal,
                        }).pipe(
                          Stream.mapError((error) =>
                            error instanceof Error ? error : new Error(String(error)),
                          ),
                          Stream.interruptWhen(
                            Effect.async<void>((resume) => {
                              if (signal.aborted) {
                                resume(Effect.void);
                                return;
                              }
                              const onAbort = () => resume(Effect.void);
                              signal.addEventListener('abort', onAbort, { once: true });
                              return Effect.sync(() => signal.removeEventListener('abort', onAbort));
                            }),
                          ),
                        ),
                      ),
                    );

                    // Two-stage display pipeline:
                    // 1. filterXmlTokenStream: strips XML tags from token deltas
                    //    (stateful across events to handle partial tags)
                    // 2. smoothStream: splits filtered text into word-level
                    //    segments with real async delays between them
                    const smooth = smoothStream({ delayMs: 12, chunking: 'word' });
                    const displayStream = smooth(
                      filterXmlTokenStream(Stream.toAsyncIterable(eventStream)),
                    );

                    let renderedAssistantText = '';
                    const pendingHandoffs = new Map<number, {
                      toolCallId: string;
                      toAgentId: string;
                      startedAt: number;
                    }>();
                    const activeRuns: Array<{
                      runId: string;
                      depth: number;
                      handoffToolCallId?: string;
                      handoffAgentId?: string;
                      suppressVisibleOutput?: boolean;
                    }> = [];

                    const getCurrentToolDepth = (): number => {
                      const currentRun = activeRuns[activeRuns.length - 1];
                      return currentRun ? currentRun.depth + 1 : 1;
                    };
                    progressSink = {
                      start: ({ toolCallId, toolName, input, originAgentId, parentToolCallId, startedAt, kind, depth }) => {
                        app.pushToolCall({
                          messageId: `external_${toolCallId}`,
                          step: depth ?? getCurrentToolDepth(),
                          toolCallId,
                          toolName,
                          input: input ?? {},
                          originAgentId,
                          parentToolCallId,
                          startedAt: startedAt ?? Date.now(),
                          kind: kind ?? 'task',
                          depth: depth ?? (getCurrentToolDepth() + 1),
                        });
                      },
                      complete: ({ toolCallId, toolName, output, completedAt, durationMs }) => {
                        app.pushToolResult({
                          toolCallId,
                          toolName,
                          output: output ?? 'completed',
                          completedAt: completedAt ?? Date.now(),
                          durationMs: durationMs ?? 0,
                        });
                      },
                      fail: ({ toolCallId, toolName, error, completedAt, durationMs }) => {
                        app.pushToolError({
                          toolCallId,
                          toolName,
                          error,
                          completedAt: completedAt ?? Date.now(),
                          durationMs: durationMs ?? 0,
                        });
                      },
                    };
                    globalWithProgress.__FRED_TUI_TOOL_PROGRESS__ = progressSink;

                    const filterXmlTags = (text: string): string => {
                      let filtered = text;
                      let previous = '';
                      let passes = 0;
                      while (filtered !== previous && passes < MAX_XML_FILTER_PASSES) {
                        previous = filtered;
                        filtered = filtered.replace(XML_TAG_PATTERN, '');
                        passes += 1;
                      }
                      return filtered;
                    };
                    const pushVisibleText = (text: string): void => {
                      if (!text) {
                        return;
                      }
                      renderedAssistantText += text;
                      app.pushAssistantToken(text, 1);
                    };

                    for await (const event of displayStream) {
                      if (signal.aborted) break;
                      if (event.type === 'run-start') {
                        const pendingDepths = Array.from(pendingHandoffs.keys()).sort((left, right) => right - left);
                        const pendingDepth = pendingDepths[0];
                        const pendingHandoff = pendingDepth !== undefined
                          ? pendingHandoffs.get(pendingDepth)
                          : undefined;

                        activeRuns.push({
                          runId: event.runId,
                          depth: pendingDepth ?? 0,
                          handoffToolCallId: pendingHandoff?.toolCallId,
                          handoffAgentId: pendingHandoff?.toAgentId,
                          suppressVisibleOutput: false,
                        });

                        if (pendingDepth !== undefined) {
                          pendingHandoffs.delete(pendingDepth);
                        }
                      } else if (event.type === 'handoff-start') {
                        const toolCallId = `handoff_${event.handoffDepth}_${event.sequence}`;
                        pendingHandoffs.set(event.handoffDepth, {
                          toolCallId,
                          toAgentId: event.toAgentId,
                          startedAt: event.emittedAt,
                        });
                      } else if (event.type === 'token' && event.delta) {
                        // Token events arrive pre-filtered (XML tags stripped)
                        // and pre-split (word-level chunks with delays) from
                        // the two-stage display pipeline.
                        const currentRun = activeRuns[activeRuns.length - 1];
                        if (!currentRun?.suppressVisibleOutput) {
                          pushVisibleText(event.delta);
                        }
                      } else if (event.type === 'tool-call') {
                        if (event.toolName === 'handoff_to_agent') {
                          const currentRun = activeRuns[activeRuns.length - 1];
                          if (currentRun) {
                            currentRun.suppressVisibleOutput = true;
                          }
                          app.clearAssistantStreamContent();
                          renderedAssistantText = '';
                          continue;
                        }
                        app.pushToolCall({
                          messageId: event.messageId,
                          step: event.step,
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          input: event.input,
                          startedAt: event.startedAt,
                          depth: getCurrentToolDepth(),
                          originAgentId: event.originAgentId,
                        });
                      } else if (event.type === 'tool-result') {
                        if (event.toolName === 'handoff_to_agent') {
                          continue;
                        }
                        app.pushToolResult({
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          output: event.output,
                          completedAt: event.completedAt,
                          durationMs: event.durationMs,
                          error: event.error ? { message: event.error.message } : undefined,
                        });
                      } else if (event.type === 'tool-error') {
                        if (event.toolName === 'handoff_to_agent') {
                          continue;
                        }
                        app.pushToolError({
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          error: { message: event.error.message },
                          completedAt: event.completedAt,
                          durationMs: event.durationMs,
                        });
                      } else if (event.type === 'run-end') {
                        const finalVisible = filterXmlTags(event.result.content ?? '');
                        const completedRun = activeRuns.pop();

                        if (!event.result.handoff && !completedRun?.suppressVisibleOutput) {
                          if (finalVisible && finalVisible.startsWith(renderedAssistantText)) {
                            const missingSuffix = finalVisible.slice(renderedAssistantText.length);
                            if (missingSuffix) {
                              pushVisibleText(missingSuffix);
                            }
                          } else if (finalVisible && renderedAssistantText.length === 0) {
                            pushVisibleText(finalVisible);
                          }
                        }
                      }
                    }

                    // No tokenBuffer flush needed — filterXmlTokenStream
                    // handles buffer flushing when the source stream ends.

                    app.completeAssistantStream();
                    if (progressSink && globalWithProgress.__FRED_TUI_TOOL_PROGRESS__ === progressSink) {
                      delete globalWithProgress.__FRED_TUI_TOOL_PROGRESS__;
                    }
                  } catch (error) {
                    if (progressSink && globalWithProgress.__FRED_TUI_TOOL_PROGRESS__ === progressSink) {
                      delete globalWithProgress.__FRED_TUI_TOOL_PROGRESS__;
                    }
                    // User-initiated exit aborts the stream — don't show error
                    if (streamAbort?.signal.aborted) {
                      return;
                    }
                    app.failAssistantStream(error);
                  } finally {
                    if (activeStreamAbort === streamAbort) {
                      activeStreamAbort = null;
                    }
                  }
                })().catch((error) => {
                  app.stop();
                  console.error('Fatal streaming error:', error);
                  process.exit(1);
                });
              },
              onQuit: () => {
                if (isQuitting) {
                  return;
                }
                isQuitting = true;
                // Abort any active stream before exiting
                activeStreamAbort?.abort();
                console.log('Exiting Fred chat...');
                queueMicrotask(() => app.stop());
                void shutdownFredBeforeExit(fred).then((exitCode) => process.exit(exitCode));
              },
              onError: (_error) => {
                // Abort the active stream so the for-await loop exits cleanly.
                // Errors are already displayed in the TUI status bar by failAssistantStream.
                activeStreamAbort?.abort();
              },
            },
            {
              sessionService: { contextManager },
              initialSessionId: null,
              streamingFlushStrategy: 'token',
              pluginSlashCommands,
              startupWarning,
              streamTimeoutMode: 'patient',
              patienceMessage: DEFAULT_PATIENCE_MESSAGES,
              patienceIntervalMs: 15_000,
              agentStatus: {
                subscribe: async (listener) => {
                  const controller = new AbortController();
                  const changes = Effect.flatMap(AgentStatusService, (service) =>
                    service.changes.pipe(
                      Stream.interruptWhen(
                        Effect.async<void>((resume) => {
                          const onAbort = () => resume(Effect.void);
                          controller.signal.addEventListener('abort', onAbort, { once: true });
                          return Effect.sync(() => controller.signal.removeEventListener('abort', onAbort));
                        }),
                      ),
                      Stream.runForEach((snapshot) => Effect.sync(() => listener(snapshot))),
                    ),
                  );
                  void fred.effects.run(changes).catch(() => undefined);
                  return async () => controller.abort();
                },
              },
            }
          ),
        catch: (error) =>
          new Error(
            `Failed to create TUI app: ${sanitizeErrorForCli(error)}`
          ),
      });

      // Update telemetry with actual model info
      app.updateTelemetryModel(model, provider);

      // Forward isolated config hot-reload warnings to the TUI notice without
      // exposing the underlying watcher or allowing it to outlive the app.
      // Keep the Effect alive until the app is stopped.
      // The app runs until onQuit fires (which calls process.exit).
      // This await-forever keeps the lifecycle scope open so the
      // release finalizer remains armed for cleanup.
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => fred.warnings.subscribe((message) => {
          app.setSystemNotice(message);
        })),
        () => Effect.never,
        (unsubscribe) => Effect.sync(unsubscribe),
      );
    });

    // Wrap interactive program with terminal lifecycle guarantees
    const lifecycleProgram = withTerminalLifecycle(interactiveProgram, {
      rawMode: true,
    });

    try {
      await Effect.runPromise(lifecycleProgram);
    } catch (error) {
      // Lifecycle or program failure — emit actionable recovery guidance
      console.error(
        sanitizeErrorForCli(error)
      );
      console.error(TERMINAL_RECOVERY_GUIDANCE);
      process.exit(1);
    }

    return;
  }

  // Non-TTY mode — provide structured output
  console.log(JSON.stringify(createNonInteractiveFallbackPayload(mode.reason), null, 2));

  process.exit(1);
}
