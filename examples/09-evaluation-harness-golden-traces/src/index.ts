import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatTestResults,
  loadGoldenTrace,
  runTestCases,
  type TestCase,
} from '@fancyrobot/fred/eval';

async function main() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const tracesDirectory = join(currentDir, '../test/golden-traces');
  const sampleTracePath = join(tracesDirectory, 'sample.golden.json');

  await loadGoldenTrace(sampleTracePath);

  const cases: TestCase[] = [
    {
      name: 'Routes billing question to billing agent',
      traceFile: 'sample.golden.json',
      assertions: [
        {
          type: 'routing',
          expected: {
            method: 'intent.matching',
            agentId: 'billing',
            intentId: 'billing.refund',
            matchType: 'exact',
          },
        },
        {
          type: 'response',
          text: 'I can process your refund request right away.',
          semanticThreshold: 0.95,
        },
      ],
    },
    {
      name: 'Validates expected tool call arguments',
      traceFile: 'sample.golden.json',
      assertions: [
        {
          type: 'tool.calls',
          expected: [
            {
              toolId: 'lookup-subscription',
              argsContains: { customerId: 'cust_123', plan: 'pro' },
            },
          ],
        },
      ],
    },
    {
      name: 'Ensures trace schema remains valid',
      traceFile: 'sample.golden.json',
      assertions: [
        { type: 'schema' },
      ],
    },
  ];

  const results = await runTestCases(cases, tracesDirectory);

  console.log('=== Evaluation Harness Demo ===\n');
  console.log(formatTestResults(results));
}

main().catch((error) => {
  console.error('Evaluation harness example failed:', error);
  process.exitCode = 1;
});
