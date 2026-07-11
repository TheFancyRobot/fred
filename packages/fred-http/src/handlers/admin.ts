import { HttpApiBuilder } from '@effect/platform';
import {
  AgentService,
  AgentStatusService,
  IntentMatcherService,
  ToolRegistryService,
} from '@fancyrobot/fred/effect';
import { Effect, Schema } from 'effect';
import { FredHttpApi } from '../api';
import { JsonValue } from '../api/schemas';

const toJson = Schema.decodeUnknown(JsonValue);

const jsonArray = (values: ReadonlyArray<unknown>) =>
  Effect.forEach(values, (value) =>
    toJson(value).pipe(
      Effect.catchTag('ParseError', () => Effect.succeed(String(value))),
    ),
  );

export const FredAdminHandlersLive = HttpApiBuilder.group(
  FredHttpApi,
  'admin',
  (handlers) =>
    handlers
      .handle('health', () =>
        Effect.map(Effect.clock, (clock) => ({
          status: 'ok' as const,
          timestamp: new Date(clock.unsafeCurrentTimeMillis()).toISOString(),
        })),
      )
      .handle('status', () =>
        Effect.gen(function* () {
          const status = yield* AgentStatusService;
          const data = yield* status.snapshot;
          return { success: true as const, data: [...data], count: data.length };
        }),
      )
      .handle('agents', () =>
        Effect.gen(function* () {
          const agents = yield* AgentService;
          const all = yield* agents.getAllAgents();
          const data = yield* jsonArray(all.map((agent) => ({ id: agent.id, config: agent.config })));
          return { success: true, data, count: data.length };
        }),
      )
      .handle('intents', () =>
        Effect.gen(function* () {
          const intents = yield* IntentMatcherService;
          const data = yield* jsonArray(yield* intents.getIntents());
          return { success: true, data, count: data.length };
        }),
      )
      .handle('tools', () =>
        Effect.gen(function* () {
          const registry = yield* ToolRegistryService;
          const tools = yield* registry.getAllTools();
          const data = yield* jsonArray(tools.map((tool) => ({
            id: tool.id,
            name: tool.name,
            description: tool.description,
            ...(tool.schema?.metadata === undefined ? {} : { schema: tool.schema.metadata }),
          })));
          return { success: true, data, count: data.length };
        }),
      ),
);

