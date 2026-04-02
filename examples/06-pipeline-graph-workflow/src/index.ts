import { Fred, GraphWorkflowBuilder } from '@fancyrobot/fred';
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
  const fred = await Fred.create();
  await fred.initializeFromConfig('./config.yaml');

  const workflow = new GraphWorkflowBuilder('research-flow')
    .addNode('classifier', { type: 'agent', agentId: 'classifier', expose: ['content'] })
    .addNode('routeByIntent', {
      type: 'conditional',
      condition: (ctx) => {
        const classifierText = extractText(ctx.outputs.classifier).toLowerCase();
        return classifierText.includes('factual');
      },
      expose: ['conditionResult'],
    })
    .addNode('researcher', { type: 'agent', agentId: 'researcher', expose: ['content'] })
    .addNode('ideator', { type: 'agent', agentId: 'ideator', expose: ['content'] })
    .addNode('synthesizer', { type: 'agent', agentId: 'synthesizer', expose: ['content'] })
    .addEdge('classifier', 'routeByIntent')
    .addEdge('routeByIntent', 'researcher', {
      condition: {
        field: 'routeByIntent.conditionResult',
        operator: 'equals',
        value: true,
      },
    })
    .setDefaultEdge('routeByIntent', 'ideator')
    .addEdge('researcher', 'synthesizer')
    .addEdge('ideator', 'synthesizer')
    .setEntry('classifier')
    .build();

  fred.registerGraphWorkflow(workflow);

  console.log('=== Graph Workflow Demo: Branching Research Flow ===\n');

  console.log('--- Factual Question ---');
  const factualResult = await fred.executeGraphWorkflow(
    'research-flow',
    'What causes the northern lights?'
  );
  console.log('Executed nodes:', factualResult.executedNodes.join(' -> '));
  console.log('Final output:', extractText(factualResult.outputs.synthesizer));

  console.log('\n--- Creative Question ---');
  const creativeResult = await fred.executeGraphWorkflow(
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
