/**
 * Route test command handler
 *
 * Tests routing decisions against configured routing rules.
 * Usage: fred route test "message"
 */

import { Fred } from '@fancyrobot/fred';
import { Effect } from 'effect';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { createColors } from './color.js';
import { sanitizeErrorForCli } from './error-sanitize.js';
import {
  ConfigInitError,
  FredInitError,
  InvalidArgumentError,
  RoutingError,
} from './errors.js';

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
 * Initialize Fred instance with config, wrapped in Effect.
 */
const initializeFredEffect = (io: RouteCommandIO): Effect.Effect<Fred, ConfigInitError> =>
  Effect.gen(function* () {
    const fred = new Fred();
    const configResult = resolveProjectConfig();

    if (configResult.success && configResult.configPath) {
      yield* Effect.tryPromise({
        try: () => fred.initializeFromConfig(configResult.configPath!),
        catch: (error) =>
          new ConfigInitError({ message: `Failed to initialize from config: ${sanitizeErrorForCli(error)}` }),
      }).pipe(
        Effect.catchTag('ConfigInitError', (error) =>
          Effect.sync(() => {
            io.stderr(error.message);
          }),
        ),
      );
    }

    return fred;
  });

/**
 * Internal Effect program for the route test subcommand.
 */
const routeTestEffect = (
  args: string[],
  options: Record<string, unknown>,
  deps: RouteCommandDependencies,
): Effect.Effect<
  number,
  FredInitError | InvalidArgumentError | RoutingError
> =>
  Effect.gen(function* () {
    const io = deps.io ?? DEFAULT_IO;
    const colors = createColors();

    // Validate message argument
    const message = args[1];
    if (!message) {
      return yield* Effect.fail(
        new InvalidArgumentError({ message: 'Message required. Usage: fred route test "message"' }),
      );
    }

    // Initialize Fred
    const fred = deps.fred
      ? deps.fred
      : yield* initializeFredEffect(io).pipe(
          Effect.mapError((error) =>
            new FredInitError({ message: `Failed to initialize Fred: ${error.message}` }),
          ),
        );

    // Test route
    const startTime = Date.now();
    const decision = yield* Effect.tryPromise({
      try: () => fred.testRoute(message, {}),
      catch: (error) =>
        new RoutingError({ message: `Routing failed: ${sanitizeErrorForCli(error)}` }),
    });
    const durationMs = Date.now() - startTime;

    // Routing not configured
    if (!decision) {
      return yield* Effect.fail(
        new RoutingError({ message: 'Routing not configured.' }),
      );
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
    }

    return fallback ? 1 : 0;
  });

/**
 * Render a CLI error to the appropriate output based on options.
 */
const renderError = (
  message: string,
  options: Record<string, unknown>,
  io: RouteCommandIO,
): number => {
  if (options.json === true) {
    io.stdout(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    io.stderr(`Error (exit 2): ${message}`);
  }
  return 2;
};

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
    return Effect.runPromise(
      routeTestEffect(args, options, deps).pipe(
        Effect.catchTags({
          FredInitError: (error) =>
            Effect.succeed(renderError(error.message, options, io)),
          InvalidArgumentError: (error) =>
            Effect.succeed(renderError(error.message, options, io)),
          RoutingError: (error) =>
            Effect.succeed(renderError(error.message, options, io)),
        }),
      ),
    );
  }

  if (options.json === true) {
    io.stdout(JSON.stringify({ ok: false, error: `Unknown subcommand "${subcommand}". Available: test` }, null, 2));
  } else {
    io.stderr(`Error (exit 2): Unknown subcommand "${subcommand}". Available: test`);
  }
  return 2;
}
