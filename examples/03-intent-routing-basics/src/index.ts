import { Fred } from '@fancyrobot/fred';
import type { Intent } from '@fancyrobot/fred';

type TranscriptMatch =
  | { type: 'exact'; intentId: string; matchedUtterance: string }
  | { type: 'regex'; intentId: string; matchedPattern: string }
  | { type: 'default'; reason: string };

function buildIntentTranscript(message: string, intents: Intent[]): TranscriptMatch {
  const normalizedMessage = message.toLowerCase().trim();

  for (const intent of intents) {
    for (const utterance of intent.utterances) {
      if (normalizedMessage === utterance.toLowerCase().trim()) {
        return {
          type: 'exact',
          intentId: intent.id,
          matchedUtterance: utterance,
        };
      }
    }
  }

  for (const intent of intents) {
    for (const utterance of intent.utterances) {
      try {
        const regex = new RegExp(utterance, 'i');
        if (regex.test(message)) {
          return {
            type: 'regex',
            intentId: intent.id,
            matchedPattern: utterance,
          };
        }
      } catch {
        // Ignore invalid regex-like utterances for transcript generation.
      }
    }
  }

  return {
    type: 'default',
    reason: 'No exact or regex intent match; default agent selected.',
  };
}

async function main() {
  const fred = await Fred.create();
  await fred.registerProviderPack('openai');

  await fred.createAgent({
    id: 'billing',
    systemMessage: 'You are a billing specialist. Help with invoices, payments, refunds, and subscriptions.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  await fred.createAgent({
    id: 'tech-support',
    systemMessage: 'You are a technical support specialist. Help with bugs, crashes, and troubleshooting.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  await fred.createAgent({
    id: 'general',
    systemMessage: 'You are a general customer service specialist. Help with broad business questions.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  const intents: Intent[] = [
    {
      id: 'billing-intent',
      description: 'Billing and payment questions',
      utterances: ['invoice', 'payment', 'billing', 'refund|charge|subscription'],
      action: { type: 'agent', target: 'billing' },
    },
    {
      id: 'tech-intent',
      description: 'Technical support questions',
      utterances: ['bug', 'error', 'crash', 'not working', 'fix|broken|issue'],
      action: { type: 'agent', target: 'tech-support' },
    },
  ];

  fred.registerIntents(intents);
  fred.setDefaultAgent('general');

  const testMessages = [
    'I need a refund for my last invoice',
    'The app keeps crashing when I open it',
    'What are your business hours?',
    'My subscription charge is wrong',
  ];

  for (const message of testMessages) {
    console.log(`\n--- Message: "${message}" ---`);

    const route = await fred.routeMessage(message);
    console.log('Routed to agent:', route.agentId ?? 'none');
    console.log('Route type:', route.type);
    console.log('Route result:', JSON.stringify(route, null, 2));

    const transcript = buildIntentTranscript(message, intents);
    if (transcript.type === 'exact') {
      console.log(
        `Transcript: exact intent match on "${transcript.matchedUtterance}" -> ${transcript.intentId}`
      );
    } else if (transcript.type === 'regex') {
      console.log(`Transcript: regex intent match /${transcript.matchedPattern}/i -> ${transcript.intentId}`);
    } else {
      console.log(`Transcript: ${transcript.reason}`);
    }

    const response = await fred.processMessage(message);
    const preview = response?.content?.slice(0, 100) ?? '(no response)';
    console.log('Response preview:', `${preview}...`);
  }

  await fred.shutdown();
}

main().catch(console.error);
