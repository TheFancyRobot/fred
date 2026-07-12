import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';
import { billingAgentConfig, type RefundRequest } from './typed-agent';

async function main() {
  const fred = await createFred();
  try {
    await fred.providers.use('openrouter', {
      modelDefaults: { model: 'openrouter/free' },
    });

    const agent = await fred.agents.register(billingAgentConfig);
    const request = {
      customerId: 'cust_123',
      subscriptionId: 'sub_pro_2026',
      reason: 'The subscription renewed after cancellation.',
    } satisfies RefundRequest;

    const response = await fred.effects.run(agent.run(request));
    console.log('Validated refund decision:', response.output);
  } finally {
    await fred.shutdown();
  }
}

main().catch(console.error);
