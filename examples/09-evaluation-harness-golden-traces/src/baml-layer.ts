import { makeFredRuntimeLayer } from '@fancyrobot/fred';
import { BamlPromptSourceLayer } from '@fancyrobot/fred-baml';

/**
 * A real application can delegate this renderer to its generated BAML client.
 * This deterministic renderer keeps the example self-contained and offline.
 */
export const promptSourceLayer = BamlPromptSourceLayer(
  ({ functionName, input }) => {
    if (functionName !== 'BuildBillingPrompt') {
      throw new Error(`Unknown BAML prompt function: ${functionName}`);
    }

    const reason =
      typeof input === 'object' && input !== null && 'reason' in input
        ? String(input.reason)
        : 'unspecified';

    return `Apply the billing refund policy to this reason: ${reason}`;
  },
);

export const bamlFredRuntimeLayer = makeFredRuntimeLayer({
  promptSourceLayer,
});
