/**
 * Route test command handler
 *
 * Tests routing decisions against configured routing rules.
 * Usage: fred route test "message"
 */

import { Fred } from '@fancyrobot/fred';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { createColors } from './color.js';

export interface RouteCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface RouteCommandDependencies {
  fred?: Fred;
  io?: RouteCommandIO;
}

const DEFAULT_IO: RouteCommandIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

/**
 * Initialize Fred instance with config.
 */
async function initializeFred(io: RouteCommandIO): Promise<Fred> {
  const fred = new Fred();
  const configResult = resolveProjectConfig();

  if (configResult.success && configResult.configPath) {
    try {
      await fred.initializeFromConfig(configResult.configPath);
    } catch (error) {
      io.stderr(`Failed to initialize from config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return fred;
}

/**
 * Handle route test subcommand.
 */
async function handleRouteTest(
  args: string[],
  options: Record<string, unknown>,
  deps: RouteCommandDependencies,
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const colors = createColors();

  // Validate message argument
  const message = args[1];
  if (!message) {
    io.stderr('Error: Message required. Usage: fred route test "message"');
    return 2;
  }

  // Initialize Fred
  let fred: Fred;
  try {
    fred = deps.fred ?? await initializeFred(io);
  } catch (error) {
    io.stderr(`Error: Failed to initialize Fred: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  // Test route
  const startTime = Date.now();
  let decision;
  try {
    decision = await fred.testRoute(message, {});
  } catch (error) {
    io.stderr(`Error: Routing failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const durationMs = Date.now() - startTime;

  // Routing not configured
  if (!decision) {
    io.stderr('Error: Routing not configured.');
    return 2;
  }

  const { agent, fallback, explanation } = decision;

  // JSON output
  if (options.json === true) {
    const result: any = {
      ok: true,
      agent,
      fallback,
    };

    if (options.verbose === true && explanation) {
      result.explanation = {
        narrative: explanation.narrative,
        alternatives: explanation.alternatives,
        matchType: explanation.matchType,
        confidence: explanation.confidence,
        concerns: explanation.concerns,
      };
      result.durationMs = durationMs;
      const configResult = resolveProjectConfig();
      if (configResult.configPath) {
        result.configPath = configResult.configPath;
      }
    }

    io.stdout(JSON.stringify(result, null, 2));
    return fallback ? 1 : 0;
  }

  // Default output - final result only
  if (fallback) {
    io.stdout(`${colors.yellow('->')} ${colors.bold(agent)} ${colors.gray('(fallback)')}`);
  } else {
    io.stdout(`${colors.green('->')} ${colors.bold(agent)}`);
  }

  // Verbose output - full decision chain
  if (options.verbose === true && explanation) {
    io.stdout('');

    // Narrative
    if (explanation.narrative) {
      io.stdout(colors.bold('Decision:'));
      io.stdout(explanation.narrative);
      io.stdout('');
    }

    // Match details
    io.stdout(colors.bold('Match details:'));
    io.stdout(`  Type: ${explanation.matchType}`);
    io.stdout(`  Confidence: ${explanation.confidence.toFixed(2)}`);
    io.stdout('');

    // Alternatives
    if (explanation.alternatives && explanation.alternatives.length > 0) {
      io.stdout(colors.bold('Alternatives:'));
      for (const alt of explanation.alternatives) {
        const altConfStr = alt.confidence.toFixed(2);
        io.stdout(`  ${alt.targetId} (${altConfStr})`);
      }
      io.stdout('');
    }

    // Concerns
    if (explanation.concerns && explanation.concerns.length > 0) {
      io.stdout(colors.bold('Concerns:'));
      for (const concern of explanation.concerns) {
        const severityColor = concern.severity === 'error' ? colors.red : colors.yellow;
        io.stdout(`  ${severityColor(`[${concern.severity}]`)} ${concern.message}`);
      }
      io.stdout('');
    }

    // Timing
    io.stdout(`Duration: ${durationMs}ms`);

    // Config path
    const configResult = resolveProjectConfig();
    if (configResult.configPath) {
      io.stdout(`Config: ${configResult.configPath}`);
    }
  }

  return fallback ? 1 : 0;
}

/**
 * Handle the `fred route` command.
 *
 * @param args - Positional arguments (subcommand and params)
 * @param options - CLI options
 * @param deps - Optional injected dependencies for testing
 * @returns Exit code (0 = direct match, 1 = fallback, 2 = error)
 */
export async function handleRouteCommand(
  args: string[],
  options: Record<string, unknown>,
  deps: RouteCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const subcommand = args[0];

  if (subcommand === 'test') {
    return handleRouteTest(args, options, deps);
  }

  io.stderr(`Error: Unknown subcommand "${subcommand}". Available: test`);
  return 2;
}
