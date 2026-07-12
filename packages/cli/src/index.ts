#!/usr/bin/env bun

/**
 * Fred CLI
 * Main entry point for CLI commands
 */

import { handleTestCommand } from './test';
import { handleDevCommand, loadProjectSetup } from './dev';
import { handleEvalCommand } from './eval';
import { handleChatCommand } from './commands/chat';
import { handleSessionCommand } from './commands/session';
import { handleListCommand } from './commands/list';
import { handleConfigCommand } from './commands/config';
import { handleInitCommand } from './commands/init';
import { handleRunCommand } from './commands/run';
import { handleIntentCommand } from './commands/intent';
import { handleRouteCommand } from './commands/route';
import { handleMcpCommand } from './commands/mcp';
import { handleValidateCommand } from './commands/validate';
import { handleStatusCommand } from './commands/status';
import { handleKeysCommand } from './commands/keys';
import { resolveProjectConfig } from './project/resolve-config.js';
import {
  AggregatedPluginValidationError,
  loadPluginsFromConfig,
  type PluginStartupIssue,
} from './plugin/manager.js';
import { createPluginCliRuntime, type PluginCliRuntime } from './plugin/runtime.js';
import { renderPluginHelpSection } from './plugin/help.js';

/**
 * Options that require a value
 */
const OPTIONS_REQUIRING_VALUE = new Set([
  'record',
  'config',
  'traces-dir',
  'tracesDir',
  'run-id',
  'runId',
  'trace-id',
  'traceId',
  'from-step',
  'fromStep',
  'suite',
  'suite-file',
  'suiteFile',
  'output',
  'baseline',
  'candidate',
  'mode',
  'format',
  'agent',
  'input',
  'workflow',
  'conversation-id',
  'conversationId',
  'threshold',
  'sqlite',
  'postgres',
  'scope',
  'scopes',
  'id',
  'rate-limit-max',
  'rate-limit-window-ms',
]);

const BUILTIN_COMMANDS = new Set([
  'help',
  'chat',
  'tui',
  'dev',
  'test',
  'eval',
  'session',
  'agents',
  'tools',
  'intents',
  'providers',
  'workflows',
  'config',
  'init',
  'run',
  'status',
  'intent',
  'route',
  'mcp',
  'validate',
  'keys',
]);

const PLUGIN_VALIDATION_EXIT_CODE = 12;

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): { command: string; args: string[]; options: Record<string, any> } {
  const command = args[0] || 'chat';
  const remainingArgs: string[] = [];
  const options: Record<string, any> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      const nextArg = args[i + 1];
      const requiresValue = OPTIONS_REQUIRING_VALUE.has(key);

      // Check if option requires a value
      if (requiresValue) {
        // Validate that a value is provided
        if (nextArg === undefined || nextArg.startsWith('--')) {
          throw new Error(`Option --${key} requires a value. Example: --${key} <value>`);
        }
        options[key] = nextArg;
        i++; // Skip next arg as it's the value
      } else {
        // Handle boolean flags (options that don't require values)
        if (nextArg === undefined || nextArg.startsWith('--')) {
          options[key] = true;
        } else {
          // If a value is provided for a boolean flag, treat it as the value
          // (some flags might accept optional values)
          options[key] = nextArg;
          i++; // Skip next arg as it's the value
        }
      }
    } else {
      remainingArgs.push(arg);
    }
  }

  return { command, args: remainingArgs, options };
}

/**
 * Show help message
 */
