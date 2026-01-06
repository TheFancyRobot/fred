import { Fred } from '../../src/index';
import { Tool } from '../../src/core/tool/tool';
import { Intent } from '../../src/core/intent/intent';

/**
 * Basic usage example
 */
async function main() {
  // Create framework instance
  const fred = new Fred();

  // Use providers with .useProvider() syntax
  // Option 1: Use with explicit API keys (note: .useProvider() is async)
  // const groq = await fred.useProvider('groq', { apiKey: 'your-groq-api-key' });
  // const openai = await fred.useProvider('openai', { apiKey: 'your-openai-api-key' });
  
  // Option 2: Register default providers (uses environment variables)
  // Make sure to set OPENAI_API_KEY or GROQ_API_KEY environment variables
  fred.registerDefaultProviders();

  // Define a tool
  const calculatorTool: Tool = {
    id: 'calculator',
    name: 'calculator',
    description: 'Perform basic arithmetic operations',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'The operation to perform (add, subtract, multiply, divide)',
          enum: ['add', 'subtract', 'multiply', 'divide'],
        },
        a: {
          type: 'number',
          description: 'First number',
        },
        b: {
          type: 'number',
          description: 'Second number',
        },
      },
      required: ['operation', 'a', 'b'],
    },
    execute: async (args) => {
      const { operation, a, b } = args;
      switch (operation) {
        case 'add':
          return a + b;
        case 'subtract':
          return a - b;
        case 'multiply':
          return a * b;
        case 'divide':
          if (b === 0) throw new Error('Division by zero');
          return a / b;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    },
  };

  // Register the tool
  fred.registerTool(calculatorTool);

  // Create an agent
  await fred.createAgent({
    id: 'math-assistant',
    systemMessage: 'You are a helpful math assistant. Use the calculator tool when needed.',
    platform: 'openai',
    model: 'gpt-4',
    tools: ['calculator'],
  });

  // Define an intent
  const mathIntent: Intent = {
    id: 'math-question',
    utterances: [
      'calculate',
      'compute',
      'what is',
      'solve',
      'math',
    ],
    action: {
      type: 'agent',
      target: 'math-assistant',
    },
  };

  // Register the intent
  fred.registerIntent(mathIntent);

  // Process a message
  console.log('Processing message: "What is 15 + 27?"');
  const response = await fred.processMessage('What is 15 + 27?');
  
  if (response) {
    console.log('Response:', response.content);
    if (response.toolCalls) {
      console.log('Tool calls:', response.toolCalls);
    }
  } else {
    console.log('No intent matched');
  }
}

// Run the example
// @ts-ignore - Bun global
if (import.meta.main) {
  main().catch(console.error);
}

