import { describe, expect, test } from 'bun:test';
import {
  createFred,
  type FredClient,
  type RoutingDecision,
  type RoutingExplanation,
} from '@fancyrobot/fred';
import { MessageRouterService } from '@fancyrobot/fred/effect';
import { Effect } from 'effect';
import { handleRouteCommand } from '../../src/commands/route';

const createRoutingDecision = (decision: MockRouteConfig): RoutingDecision => ({
  agent: decision.agent,
  fallback: decision.fallback,
  explanation: decision.explanation,
});

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

interface MockRouteConfig {
  agent: string;
  fallback: boolean;
  explanation?: RoutingExplanation;
}

async function createMockFred(decision: MockRouteConfig | null): Promise<FredClient> {
  const fred = await createFred();
  const resolveDecision = () =>
    decision
      ? Effect.succeed(createRoutingDecision(decision))
      : Effect.fail(Object.assign(new Error('Routing not configured.'), {
          _tag: 'NoAgentsAvailableError' as const,
        }));
  const router: typeof MessageRouterService.Service = {
    route: resolveDecision,
    testRoute: resolveDecision,
    setConfig: () => Effect.void,
  };
  return {
    ...fred,
    effects: {
      run: (effect) => fred.effects.run(Effect.provideService(effect, MessageRouterService, router)),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('route command', () => {
  test('returns compact output on direct match', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({
      agent: 'assistant',
      fallback: false,
    });

    const exitCode = await handleRouteCommand(
      ['test', 'hello'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toContain('->');
    expect(captured.output[0]).toContain('assistant');
    expect(captured.output[0]).not.toContain('fallback');
    expect(captured.errors).toHaveLength(0);
  });

  test('returns yellow output on fallback', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({
      agent: 'default-assistant',
      fallback: true,
    });

    const exitCode = await handleRouteCommand(
      ['test', 'hello'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.output[0]).toContain('->');
    expect(captured.output[0]).toContain('default-assistant');
    expect(captured.output[0]).toContain('fallback');
  });

  test('returns JSON on match', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({
      agent: 'assistant',
      fallback: false,
    });

    const exitCode = await handleRouteCommand(
      ['test', 'hello'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.agent).toBe('assistant');
    expect(payload.fallback).toBe(false);
  });

  test('returns verbose output with explanation', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({
      agent: 'assistant',
      fallback: false,
      explanation: {
        winner: {
          targetId: 'assistant',
          targetName: 'Assistant',
          confidence: 0.95,
        },
        alternatives: [
          { targetId: 'helper', targetName: 'Helper', confidence: 0.75 },
        ],
        confidence: 0.95,
        matchType: 'regex',
        calibrationMetadata: {
          rawScore: 0.92,
          calibratedScore: 0.95,
          calibrated: true,
        },
        concerns: [],
        narrative: 'Matched greeting pattern with high confidence',
      },
    });

    const exitCode = await handleRouteCommand(
      ['test', 'hello'],
      { verbose: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const fullOutput = captured.output.join('\n');
    expect(fullOutput).toContain('Decision:');
    expect(fullOutput).toContain('Matched greeting pattern');
    expect(fullOutput).toContain('Match details:');
    expect(fullOutput).toContain('regex');
    expect(fullOutput).toContain('0.95');
    expect(fullOutput).toContain('Alternatives:');
    expect(fullOutput).toContain('helper');
    expect(fullOutput).toContain('Duration:');
  });

  test('returns exit code 1 on fallback', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({
      agent: 'default-assistant',
      fallback: true,
    });

    const exitCode = await handleRouteCommand(
      ['test', 'random message'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
  });

  test('returns exit code 2 on routing not configured', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred(null);

    const exitCode = await handleRouteCommand(
      ['test', 'hello'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Routing not configured');
    expect(captured.errors[0]).toContain('exit 2');
  });

  test('returns exit code 2 when message is missing', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({ agent: 'assistant', fallback: false });

    const exitCode = await handleRouteCommand(
      ['test'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Message required');
    expect(captured.errors[0]).toContain('Usage:');
    expect(captured.errors[0]).toContain('exit 2');
  });

  test('verbose JSON includes explanation fields', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({
      agent: 'assistant',
      fallback: false,
      explanation: {
        winner: {
          targetId: 'assistant',
          targetName: 'Assistant',
          confidence: 0.95,
        },
        alternatives: [],
        confidence: 0.95,
        matchType: 'exact',
        calibrationMetadata: {
          rawScore: 0.95,
          calibratedScore: 0.95,
          calibrated: true,
        },
        concerns: [],
        narrative: 'Exact match found',
      },
    });

    const exitCode = await handleRouteCommand(
      ['test', 'hello'],
      { json: true, verbose: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.explanation).toBeDefined();
    expect(payload.explanation.narrative).toBe('Exact match found');
    expect(payload.explanation.alternatives).toBeDefined();
    expect(payload.explanation.matchType).toBe('exact');
    expect(payload.explanation.confidence).toBe(0.95);
    expect(payload.durationMs).toBeDefined();
    expect(typeof payload.durationMs).toBe('number');
  });

  test('errors on unknown subcommand', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({ agent: 'assistant', fallback: false });

    const exitCode = await handleRouteCommand(
      ['unknown'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Unknown subcommand');
    expect(captured.errors[0]).toContain('Available: test');
    expect(captured.errors[0]).toContain('exit 2');
  });

  test('displays concerns in verbose mode', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({
      agent: 'assistant',
      fallback: false,
      explanation: {
        winner: {
          targetId: 'assistant',
          targetName: 'Assistant',
          confidence: 0.55,
        },
        alternatives: [],
        confidence: 0.55,
        matchType: 'regex',
        calibrationMetadata: {
          rawScore: 0.55,
          calibratedScore: 0.55,
          calibrated: true,
        },
        concerns: [
          {
            type: 'low-confidence',
            severity: 'warning',
            message: 'Confidence below 0.6 threshold',
          },
        ],
        narrative: 'Low confidence match',
      },
    });

    const exitCode = await handleRouteCommand(
      ['test', 'ambiguous message'],
      { verbose: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const fullOutput = captured.output.join('\n');
    expect(fullOutput).toContain('Concerns:');
    expect(fullOutput).toContain('warning');
    expect(fullOutput).toContain('Confidence below 0.6');
  });

  test('outputs JSON error when message missing with --json', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({ agent: 'assistant', fallback: false });

    const exitCode = await handleRouteCommand(
      ['test'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors).toHaveLength(0); // No stderr output
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('Message required');
  });

  test('outputs JSON error when routing not configured with --json', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred(null); // Routing not configured

    const exitCode = await handleRouteCommand(
      ['test', 'hello'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors).toHaveLength(0); // No stderr output
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('Routing not configured');
  });

  test('outputs JSON error on unknown subcommand with --json', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred({ agent: 'assistant', fallback: false });

    const exitCode = await handleRouteCommand(
      ['unknown'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors).toHaveLength(0); // No stderr output
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('Unknown subcommand');
    expect(payload.error).toContain('Available: test');
  });
});
