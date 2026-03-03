import { Fred } from '@fancyrobot/fred';
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
  const fred = await Fred.create();

  // Calculator is a built-in Fred tool, registered by default.
  console.log('Calculator tool available:', Boolean(fred.getTool('calculator')));

  // Register custom tool defined with Effect Schema.
  fred.registerTool(weatherTool as Tool);
  await fred.initializeFromConfig('./config.yaml');

  console.log('--- Weather Query ---');
  const weatherResponse = await fred.processMessage('What is the weather in Tokyo right now?');
  console.log('Response:', weatherResponse?.content);

  console.log('\n--- Calculator Query ---');
  const calcResponse = await fred.processMessage('What is 42 * 17 + 3? Use the calculator tool.');
  console.log('Response:', calcResponse?.content);

  await fred.shutdown();
}

main().catch(console.error);
