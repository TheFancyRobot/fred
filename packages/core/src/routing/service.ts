/**
 * Effect service for MessageRouter
 *
 * This service provides an Effect-native interface wrapping the
 * MessageRouter class.
 */

import { Context, Effect, Layer } from 'effect';
import { MessageRouter } from './router';
import type { RoutingDecision } from './types';
import type { NoAgentsAvailableError } from './errors';

/**
 * MessageRouterService interface
 */
export interface MessageRouterService {
  route(
    message: string,
    metadata?: Record<string, unknown>
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError>;

  testRoute(
    message: string,
    metadata?: Record<string, unknown>
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError>;
}

export const MessageRouterService = Context.GenericTag<MessageRouterService>(
  'MessageRouterService'
);

/**
 * MessageRouterService implementation using MessageRouter
 */
class MessageRouterServiceImpl implements MessageRouterService {
  constructor(private router: MessageRouter) {}

  route(
    message: string,
    metadata: Record<string, unknown> = {}
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError> {
    return this.router.route(message, metadata);
  }

  testRoute(
    message: string,
    metadata: Record<string, unknown> = {}
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError> {
    return this.router.testRoute(message, metadata);
  }
}

