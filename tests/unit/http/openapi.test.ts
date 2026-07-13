import { describe, expect, it } from 'bun:test';
import {
  FRED_DOCS_PATH,
  FRED_OPENAPI_PATH,
  FredDocsLayer,
  FredOpenApiLayer,
  FredOpenApiSpec,
} from '../../../packages/fred-http/src/api';

const expectedOperations = {
  '/agents': 'admin.agents',
  '/chat': 'message.chat',
  '/health': 'admin.health',
  '/intents': 'admin.intents',
  '/message': 'message.message',
  '/status': 'admin.status',
  '/tools': 'admin.tools',
  '/v1/chat/completions': 'openai.chatCompletions',
} as const;

describe('Fred OpenAPI surface', () => {
  it('contains every built-in method and path exactly once', () => {
    expect(Object.keys(FredOpenApiSpec.paths).sort()).toEqual(Object.keys(expectedOperations).sort());
    for (const [path, operationId] of Object.entries(expectedOperations)) {
      const operations = Object.values(FredOpenApiSpec.paths[path] ?? {});
      expect(operations).toHaveLength(1);
      expect(operations[0]?.operationId).toBe(operationId);
    }
  });

  it('documents auth, session headers, and streaming transport', () => {
    expect(FredOpenApiSpec.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
    });
    const completion = FredOpenApiSpec.paths['/v1/chat/completions']?.post;
    expect(completion?.parameters.some((parameter) =>
      parameter.in === 'header' && parameter.name === 'x-session-id'
    )).toBe(true);
    expect(completion?.responses[200]?.headers?.['X-Session-Id']).toBeDefined();
    expect(completion?.responses[200]?.content?.['text/event-stream']).toBeDefined();
    expect(completion?.security).toEqual([{ bearerAuth: [] }]);
    const requestSchema = FredOpenApiSpec.components.schemas.ChatCompletionRequest;
    expect(requestSchema && 'properties' in requestSchema
      ? requestSchema.properties.conversation_id
      : undefined).toBeUndefined();
  });

  it('exports mountable docs layers at the stable paths', () => {
    expect(FRED_OPENAPI_PATH).toBe('/docs/openapi.json');
    expect(FRED_DOCS_PATH).toBe('/docs');
    expect(FredOpenApiLayer).toBeDefined();
    expect(FredDocsLayer).toBeDefined();
  });

  it('keeps the complete generated document deterministic', () => {
    expect(FredOpenApiSpec).toMatchSnapshot();
  });
});
