import { Effect, Redacted } from 'effect';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as HttpBody from '@effect/platform/HttpBody';
import { registerBuiltinPack } from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';

const decoder = new TextDecoder();

/**
 * Patch Responses API request bodies for OpenRouter compatibility.
 *
 * @effect/ai-openai v0.37.x uses the OpenAI Responses API exclusively
 * (POST /responses). It emits assistant-role items in the `input[]` array
 * without the `type: "message"` discriminator that OpenRouter requires.
 * OpenAI's API is lenient about this, but OpenRouter validates strictly.
 *
 * This transform intercepts outgoing requests, parses JSON bodies that
 * contain an `input` array, and adds `type: "message"` to any item that
 * has a `role` field (user/assistant/system/developer) but is missing `type`.
 *
 * TODO: Replace this workaround with the native OpenRouter SDK
 * (@openrouter/ai-sdk-provider or similar) once it supports Effect
 * integration, so we don't depend on @effect/ai-openai's Responses API
 * format at all.
 */
function patchResponsesApiBody(body: unknown): unknown {
  if (
    body == null ||
    typeof body !== 'object' ||
    !Array.isArray((body as Record<string, unknown>).input)
  ) {
    return body;
  }
  const obj = body as Record<string, unknown>;
  obj.input = (obj.input as unknown[]).map((item) => {
    if (
      item != null &&
      typeof item === 'object' &&
      'role' in item &&
      !('type' in item)
    ) {
      return { type: 'message', ...item };
    }
    return item;
  });
  return obj;
}

/**
 * OpenRouter provider pack factory.
 * Uses OpenAI-compatible API via @effect/ai-openai with OpenRouter's baseUrl.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. Uses dynamic import to avoid hard dependency.
 */
export const OpenRouterProviderFactory: EffectProviderFactory = {
  id: 'openrouter',
  aliases: ['openrouter'],
  load: async (config: ProviderConfig) => {
    // Dynamic import to avoid hard dependency (uses OpenAI-compatible API)
    let module: typeof import('@effect/ai-openai');
    try {
      module = await import('@effect/ai-openai');
    } catch (error) {
      throw new Error(
        `Failed to load @effect/ai-openai. Install it with: bun add @effect/ai-openai`
      );
    }

    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'OPENROUTER_API_KEY';
    const apiKeyString = process.env[apiKeyEnvVar];
    const apiKey = apiKeyString ? Redacted.make(apiKeyString) : undefined;
    const apiUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';

    // Use OpenAiClient.layer for client initialization
    const layer = module.OpenAiClient?.layer?.({
      apiKey,
      apiUrl,
      transformClient: (client) =>
        HttpClient.mapRequest(client, (request) => {
          if (request.method !== 'POST' || !request.body || request.body._tag !== 'Uint8Array') {
            return request;
          }
          try {
            const json = JSON.parse(decoder.decode(request.body.body));
            const patched = patchResponsesApiBody(json);
            return HttpClientRequest.setBody(
              request,
              HttpBody.unsafeJson(patched),
            );
          } catch {
            return request;
          }
        }),
    });

    if (!layer) {
      throw new Error('OpenRouter provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.OpenAiLanguageModel?.model) {
          return Effect.fail(new Error('OpenRouter LanguageModel not available in provider pack'));
        }
        return Effect.succeed(
          module.OpenAiLanguageModel.model(modelId, {
            temperature: overrides?.temperature,
            max_output_tokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

// Auto-register when imported
registerBuiltinPack(OpenRouterProviderFactory);

export { OpenRouterProviderFactory as openrouterPack };
export default OpenRouterProviderFactory;
