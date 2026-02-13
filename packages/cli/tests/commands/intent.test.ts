import { describe, expect, test } from 'bun:test';
import { Fred } from '@fancyrobot/fred';
import { Effect } from 'effect';
import { handleIntentCommand } from '../../src/commands/intent';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createCapturingIO() {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    io: {
      stdout: (msg: string) => output.push(msg),
      stderr: (msg: string) => errors.push(msg),
    },
    output,
    errors,
  };
}

interface MockIntentConfig {
  id: string;
  utterances: string[];
  target: string;
  description?: string;
}

function createMockFred(intents: MockIntentConfig[] = []): Fred {
  const fred = new Fred();

  // Mock getIntents to return our test intents
  (fred as any).getIntents = () =>
    intents.map((cfg) => ({
      id: cfg.id,
      utterances: cfg.utterances,
      action: { target: cfg.target },
      description: cfg.description || cfg.id,
    }));

  // Mock the internal intentMatcher that the command uses
  (fred as any).intentMatcher = {
    matchIntent: (message: string) => {
      const normalizedMessage = message.toLowerCase().trim();

      // Try exact match
      for (const cfg of intents) {
        for (const utterance of cfg.utterances) {
          if (normalizedMessage === utterance.toLowerCase().trim()) {
            return Effect.succeed({
              intent: {
                id: cfg.id,
                utterances: cfg.utterances,
                action: { target: cfg.target },
                description: cfg.description || cfg.id,
              },
              confidence: 1.0,
              matchType: 'exact',
              allCandidates: [{ intentId: cfg.id, intentName: cfg.description || cfg.id, confidence: 1.0 }],
            });
          }
        }
      }

      // Try regex match
      for (const cfg of intents) {
        for (const utterance of cfg.utterances) {
          try {
            const regex = new RegExp(utterance, 'i');
            if (regex.test(message)) {
              return Effect.succeed({
                intent: {
                  id: cfg.id,
                  utterances: cfg.utterances,
                  action: { target: cfg.target },
                  description: cfg.description || cfg.id,
                },
                confidence: 0.8,
                matchType: 'regex',
                allCandidates: [{ intentId: cfg.id, intentName: cfg.description || cfg.id, confidence: 0.8 }],
              });
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }

      // No match
      return Effect.succeed(null);
    },
  };

  return fred;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('intent command', () => {
  test('returns compact output on match', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      { id: 'greeting', utterances: ['hello', 'hi'], target: 'assistant' },
    ]);

    const exitCode = await handleIntentCommand(
      ['test', 'hello'],
      {},
      { fred, io: captured.io },
    );

    if (exitCode !== 0) {
      console.log('Errors:', captured.errors);
      console.log('Output:', captured.output);
    }
    expect(exitCode).toBe(0);
    expect(captured.output[0]).toContain('greeting');
    expect(captured.output[0]).toContain('1.00');
    expect(captured.output[0]).toContain('assistant');
    expect(captured.errors).toHaveLength(0);
  });

  test('returns JSON on match with --json', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      { id: 'greeting', utterances: ['hello'], target: 'assistant' },
    ]);

    const exitCode = await handleIntentCommand(
      ['test', 'hello'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.matched).toBe(true);
    expect(payload.intent).toBe('greeting');
    expect(payload.confidence).toBe(1.0);
    expect(payload.agent).toBe('assistant');
  });

  test('returns exit code 1 on no match', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      { id: 'greeting', utterances: ['hello'], target: 'assistant' },
    ]);

    const exitCode = await handleIntentCommand(
      ['test', 'goodbye'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.output[0]).toContain('No match');
    expect(captured.output[0]).toContain('goodbye');
  });

  test('returns verbose output with alternatives', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      { id: 'greeting', utterances: ['hello', 'hi'], target: 'assistant' },
      { id: 'farewell', utterances: ['goodbye', 'bye'], target: 'assistant' },
    ]);

    const exitCode = await handleIntentCommand(
      ['test', 'hello'],
      { verbose: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    // Should have compact output line + verbose details
    expect(captured.output.length).toBeGreaterThan(1);
    // Should show alternatives
    const fullOutput = captured.output.join('\n');
    expect(fullOutput).toContain('Alternatives:');
    expect(fullOutput).toContain('Duration:');
  });

  test('filters alternatives by --threshold', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      { id: 'greeting', utterances: ['hello.*'], target: 'assistant' }, // regex match (0.8 confidence)
    ]);

    const exitCode = await handleIntentCommand(
      ['test', 'hello world'],
      { verbose: true, threshold: 0.9 },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const fullOutput = captured.output.join('\n');
    // With threshold 0.9, regex match (0.8) should be filtered out from alternatives
    // The winner is still shown, but no alternatives should appear
    if (fullOutput.includes('Alternatives:')) {
      // If alternatives section exists, it should be empty or not show the 0.8 match
      expect(fullOutput).not.toContain('(0.80)');
    }
  });

  test('returns exit code 2 when message is missing', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleIntentCommand(
      ['test'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Message required');
    expect(captured.errors[0]).toContain('Usage:');
    expect(captured.errors[0]).toContain('exit 2');
  });

  test('outputs JSON on no match', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      { id: 'greeting', utterances: ['hello'], target: 'assistant' },
    ]);

    const exitCode = await handleIntentCommand(
      ['test', 'unknown message'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.matched).toBe(false);
    expect(payload.message).toBe('unknown message');
  });

  test('errors on unknown subcommand', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleIntentCommand(
      ['unknown'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Unknown subcommand');
    expect(captured.errors[0]).toContain('Available: test');
    expect(captured.errors[0]).toContain('exit 2');
  });

  test('verbose JSON includes extra fields', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      { id: 'greeting', utterances: ['hello'], target: 'assistant' },
    ]);

    const exitCode = await handleIntentCommand(
      ['test', 'hello'],
      { json: true, verbose: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.alternatives).toBeDefined();
    expect(payload.durationMs).toBeDefined();
    expect(typeof payload.durationMs).toBe('number');
  });

  test('returns exit code 2 when no intents registered', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]); // No intents

    const exitCode = await handleIntentCommand(
      ['test', 'hello'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('No intents registered');
    expect(captured.errors[0]).toContain('exit 2');
  });
});
