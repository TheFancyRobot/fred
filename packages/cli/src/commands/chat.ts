/**
 * Chat command handler
 * Explicit interactive entrypoint for fred chat
 */

import { Effect } from 'effect';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Fred } from '@fancyrobot/fred';
import type { SubagentExecutionSummary, SubagentInfo } from '@fancyrobot/fred';
import { SqliteContextStorage } from '@fancyrobot/fred/context/sqlite';
import {
  DEV_CHAT_PROVIDER_PACKAGES,
  detectAvailableProvider as detectAvailableProviderFromDev,
  loadProviderPackage as loadProviderPackageFromDev,
  ensureDefaultChatAgent,
} from '@fancyrobot/fred-dev/chat-defaults';
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
  createFred: () => Fred | PromiseLike<Fred>;
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
}

const DEFAULT_DEPS: ChatDependencies = {
  createFred: () => new Fred(),
  createStorage: (opts) => new SqliteContextStorage(opts),
  resolveProjectConfig,
  loadProjectRuntimeHook,
  ensureDefaultChatAgent,
  createFredTuiApp,
};

export type ProjectRuntimeHook = (
  fred: Fred,
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

export function buildBuiltinSlashCommands(fred: Fred): PluginSlashCommandRuntime[] {
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

type GlobalProgressSink = {
  start: (event: {
    toolCallId: string;
    toolName: string;
    input?: Record<string, unknown>;
    originAgentId?: string;
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

export function configureChatFallbackPersistence(
  fred: Fred,
  sqlitePath = process.env.FRED_SQLITE_PATH || './fred.db',
  createStorage: ChatDependencies['createStorage'] = DEFAULT_DEPS.createStorage,
): void {
  fred.setStorage(createStorage({ path: sqlitePath }) as any);
}

/**
 * Initialize Fred instance with config or auto-detection
 * Returns Fred instance and model/provider info
 */
async function initializeFred(deps: ChatDependencies = DEFAULT_DEPS): Promise<{
  fred: Fred;
  model: string;
  provider: string;
  pluginSlashCommands: PluginSlashCommandRuntime[];
  startupWarning: string | null;
}> {
  const fred = await deps.createFred();
  let pluginSlashCommands: PluginSlashCommandRuntime[] = buildBuiltinSlashCommands(fred);
  let startupWarning: string | null = null;

  // Try to load project config
  const configResult = deps.resolveProjectConfig();

  if (configResult.success && configResult.config && configResult.configPath) {
    // Config found - initialize from it
    try {
        if (configResult.config.plugins && configResult.config.plugins.length > 0) {
          const pluginResult = loadPluginsFromConfig(configResult.config.plugins, configResult.configPath);
          pluginSlashCommands = [
            ...buildBuiltinSlashCommands(fred),
            ...(await buildPluginSlashRuntime(pluginResult.plugins)),
          ];
        }

      const runtimeHook = await deps.loadProjectRuntimeHook(configResult.configPath);
      if (runtimeHook) {
        await runtimeHook(fred, {
          configPath: configResult.configPath,
          projectRoot: dirname(configResult.configPath),
        });
      } else {
        await fred.initializeFromConfig(configResult.configPath);
      }

      const result = await deps.ensureDefaultChatAgent(fred, {
        agentId: '__tui_agent__',
      });

      if (fred.getAgents().length === 1) {
        await fred.setToolPolicies({
          agents: {
            [result.agentId]: {
              deny: ['handoff_to_agent'],
              conflictResolution: 'deny-overrides',
            },
          },
        });
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
    }
  }

  // No config or config failed - apply shared dev-chat fallback behavior
  configureChatFallbackPersistence(fred, undefined, deps.createStorage);

  const result = await deps.ensureDefaultChatAgent(fred, {
    agentId: '__tui_agent__',
  });

  if (fred.getAgents().length === 1) {
    await fred.setToolPolicies({
      agents: {
        [result.agentId]: {
          deny: ['handoff_to_agent'],
          conflictResolution: 'deny-overrides',
        },
      },
    });
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
      const contextManager = fred;

      // Track active stream abort controller for explicit exit cancellation
      let activeStreamAbort: AbortController | null = null;

      // Create TUI app — resolves a long-lived app that runs until quit
      const app = yield* Effect.tryPromise({
        try: () =>
          resolvedDeps.createFredTuiApp(
            {
              onSubmit: (text: string, sessionId: string | null) => {
                const activeSessionId = sessionId ?? contextManager.generateConversationId();
                // Fire-and-forget async streaming (don't await to avoid blocking TUI)
                (async () => {
                  const globalWithProgress = globalThis as typeof globalThis & {
                    __FRED_TUI_TOOL_PROGRESS__?: GlobalProgressSink;
                  };
                  let progressSink: GlobalProgressSink | null = null;
                  try {
                    activeStreamAbort = new AbortController();
                    const streamResult = fred.streamMessage(text, {
                      conversationId: activeSessionId,
                      signal: activeStreamAbort.signal,
                    });

                    // Buffer for XML-aware token filtering.
                    // XML tags may span multiple token deltas, so we accumulate
                    // and only flush text that is safe (no partial opening tags).
                    let tokenBuffer = '';
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
                    const MAX_TOKEN_BUFFER_CHARS = 8_192;
                    const MAX_XML_FILTER_PASSES = 8;
                    const xmlTagPattern = /<\/?[a-z][a-z0-9_-]*(?:\s[^>]*)?\/?>/gi;

                    const getCurrentToolDepth = (): number => {
                      const currentRun = activeRuns[activeRuns.length - 1];
                      return currentRun ? currentRun.depth + 1 : 1;
                    };
                    progressSink = {
                      start: ({ toolCallId, toolName, input, originAgentId, startedAt, kind, depth }) => {
                        app.pushToolCall({
                          messageId: `external_${toolCallId}`,
                          step: depth ?? getCurrentToolDepth(),
                          toolCallId,
                          toolName,
                          input: input ?? {},
                          originAgentId,
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
                        filtered = filtered.replace(xmlTagPattern, '');
                        passes += 1;
                      }
                      return filtered;
                    };
                    const splitDisplaySegments = (text: string): string[] => {
                      const matches = text.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g);
                      return matches ?? [text];
                    };
                    const pushVisibleText = (text: string): void => {
                      if (!text) {
                        return;
                      }
                      renderedAssistantText += text;
                      const segments = splitDisplaySegments(text);
                      for (let index = 0; index < segments.length; index += 1) {
                        app.pushAssistantToken(segments[index], index === 0 ? 1 : 0);
                      }
                    };

                    for await (const event of streamResult.fullStream) {
                      if (activeStreamAbort?.signal.aborted) break;
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
                        tokenBuffer += event.delta;

                        // Check if buffer might contain a partial opening XML tag
                        const lastOpenBracket = tokenBuffer.lastIndexOf('<');
                        if (lastOpenBracket >= 0) {
                          const afterBracket = tokenBuffer.slice(lastOpenBracket);
                          // Only buffer if '<' is followed by a likely tag start character
                          if (/^<[a-z/]/i.test(afterBracket) && !afterBracket.includes('>')) {
                            // Flush everything before the potential tag
                            const safe = tokenBuffer.slice(0, lastOpenBracket);
                            if (safe) {
                              const visible = filterXmlTags(safe);
                              const currentRun = activeRuns[activeRuns.length - 1];
                              if (visible && !currentRun?.suppressVisibleOutput) {
                                pushVisibleText(visible);
                              }
                            }
                            tokenBuffer = afterBracket;

                            // Safety: cap buffered partial tags to prevent unbounded growth
                            if (tokenBuffer.length > MAX_TOKEN_BUFFER_CHARS) {
                              const visible = filterXmlTags(tokenBuffer);
                              const currentRun = activeRuns[activeRuns.length - 1];
                              if (visible && !currentRun?.suppressVisibleOutput) {
                                pushVisibleText(visible);
                              }
                              tokenBuffer = '';
                            }
                            continue;
                          }
                        }

                        // No partial tags -- filter complete XML tags and flush
                        const filtered = filterXmlTags(tokenBuffer);
                        const currentRun = activeRuns[activeRuns.length - 1];
                        if (filtered && !currentRun?.suppressVisibleOutput) {
                          pushVisibleText(filtered);
                        }
                        tokenBuffer = '';
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

                    // Flush any remaining buffered tokens (partial tag never closed)
                    if (tokenBuffer) {
                      const finalFiltered = filterXmlTags(tokenBuffer);
                      const currentRun = activeRuns[activeRuns.length - 1];
                      if (finalFiltered && !currentRun?.suppressVisibleOutput) {
                        pushVisibleText(finalFiltered);
                      }
                      tokenBuffer = '';
                    }

                    app.completeAssistantStream();
                    if (progressSink && globalWithProgress.__FRED_TUI_TOOL_PROGRESS__ === progressSink) {
                      delete globalWithProgress.__FRED_TUI_TOOL_PROGRESS__;
                    }
                  } catch (error) {
                    if (progressSink && globalWithProgress.__FRED_TUI_TOOL_PROGRESS__ === progressSink) {
                      delete globalWithProgress.__FRED_TUI_TOOL_PROGRESS__;
                    }
                    // User-initiated exit aborts the stream — don't show error
                    if (activeStreamAbort?.signal.aborted) {
                      return;
                    }
                    app.failAssistantStream(error);
                  } finally {
                    activeStreamAbort = null;
                  }
                })().catch((error) => {
                  app.stop();
                  console.error('Fatal streaming error:', error);
                  process.exit(1);
                });
              },
              onQuit: () => {
                // Abort any active stream before exiting
                activeStreamAbort?.abort();
                console.log('Exiting Fred chat...');
                process.exit(0);
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
            }
          ),
        catch: (error) =>
          new Error(
            `Failed to create TUI app: ${sanitizeErrorForCli(error)}`
          ),
      });

      // Surface runtime warnings (e.g. hot reload errors) as transient TUI notices
      fred.onWarning = (msg) => app.setSystemNotice(msg);

      // Update telemetry with actual model info
      app.updateTelemetryModel(model, provider);

      // Keep the Effect alive until the app is stopped.
      // The app runs until onQuit fires (which calls process.exit).
      // This await-forever keeps the lifecycle scope open so the
      // release finalizer remains armed for cleanup.
      return yield* Effect.never;
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
