/**
 * Intent test command handler
 *
 * Tests intent matching against registered intents.
 * Usage: fred intent test "message"
 */

import { Fred } from '@fancyrobot/fred';
import { Effect } from 'effect';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { createColors } from './color.js';
import { sanitizeErrorForCli } from './error-sanitize.js';
import {
  ConfigInitError,
  FredInitError,
  IntentMatchError,
  InvalidArgumentError,
  UnknownSubcommandError,
} from './errors.js';

export interface IntentCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface IntentCommandDependencies {
  fred?: Fred;
  io?: IntentCommandIO;
}

const DEFAULT_IO: IntentCommandIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

/**
 * Initialize Fred instance with config, wrapped in Effect.
 */
const initializeFredEffect = (io: IntentCommandIO): Effect.Effect<Fred, ConfigInitError> =>
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
 * Internal Effect program for the intent test subcommand.
 */
const intentTestEffect = (
  args: string[],
  options: Record<string, unknown>,
  deps: IntentCommandDependencies,
): Effect.Effect<
  number,
  FredInitError | InvalidArgumentError | IntentMatchError
> =>
  Effect.gen(function* () {
    const io = deps.io ?? DEFAULT_IO;
    const colors = createColors();

    // Validate message argument
    const message = args[1];
    if (!message) {
      return yield* Effect.fail(
        new InvalidArgumentError({ message: 'Message required. Usage: fred intent test "message"' }),
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

    const intents = fred.getIntents();
    if (intents.length === 0) {
      return yield* Effect.fail(
        new InvalidArgumentError({ message: 'No intents registered.' }),
      );
    }

    // Match intent using Fred's internal matcher
    const startTime = Date.now();
    const matchResult = yield* Effect.tryPromise({
      try: () => Effect.runPromise((fred as any).intentMatcher.matchIntent(message)),
      catch: (error) =>
        new IntentMatchError({ message: `Intent matching failed: ${sanitizeErrorForCli(error)}` }),
    });
    const durationMs = Date.now() - startTime;

    // No match found
    if (!matchResult) {
      if (options.json === true) {
        io.stdout(JSON.stringify({ ok: false, matched: false, message }, null, 2));
      } else {
        io.stdout(colors.red(`No match for: "${message}"`));
      }
      return 1;
    }

    // Match found - extract data
    const { intent, confidence, allCandidates } = matchResult as any;
    const agentTarget = intent.action.target;

    // Filter alternatives by threshold if specified
    const threshold = typeof options.threshold === 'number' ? options.threshold : 0;
    const filteredAlternatives = allCandidates.filter((alt: any) => alt.confidence >= threshold);

    // JSON output
    if (options.json === true) {
      const result: any = {
        ok: true,
        matched: true,
        intent: intent.id,
        confidence,
        agent: agentTarget,
      };

      if (options.verbose === true) {
        result.alternatives = filteredAlternatives;
        result.durationMs = durationMs;
      }

      io.stdout(JSON.stringify(result, null, 2));
      return 0;
    }

    // Default compact output
    const confidenceStr = confidence.toFixed(2);
    const compactLine = `${colors.green(intent.id)} ${colors.gray(`(${confidenceStr})`)} -> ${colors.bold(agentTarget)}`;
    io.stdout(compactLine);

    // Verbose output
    if (options.verbose === true) {
      io.stdout('');

      // Alternatives
      if (filteredAlternatives.length > 0) {
        io.stdout(colors.bold('Alternatives:'));
        for (const alt of filteredAlternatives) {
          const altConfStr = alt.confidence.toFixed(2);
          io.stdout(`  ${alt.intentId} (${altConfStr})`);
        }
        io.stdout('');
      }

      // Timing
      io.stdout(`Duration: ${durationMs}ms`);
    }

    return 0;
  });

/**
 * Render a CLI error to the appropriate output based on options.
 */
const renderError = (
  message: string,
  options: Record<string, unknown>,
  io: IntentCommandIO,
): number => {
  if (options.json === true) {
    io.stdout(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    io.stderr(`Error (exit 2): ${message}`);
  }
  return 2;
};

/**
 * Handle the `fred intent` command.
 *
 * @param args - Positional arguments (subcommand and params)
 * @param options - CLI options
 * @param deps - Optional injected dependencies for testing
 * @returns Exit code (0 = match, 1 = no match, 2 = error)
 */
export async function handleIntentCommand(
  args: string[],
  options: Record<string, unknown>,
  deps: IntentCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const subcommand = args[0];

  if (subcommand === 'test') {
    return Effect.runPromise(
      intentTestEffect(args, options, deps).pipe(
        Effect.catchTags({
          FredInitError: (error) =>
            Effect.succeed(renderError(error.message, options, io)),
          InvalidArgumentError: (error) =>
            Effect.succeed(renderError(error.message, options, io)),
          IntentMatchError: (error) =>
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
