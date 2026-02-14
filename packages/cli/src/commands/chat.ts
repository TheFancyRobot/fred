/**
 * Chat command handler
 * Explicit interactive entrypoint for fred chat
 */

import { Fred } from '@fancyrobot/fred';
import {
  DEV_CHAT_PROVIDER_PACKAGES,
  detectAvailableProvider as detectAvailableProviderFromDev,
  loadProviderPackage as loadProviderPackageFromDev,
  ensureDefaultChatAgent,
} from '@fancyrobot/fred-dev/chat-defaults';
import { detectTerminalMode } from '../runtime/tty-mode.js';
import { createFredTuiApp, type PluginSlashCommandRuntime } from '../tui/app.js';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { loadPluginsFromConfig } from '../plugin/manager.js';
import type { RegisteredPluginContributions } from '../plugin/registry.js';

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

/**
 * Initialize Fred instance with config or auto-detection
 * Returns Fred instance and model/provider info
 */
async function initializeFred(): Promise<{
  fred: Fred;
  model: string;
  provider: string;
  pluginSlashCommands: PluginSlashCommandRuntime[];
  startupWarning: string | null;
}> {
  const fred = new Fred();
  let pluginSlashCommands: PluginSlashCommandRuntime[] = [];
  let startupWarning: string | null = null;

  // Try to load project config
  const configResult = resolveProjectConfig();

  if (configResult.success && configResult.config && configResult.configPath) {
    // Config found - initialize from it
    try {
      if (configResult.config.plugins && configResult.config.plugins.length > 0) {
        const pluginResult = loadPluginsFromConfig(configResult.config.plugins, configResult.configPath);
        pluginSlashCommands = await buildPluginSlashRuntime(pluginResult.plugins);
      }

      await fred.initializeFromConfig(configResult.configPath);

      const result = await ensureDefaultChatAgent(fred, {
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
      const reason = error instanceof Error ? error.message : String(error);
      startupWarning = `Config load failed, using defaults: ${reason}`;
    }
  }

  // No config or config failed - apply shared dev-chat fallback behavior
  const result = await ensureDefaultChatAgent(fred, {
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
 * Handle chat command
 *
 * Routes to interactive TUI when TTY is available, or non-interactive mode otherwise.
 * In interactive mode, OpenTUI manages the terminal lifecycle (alternate screen, raw mode, cleanup).
 */
export async function handleChatCommand(): Promise<void> {
  const mode = detectTerminalMode();

  // Interactive TTY mode — launch TUI shell
  if (mode.mode === 'interactive-tty') {
    // Initialize Fred before creating TUI
    let fred: Fred;
    let model: string;
    let provider: string;
    let pluginSlashCommands: PluginSlashCommandRuntime[];
    let startupWarning: string | null;

    try {
      const initResult = await initializeFred();
      fred = initResult.fred;
      model = initResult.model;
      provider = initResult.provider;
      pluginSlashCommands = initResult.pluginSlashCommands;
      startupWarning = initResult.startupWarning;
    } catch (error) {
      console.error('Failed to initialize AI provider:');
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const contextManager = fred.getContextManager();

    const app = await createFredTuiApp({
      onSubmit: (text: string, sessionId: string | null) => {
        const activeSessionId = sessionId ?? contextManager.generateConversationId();
        // Fire-and-forget async streaming (don't await to avoid blocking TUI)
        (async () => {
          try {
            const streamResult = fred.streamMessage(text, { conversationId: activeSessionId });

            // Iterate over the full stream to get all events
            for await (const event of streamResult.fullStream) {
              // Process token events
              if (event.type === 'token' && event.delta) {
                app.pushAssistantToken(event.delta, 1);
              }

              // Optionally handle usage events for more accurate token counts
              if (event.type === 'usage' && event.usage) {
                // Could update token counts here if needed
                // For now, the app estimates tokens automatically
              }
            }

            // Stream completed successfully
            app.completeAssistantStream();
          } catch (error) {
            // Stream failed — display error in TUI status bar, don't crash
            app.failAssistantStream(error);
          }
        })().catch((error) => {
          // Safety net: if failAssistantStream itself throws, clean up terminal
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
        // Streaming errors are displayed in the TUI status bar via recordStreamingError.
        // Don't exit — let the user see the error and retry or quit manually.
      },
    }, {
      sessionService: {
        contextManager,
      },
      initialSessionId: null,
      pluginSlashCommands,
      startupWarning,
    });

    // Update telemetry with actual model info
    app.updateTelemetryModel(model, provider);

    // Ensure terminal cleanup on unexpected crashes
    const emergencyCleanup = () => {
      if (app.isRunning()) app.stop();
    };
    process.on('uncaughtException', (error) => {
      emergencyCleanup();
      console.error('Uncaught exception:', error);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      emergencyCleanup();
      console.error('Unhandled rejection:', reason);
      process.exit(1);
    });

    // Handle SIGINT as backup (app also handles Ctrl+C via keymap)
    process.on('SIGINT', () => {
      app.stop();
    });

    return;
  }

  // Non-TTY mode — provide structured output
  console.log(JSON.stringify(createNonInteractiveFallbackPayload(mode.reason), null, 2));

  process.exit(1);
}
