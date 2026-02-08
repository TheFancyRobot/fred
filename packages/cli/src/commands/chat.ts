/**
 * Chat command handler
 * Explicit interactive entrypoint for fred chat
 */

import { Fred } from '@fancyrobot/fred';
import { detectTerminalMode } from '../runtime/tty-mode.js';
import { createFredTuiApp } from '../tui/app.js';
import { resolveProjectConfig } from '../project/resolve-config.js';

/**
 * Detect which AI provider is available based on environment variables
 * Returns platform and model, or null if no provider available
 */
function detectAvailableProvider(): { platform: string; model: string } | { platform: null; model: null } {
  // Check environment variables in order of preference
  // Priority: Most stable/common providers first

  // Tier 1: Most popular and stable providers
  if (process.env.OPENAI_API_KEY) {
    return { platform: 'openai', model: 'gpt-4o-mini' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { platform: 'anthropic', model: 'claude-3-5-haiku-latest' };
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { platform: 'google', model: 'gemini-2.0-flash-exp' };
  }

  // Tier 2: Fast and cost-effective providers
  if (process.env.GROQ_API_KEY) {
    return { platform: 'groq', model: 'llama-3.1-8b-instant' };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { platform: 'openrouter', model: 'openai/gpt-4o-mini' };
  }

  // No providers available
  return { platform: null, model: null };
}

/**
 * Initialize Fred instance with config or auto-detection
 * Returns Fred instance and model/provider info
 */
async function initializeFred(): Promise<{ fred: Fred; model: string; provider: string }> {
  const fred = new Fred();

  // Try to load project config
  const configResult = resolveProjectConfig();

  if (configResult.success && configResult.config && configResult.configPath) {
    // Config found - initialize from it
    try {
      await fred.initializeFromConfig(configResult.configPath);

      // Extract model info from first agent in config
      const agents = fred.getAgents();
      if (agents.length > 0) {
        const firstAgent = agents[0];
        // Get platform and model from agent's provider config
        const platform = firstAgent.platform ?? 'openai';
        const model = firstAgent.model ?? 'gpt-4o-mini';
        return { fred, model, provider: platform };
      }
    } catch (error) {
      // Config exists but failed to initialize - fall through to auto-detection
      console.warn(`Failed to initialize from config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // No config or config failed - use auto-detection
  await fred.registerDefaultProviders();

  const providerInfo = detectAvailableProvider();
  if (!providerInfo.platform || !providerInfo.model) {
    throw new Error(
      'No AI provider configured. Please set one of:\n' +
      '  OPENAI_API_KEY\n' +
      '  ANTHROPIC_API_KEY\n' +
      '  GOOGLE_GENERATIVE_AI_API_KEY\n' +
      '  GROQ_API_KEY\n' +
      '  OPENROUTER_API_KEY'
    );
  }

  // Create default agent if none exist
  const agents = fred.getAgents();
  if (agents.length === 0) {
    try {
      fred.useProvider(providerInfo.platform);
      fred.createAgent({
        id: '__tui_agent__',
        systemMessage: 'You are a helpful assistant.',
        platform: providerInfo.platform,
        model: providerInfo.model,
        tools: ['calculator'],
      });
    } catch (error) {
      throw new Error(
        `Failed to create agent with ${providerInfo.platform}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    fred,
    model: providerInfo.model,
    provider: providerInfo.platform,
  };
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

    try {
      const initResult = await initializeFred();
      fred = initResult.fred;
      model = initResult.model;
      provider = initResult.provider;
    } catch (error) {
      console.error('Failed to initialize AI provider:');
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const app = await createFredTuiApp({
      onSubmit: (text: string) => {
        // Fire-and-forget async streaming (don't await to avoid blocking TUI)
        (async () => {
          try {
            const streamResult = fred.streamMessage(text);

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
            // Stream failed - report error
            app.failAssistantStream(error);
          }
        })();
      },
      onQuit: () => {
        console.log('Exiting Fred chat...');
        process.exit(0);
      },
      onError: (error) => {
        console.error('TUI error:', error);
        process.exit(1);
      },
    });

    // Update telemetry with actual model info
    app.updateTelemetryModel(model, provider);

    // Handle SIGINT as backup (app also handles Ctrl+C via keymap)
    process.on('SIGINT', () => {
      app.stop();
    });

    return;
  }

  // Non-TTY mode — provide structured output
  console.log(JSON.stringify({
    mode: 'non-interactive',
    reason: mode.reason,
    suggestion: 'Run fred chat in a terminal for interactive mode',
    help: 'Use fred --help for other commands',
  }, null, 2));

  process.exit(1);
}
