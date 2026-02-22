/**
 * Chat command handler
 * Explicit interactive entrypoint for fred chat
 */

import { Effect } from 'effect';
import { Fred, SqliteContextStorage } from '@fancyrobot/fred';
import {
  DEV_CHAT_PROVIDER_PACKAGES,
  detectAvailableProvider as detectAvailableProviderFromDev,
  loadProviderPackage as loadProviderPackageFromDev,
  ensureDefaultChatAgent,
} from '@fancyrobot/fred-dev/chat-defaults';
import { detectTerminalMode } from '../runtime/tty-mode.js';
import { withTerminalLifecycle } from '../runtime/terminal-lifecycle.js';
import { createFredTuiApp, type PluginSlashCommandRuntime } from '../tui/app.js';
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
  /** Ensure a default chat agent exists. */
  ensureDefaultChatAgent: typeof ensureDefaultChatAgent;
  /** Create the TUI app. */
  createFredTuiApp: typeof createFredTuiApp;
}

const DEFAULT_DEPS: ChatDependencies = {
  createFred: () => new Fred(),
  createStorage: (opts) => new SqliteContextStorage(opts),
  resolveProjectConfig,
  ensureDefaultChatAgent,
  createFredTuiApp,
};

export interface NonInteractiveFallbackPayload {
  mode: 'non-interactive';
  reason: string;
  suggestion: string;
  help: string;
}

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
  fred: Pick<Fred, 'getContextManager'>,
  sqlitePath = process.env.FRED_SQLITE_PATH || './fred.db',
  createStorage: ChatDependencies['createStorage'] = DEFAULT_DEPS.createStorage,
): void {
  fred.getContextManager().setStorage(createStorage({ path: sqlitePath }) as any);
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
  let pluginSlashCommands: PluginSlashCommandRuntime[] = [];
  let startupWarning: string | null = null;

  // Try to load project config
  const configResult = deps.resolveProjectConfig();

  if (configResult.success && configResult.config && configResult.configPath) {
    // Config found - initialize from it
    try {
      if (configResult.config.plugins && configResult.config.plugins.length > 0) {
        const pluginResult = loadPluginsFromConfig(configResult.config.plugins, configResult.configPath);
        pluginSlashCommands = await buildPluginSlashRuntime(pluginResult.plugins);
      }

      await fred.initializeFromConfig(configResult.configPath);

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
      const contextManager = fred.getContextManager();

      // Create TUI app — resolves a long-lived app that runs until quit
      const app = yield* Effect.tryPromise({
        try: () =>
          resolvedDeps.createFredTuiApp(
            {
              onSubmit: (text: string, sessionId: string | null) => {
                const activeSessionId = sessionId ?? contextManager.generateConversationId();
                // Fire-and-forget async streaming (don't await to avoid blocking TUI)
                (async () => {
                  try {
                    const streamResult = fred.streamMessage(text, {
                      conversationId: activeSessionId,
                    });

                    // Buffer for XML-aware token filtering.
                    // XML tags may span multiple token deltas, so we accumulate
                    // and only flush text that is safe (no partial opening tags).
                    let tokenBuffer = '';
                    const xmlTagPattern = /<\/?[a-z][a-z0-9_-]*(?:\s[^>]*)?\s*>/gi;

                    for await (const event of streamResult.fullStream) {
                      if (event.type === 'token' && event.delta) {
                        tokenBuffer += event.delta;

                        // Check if buffer might contain a partial opening XML tag
                        const lastOpenBracket = tokenBuffer.lastIndexOf('<');
                        if (lastOpenBracket >= 0) {
                          const afterBracket = tokenBuffer.slice(lastOpenBracket);
                          // If we have an unclosed tag, hold it in the buffer
                          if (!afterBracket.includes('>')) {
                            // Flush everything before the potential tag
                            const safe = tokenBuffer.slice(0, lastOpenBracket);
                            if (safe) {
                              app.pushAssistantToken(safe, 1);
                            }
                            tokenBuffer = afterBracket;
                            continue;
                          }
                        }

                        // No partial tags -- filter complete XML tags and flush
                        const filtered = tokenBuffer.replace(xmlTagPattern, '');
                        if (filtered) {
                          app.pushAssistantToken(filtered, 1);
                        }
                        tokenBuffer = '';
                      } else if (event.type === 'tool-call') {
                        app.pushToolCall({
                          messageId: event.messageId,
                          step: event.step,
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          input: event.input,
                          startedAt: event.startedAt,
                        });
                      } else if (event.type === 'tool-result') {
                        app.pushToolResult({
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          output: event.output,
                          completedAt: event.completedAt,
                          durationMs: event.durationMs,
                          error: event.error ? { message: event.error.message } : undefined,
                        });
                      } else if (event.type === 'tool-error') {
                        app.pushToolError({
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          error: { message: event.error.message },
                          completedAt: event.completedAt,
                          durationMs: event.durationMs,
                        });
                      }
                    }

                    // Flush any remaining buffered tokens (partial tag never closed)
                    if (tokenBuffer) {
                      app.pushAssistantToken(tokenBuffer, 1);
                      tokenBuffer = '';
                    }

                    app.completeAssistantStream();
                  } catch (error) {
                    app.failAssistantStream(error);
                  }
                })().catch((error) => {
                  app.stop();
                  console.error('Fatal streaming error:', error);
                  process.exit(1);
                });
              },
              onQuit: () => {
                console.log('Exiting Fred chat...');
                process.exit(0);
              },
              onError: (_error) => {
                // Streaming errors are displayed in the TUI status bar.
                // Don't exit — let the user see the error and retry or quit manually.
              },
            },
            {
              sessionService: { contextManager },
              initialSessionId: null,
              pluginSlashCommands,
              startupWarning,
            }
          ),
        catch: (error) =>
          new Error(
            `Failed to create TUI app: ${sanitizeErrorForCli(error)}`
          ),
      });

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
