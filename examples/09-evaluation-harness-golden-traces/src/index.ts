import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';
import { Effect } from 'effect';
import { billingAgentConfig, type RefundRequest } from './typed-agent';

async function main() {
  const fred = await Fred.create();
  try {
    await fred.useProvider('openrouter', {
      modelDefaults: { model: 'openrouter/free' },
    });

    const agent = await fred.registerAgent(billingAgentConfig);
    const request = {
      customerId: 'cust_123',
      subscriptionId: 'sub_pro_2026',
      reason: 'The subscription renewed after cancellation.',
    } satisfies RefundRequest;

    const response = await Effect.runPromise(agent.run(request));
    console.log('Validated refund decision:', response.output);
  } finally {
    await fred.shutdown();
  }
}

main().catch(console.error);
