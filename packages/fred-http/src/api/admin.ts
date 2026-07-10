import { HttpApiEndpoint, HttpApiGroup, OpenApi } from '@effect/platform';
import { AgentStatusResponse, HealthResponse, ListResponse } from './schemas';

export const FredAdminApi = HttpApiGroup.make('admin')
  .add(
    HttpApiEndpoint.get('health', '/health').addSuccess(HealthResponse)
      .annotate(OpenApi.Transform, (operation) => ({ ...operation, security: [{ bearerAuth: [] }] }))
  )
  .add(
    HttpApiEndpoint.get('status', '/status').addSuccess(AgentStatusResponse)
      .annotate(OpenApi.Transform, (operation) => ({ ...operation, security: [{ bearerAuth: [] }] }))
  )
  .add(
    HttpApiEndpoint.get('agents', '/agents').addSuccess(ListResponse)
      .annotate(OpenApi.Transform, (operation) => ({ ...operation, security: [{ bearerAuth: [] }] }))
  )
  .add(
    HttpApiEndpoint.get('intents', '/intents').addSuccess(ListResponse)
      .annotate(OpenApi.Transform, (operation) => ({ ...operation, security: [{ bearerAuth: [] }] }))
  )
  .add(
    HttpApiEndpoint.get('tools', '/tools').addSuccess(ListResponse)
      .annotate(OpenApi.Transform, (operation) => ({ ...operation, security: [{ bearerAuth: [] }] }))
  );
