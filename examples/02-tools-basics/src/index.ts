import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';
import type { Tool } from '@fancyrobot/fred';
import { Schema } from 'effect';

const weatherTool: Tool<{ readonly city: string }, string> = {
  id: 'get-weather',
  name: 'get-weather',
  description: 'Get current weather for a city',
  schema: {
    input: Schema.Struct({ city: Schema.String }),
    success: Schema.String,
    metadata: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
      },
      required: ['city'],
    },
  },
  execute: async ({ city }) => {
    const conditions = ['Sunny', 'Cloudy', 'Rainy', 'Snowy'];
    const temp = Math.floor(Math.random() * 30) + 5;
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    return `Weather in ${city}: ${condition}, ${temp}C`;
  },
};

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  // Calculator is a built-in Fred tool, registered by default.
  console.log(
    'Calculator tool available:',
    (await fred.tools.list()).some((tool) => tool.id === 'calculator')
  );

  // Register custom tool defined with Effect Schema.
  await fred.tools.register(weatherTool);

  // Config-first construction resolves declared tools while agents load.
  // Re-register this agent after adding the application-defined weather tool.
  const toolUser = await fred.agents.get('tool-user');
  if (!toolUser) {
    throw new Error('Configured tool-user agent not found');
  }
  await fred.agents.remove(toolUser.id);
  await fred.agents.register({
    ...toolUser.config,
    tools: ['calculator', weatherTool.id],
  });

  console.log('--- Weather Query ---');
  const weatherResponse = await fred.messages.process('What is the weather in Tokyo right now?');
  console.log('Response:', weatherResponse?.content);

  console.log('\n--- Calculator Query ---');
  const calcResponse = await fred.messages.process('What is 42 * 17 + 3? Use the calculator tool.');
  console.log('Response:', calcResponse?.content);

  await fred.shutdown();
}

main().catch(console.error);
