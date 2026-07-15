import { HttpApi, HttpApiBuilder, HttpApiSwagger, OpenApi } from '@effect/platform';
import { FredAdminApi } from './api/admin';
import { FredMessageApi } from './api/message';
import { FredOpenAiApi } from './api/openai';

export const FRED_OPENAPI_PATH = '/docs/openapi.json';
export const FRED_DOCS_PATH = '/docs';

export const FredHttpApi = HttpApi.make('FredHttpApi')
  .add(FredAdminApi)
  .add(FredOpenAiApi)
  .add(FredMessageApi)
  .annotate(OpenApi.Title, 'Fred HTTP API')
  .annotate(OpenApi.Version, '1.0.0')
  .annotate(OpenApi.Description, 'HTTP contracts for Fred agents, status, and chat.')
  .annotate(OpenApi.Transform, (spec) => ({
    ...spec,
    components: {
      ...spec.components,
      securitySchemes: {
        ...spec.components.securitySchemes,
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  }));

export const FredOpenApiSpec = OpenApi.fromApi(FredHttpApi);
export const FredOpenApiLayer = HttpApiBuilder.middlewareOpenApi({ path: FRED_OPENAPI_PATH });
export const FredDocsLayer = HttpApiSwagger.layer({ path: FRED_DOCS_PATH });

export * from './api/admin';
export * from './api/errors';
export * from './api/message';
export * from './api/openai';
export * from './api/schemas';
