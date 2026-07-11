import { Layer } from 'effect';
import { FredAdminHandlersLive } from './admin';
import { FredMessageHandlersLive } from './message';
import { FredOpenAiHandlersLive } from './openai';

export const FredHttpHandlersLive = Layer.mergeAll(
  FredAdminHandlersLive,
  FredMessageHandlersLive,
  FredOpenAiHandlersLive,
);

export * from './admin';
export * from './message';
export * from './openai';
export * from './session';
export * from './sse';
