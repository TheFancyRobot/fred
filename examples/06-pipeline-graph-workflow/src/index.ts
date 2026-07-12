import { createFred, defineWorkflow } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object' && 'content' in value) {
    const content = (value as { content?: unknown }).content;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (item && typeof item === 'object' && 'text' in item) {
            const text = (item as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .filter(Boolean)
        .join(' ');
    }
  }

  return String(value ?? '');
}

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  // Native WorkflowIR: the same edge-driven primitive that PipelineBuilder and
  // GraphWorkflowBuilder compile to internally.
  const workflow = defineWorkflow({
    id: 'research-flow',
    entry: 'classifier',
    nodes: [
      { id: 'classifier', kind: 'agent', agentId: 'classifier', expose: ['content'] },
      {
        id: 'routeByIntent',
        kind: 'function',
        expose: ['conditionResult'],
        fn: (ctx) => {
        const classifierText = extractText(ctx.outputs.classifier).toLowerCase();
          return { conditionResult: classifierText.includes('factual') };
        },
      },
      { id: 'researcher', kind: 'agent', agentId: 'researcher', expose: ['content'] },
      { id: 'ideator', kind: 'agent', agentId: 'ideator', expose: ['content'] },
      { id: 'synthesizer', kind: 'agent', agentId: 'synthesizer', expose: ['content'] },
    ],
    edges: [
      { from: 'classifier', to: 'routeByIntent' },
      {
        from: 'routeByIntent',
        to: 'researcher',
        when: {
          type: 'branch',
          condition: {
            field: 'routeByIntent.conditionResult',
            operator: 'equals',
            value: true,
          },
        },
      },
      { from: 'routeByIntent', to: 'ideator', default: true },
      { from: 'researcher', to: 'synthesizer' },
      { from: 'ideator', to: 'synthesizer' },
    ],
  });

  await fred.workflows.define(workflow);

  console.log('=== Graph Workflow Demo: Branching Research Flow ===\n');

  console.log('--- Factual Question ---');
  const factualResult = await fred.workflows.run(
    'research-flow',
    'What causes the northern lights?'
  );
  console.log('Executed nodes:', factualResult.executedNodes.join(' -> '));
  console.log('Final output:', extractText(factualResult.outputs.synthesizer));

  console.log('\n--- Creative Question ---');
  const creativeResult = await fred.workflows.run(
    'research-flow',
    'Imagine a world where gravity works in reverse.'
  );
  console.log('Executed nodes:', creativeResult.executedNodes.join(' -> '));
  console.log('Final output:', extractText(creativeResult.outputs.synthesizer));

  await fred.shutdown();
}

main().catch((error) => {
  console.error('Graph workflow demo failed:', error);
  process.exitCode = 1;
});
