import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTestCases, type TestCase } from '@fancyrobot/fred/eval';

describe('Golden trace evaluation', () => {
  test('billing routing assertion passes', async () => {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const tracesDirectory = join(currentDir, 'golden-traces');

    const cases: TestCase[] = [
      {
        name: 'Billing route',
        traceFile: 'sample.golden.json',
        assertions: [
          {
            type: 'routing',
            expected: {
              method: 'intent.matching',
              agentId: 'billing',
              intentId: 'billing.refund',
            },
          },
          {
            type: 'response',
            text: 'I can process your refund request right away.',
            semanticThreshold: 0.95,
          },
        ],
      },
    ];

    const results = await runTestCases(cases, tracesDirectory);

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.results.every((result) => result.passed)).toBe(true);
  });
});
