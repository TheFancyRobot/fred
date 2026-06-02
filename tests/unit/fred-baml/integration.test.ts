import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { Fred } from '../../../packages/core/src/index';
import { BamlAgent, createBamlTool, initFredBamlRuntime } from '../../../packages/fred-baml/src/index';

interface StubBamlClient {
  readonly SummarizeSong: (input: { readonly title: string; readonly lyrics: string }) => Promise<string>;
}

function isStubBamlClient(client: unknown): client is StubBamlClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    'SummarizeSong' in client &&
    typeof client.SummarizeSong === 'function'
  );
}

describe('fred-baml integration', () => {
  test('registers and executes a BAML-backed tool through Fred', async () => {
    const runtime = initFredBamlRuntime({
      moduleId: 'tests/unit/fred-baml/fixtures/baml_client.stub',
      loadClient: () => import('./fixtures/baml_client.stub'),
    });

    const tool = createBamlTool({
      id: BamlAgent.toolId('summarizeSong'),
      description: 'Summarize a song using a generated BAML client',
      inputSchema: Schema.Struct({
        title: Schema.String,
        lyrics: Schema.String,
      }),
      successSchema: Schema.String,
      runtime,
      execute: async (input, activeRuntime) => {
        const client = await activeRuntime.loadClient();
        if (!isStubBamlClient(client)) {
          throw new Error('Stub BAML client did not expose SummarizeSong');
        }

        return client.SummarizeSong(input);
      },
    });

    const fred = await Fred.create();
    fred.registerTool(tool);

    const registeredTool = fred.getTool(BamlAgent.toolId('summarizeSong'));

    expect(registeredTool).toBeDefined();
    await expect(registeredTool?.execute({ title: 'Evergreen', lyrics: 'la la la' })).resolves.toBe(
      'summary:Evergreen:8',
    );
  });
});