function showHelp(pluginHelpSection = ''): void {
  console.log(`
Fred CLI

Usage:
  fred <command> [options]

Commands:
  chat, tui               Start interactive chat interface
                          - Full-screen TUI with streaming output
                          - If your project exports setup(fred) from src/index.(ts|js) or index.(ts|js), it will be executed before chat starts
  run                     Run agent headlessly (for CI/scripting)
                          --agent <name>   Agent to use (required)
                          --input <msg>    Message to send (or pipe via stdin)
                          --json           Output structured JSON response
                          --verbose        Show tool calls inline
                          --conversation-id <id>  Continue a conversation
  status                  Show active agent runs in this Fred runtime
                          --json           Output structured JSON
  agents                  List registered agents
  tools                   List registered tools
  intents                 List registered intents
  providers               List configured providers
  workflows               List defined workflows
  config validate         Validate config file and show diagnostics
  init                    Scaffold a new Fred project
  intent test "message"   Test intent matching for a message
                          --verbose        Show alternatives and timing
                          --threshold <n>  Filter alternatives below confidence
                          --json           Output structured JSON
  route test "message"    Test routing decision for a message
                          --verbose        Show full decision chain
                          --json           Output structured JSON
  mcp list                List configured MCP servers
  mcp start <id>          Start an MCP server (use --all for all)
  mcp stop <id>           Stop an MCP server (use --all for all)
  mcp status <id>         Show MCP server connection health
  validate                Compile-check markdown agent templates
                          --preview        Show resolved output previews
  keys create             Create a scoped API key in durable storage
                          --sqlite <path> | --postgres <url>
                          --scopes <a,b>   Optional comma-separated scopes
  session                 Manage saved chat sessions
  session list             List sessions (table or --json)
  session show <id>        Show a session transcript
  session export <id>      Export a session transcript (use --format json|markdown)
  session rm <id...>       Delete one or more sessions (confirmation required)
  dev                     Start development chat interface with hot reload (deprecated - use 'chat')
                          - If your project exports setup(fred) from src/index.(ts|js) or index.(ts|js), it will be executed before chat starts
  test                    Run golden trace tests
  test --record <message>  Record a new golden trace
  test --update            Update existing golden traces
  test <pattern>           Run tests matching pattern
  eval                    Run evaluation workflows
  eval record --run-id <id>           Record evaluation artifact for a run
  eval replay --trace-id <id>         Replay run from checkpoint (config optional; uses artifact data when no config)
                                    Optional: --from-step <n> --mode retry|skip|restart --config <file>
  eval compare --baseline <id> --candidate <id>  Compare two evaluation traces
  eval suite --suite <file>           Run evaluation suite manifest
                                     Outputs: pass/fail totals, latency/token metrics, intent confusion matrix

${pluginHelpSection}Options:
  --config <file>          Path to Fred config file
  --traces-dir <dir>       Directory for golden traces (default: tests/golden-traces)

Examples:
  fred chat
  fred run --agent assistant --input "What is 2+2?"
  fred status
  fred agents
  fred tools --json
  fred config validate
  fred init
  fred intent test "What is 2+2?"
  fred route test "Help me with billing"
  fred mcp list
  fred mcp start filesystem-server
  fred mcp status filesystem-server
  fred validate
  fred validate --preview
  fred keys create --sqlite ./fred.db --scopes workflows:run
  fred session list
  fred session list --json
  fred session show conv_123
  fred session export conv_123 --format markdown
  fred session rm conv_123 conv_456
  fred test
  fred test --record "Hello, world!"
  fred test --update
  fred test --config fred.config.yaml
  fred eval record --run-id run-123 --output json
  fred eval replay --trace-id trace-abc --from-step 2
  fred eval compare --baseline trace-a --candidate trace-b
  fred eval suite --suite ./eval/suite.yaml --output json

Get started:
  Run 'fred chat' to start an interactive session with your AI agents.
  `);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Check for help flags BEFORE plugin initialization so --help always works
  // even if plugins have validation issues.
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    const helpPluginResult = initializePluginCliRuntime();
    const helpPluginSection = helpPluginResult.runtime
      ? renderPluginHelpSection(helpPluginResult.runtime.listCommands())
      : '';
    showHelp(helpPluginSection);
    process.exit(0);
  }

  const pluginRuntimeResult = initializePluginCliRuntime();

  if (pluginRuntimeResult.startupIssues) {
    emitPluginStartupDiagnostics(
      pluginRuntimeResult.startupIssues,
      argv.includes('--json'),
    );
    process.exit(PLUGIN_VALIDATION_EXIT_CODE);
    return;
  }

  const pluginRuntime = pluginRuntimeResult.runtime;
  const pluginHelpSection = renderPluginHelpSection(pluginRuntime.listCommands());

  const { command, args: commandArgs, options } = parseArgs(argv);
  const rawCommandArgs = argv.slice(1);

  try {
    let exitCode = 0;

    switch (command) {
      case 'chat':
      case 'tui':
        // handleChatCommand is async — OpenTUI manages terminal lifecycle
        await handleChatCommand({ projectSetupHook: loadProjectSetup });
        return;

      case 'dev':
        await handleDevCommand();
        return;

      case 'test':
        exitCode = await handleTestCommand(commandArgs, {
          pattern: commandArgs[0],
          update: options.update === true,
          record: options.record,
          tracesDir: options['traces-dir'] || options.tracesDir,
          configFile: options.config,
        });
        break;

      case 'eval':
        exitCode = await handleEvalCommand(commandArgs, options);
        break;

      case 'session':
        exitCode = await handleSessionCommand(commandArgs, options);
        break;

      case 'agents':
      case 'tools':
      case 'intents':
      case 'providers':
      case 'workflows':
        exitCode = await handleListCommand(command, commandArgs, options);
        break;

      case 'config':
        exitCode = await handleConfigCommand(commandArgs, options);
        break;

      case 'init':
        exitCode = await handleInitCommand(commandArgs, options);
        break;

      case 'run':
        exitCode = await handleRunCommand(commandArgs, options);
        break;

      case 'status':
        exitCode = await handleStatusCommand(commandArgs, options);
        break;

      case 'intent':
        exitCode = await handleIntentCommand(commandArgs, options);
        break;

      case 'route':
        exitCode = await handleRouteCommand(commandArgs, options);
        break;

      case 'mcp':
        exitCode = await handleMcpCommand(commandArgs, options);
        break;

      case 'validate':
        exitCode = await handleValidateCommand(commandArgs, options);
        break;

      case 'keys':
        exitCode = await handleKeysCommand(commandArgs, options);
        break;


      default:
        {
          const pluginResult = await pluginRuntime.dispatch(command, rawCommandArgs, {
            cwd: process.cwd(),
            stdout: (message: string) => console.log(message),
            stderr: (message: string) => console.error(message),
          });

          if (pluginResult.handled) {
            exitCode = pluginResult.exitCode;
            break;
          }

          console.error(`Unknown command: ${command}`);
          showHelp(pluginHelpSection);
          exitCode = 1;
        }
    }

    process.exit(exitCode);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

interface PluginCliRuntimeInitializationResult {
  runtime: PluginCliRuntime;
  startupIssues?: PluginStartupIssue[];
}

function initializePluginCliRuntime(): PluginCliRuntimeInitializationResult {
  const fallback = createPluginCliRuntime({
    plugins: [],
    builtInCommands: BUILTIN_COMMANDS,
  });

  const configResult = resolveProjectConfig();
  if (!configResult.success) {
    const pluginIssues = configResult.diagnostics
      .filter((diagnostic) =>
        diagnostic.severity === 'error' &&
        typeof diagnostic.pluginId === 'string' &&
        diagnostic.pluginId.length > 0 &&
        typeof diagnostic.declarationSource === 'string' &&
        diagnostic.declarationSource.length > 0)
      .map((diagnostic) => ({
        code: diagnostic.code,
        severity: 'error' as const,
        pluginId: diagnostic.pluginId!,
        declarationSource: diagnostic.declarationSource!,
        message: diagnostic.message,
        fix: diagnostic.fix ?? 'Run `fred config validate` to inspect plugin diagnostics.',
      }));

    if (pluginIssues.length > 0) {
      return {
        runtime: fallback,
        startupIssues: pluginIssues,
      };
    }

    return {
      runtime: fallback,
    };
  }

  if (!configResult.configPath || !configResult.config?.plugins?.length) {
    return {
      runtime: fallback,
    };
  }

  try {
    const pluginLoadResult = loadPluginsFromConfig(
      configResult.config.plugins,
      configResult.configPath,
    );
    return {
      runtime: createPluginCliRuntime({
        plugins: pluginLoadResult.plugins,
        builtInCommands: BUILTIN_COMMANDS,
      }),
    };
  } catch (error) {
    if (error instanceof AggregatedPluginValidationError) {
      return {
        runtime: fallback,
        startupIssues: error.issues,
      };
    }

    return {
      runtime: fallback,
    };
  }
}

function emitPluginStartupDiagnostics(
  issues: readonly PluginStartupIssue[],
  jsonMode: boolean,
): void {
  if (jsonMode) {
    console.log(JSON.stringify({
      ok: false,
      error: {
        code: 'plugin-startup-validation-failed',
        exitCode: PLUGIN_VALIDATION_EXIT_CODE,
        summary: `Plugin startup validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}.`,
      },
      diagnostics: issues,
    }, null, 2));
    return;
  }

  const lines: string[] = [
    `Plugin startup validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):`,
  ];

  const groupedIssues = new Map<string, PluginStartupIssue[]>();
  for (const issue of issues) {
    const key = `${issue.pluginId}|${issue.declarationSource}`;
    const group = groupedIssues.get(key);
    if (group) {
      group.push(issue);
    } else {
      groupedIssues.set(key, [issue]);
    }
  }

  for (const [groupKey, group] of groupedIssues.entries()) {
    const [pluginId, declarationSource] = groupKey.split('|');
    lines.push(`  - plugin ${pluginId} (source: ${declarationSource})`);

    for (const issue of group) {
      lines.push(`    • ${issue.code}: ${issue.message}`);
      lines.push(`      fix: ${issue.fix}`);
    }
  }

  lines.push("Run 'fred config validate --json' for structured diagnostics.");
  console.error(lines.join('\n'));
}

// Run if executed directly
if (import.meta.main) {
  void main().catch((error) => {
    console.error('Fatal CLI error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { handleChatCommand } from './commands/chat.js';
export { startDevChat, type DevChatSetupHook } from './dev-chat.js';
export {
  DEV_CHAT_PROVIDER_PACKAGES,
  detectAvailableProvider,
  loadProviderPackage,
  ensureDefaultChatAgent,
  type EnsureDefaultChatAgentOptions,
  type EnsureDefaultChatAgentResult,
} from './chat-defaults.js';
