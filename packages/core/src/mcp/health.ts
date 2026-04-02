import { Duration, Effect, Either } from 'effect';
import type { MCPServerRegistry } from './registry';

/**
 * Health check and auto-restart manager for MCP servers.
 *
 * Provides:
 * - Periodic health checks at configurable intervals
 * - Auto-restart with exponential backoff on connection loss
 * - Tool re-discovery after successful reconnection
 */
export class MCPHealthManager {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private retryState: Map<string, { attempts: number; maxRetries: number }> =
    new Map();
  private reconnectInFlight: Map<string, Promise<boolean>> = new Map();

  /**
   * Start periodic health check for a server.
   *
   * Checks client.isConnected() at specified interval and triggers
   * reconnect if disconnected.
   *
   * @param registry - MCP server registry
   * @param serverId - Server identifier
   * @param intervalMs - Health check interval in milliseconds
   */
  startHealthCheck(
    registry: MCPServerRegistry,
    serverId: string,
    intervalMs: number
  ): void {
    // Stop any existing health check for this server
    this.stopHealthCheck(serverId);

    const timer = setInterval(async () => {
      const client = registry.getClient(serverId);
      if (!client) {
        // Server not registered, stop health check
        this.stopHealthCheck(serverId);
        return;
      }

      // Check connection status
      if (!client.isConnected()) {
        // Client disconnected, attempt reconnect
        await this.reconnectServer(registry, serverId);
      }
    }, intervalMs);

    this.timers.set(serverId, timer);
  }

  /**
   * Stop health check for a specific server.
   *
   * @param serverId - Server identifier
   */
  stopHealthCheck(serverId: string): void {
    const timer = this.timers.get(serverId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(serverId);
    }
  }

  /**
   * Stop all health checks.
   */
  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.retryState.clear();
    this.reconnectInFlight.clear();
  }

  /**
   * Attempt to reconnect a server with exponential backoff.
   *
   * Backoff schedule: 1s, 2s, 4s (configurable max retries)
   *
   * On success: Updates status to 'connected', re-discovers tools
   * On failure: Updates status to 'error', stops health check
   *
   * @param registry - MCP server registry
   * @param serverId - Server identifier
   * @param maxRetries - Maximum reconnection attempts (default: 3)
   * @returns Promise resolving to true if reconnect succeeded, false otherwise
   */
  async reconnectServer(
    registry: MCPServerRegistry,
    serverId: string,
    maxRetries: number = 3
  ): Promise<boolean> {
    const inFlight = this.reconnectInFlight.get(serverId);
    if (inFlight) {
      return inFlight;
    }

    const reconnectPromise = this.reconnectServerInternal(registry, serverId, maxRetries).finally(() => {
      this.reconnectInFlight.delete(serverId);
    });

    this.reconnectInFlight.set(serverId, reconnectPromise);
    return reconnectPromise;
  }

  private async reconnectServerInternal(
    registry: MCPServerRegistry,
    serverId: string,
    maxRetries: number
  ): Promise<boolean> {
    return Effect.runPromise(
      this.reconnectServerEffect(registry, serverId, maxRetries)
    );
  }

  private reconnectServerEffect(
    registry: MCPServerRegistry,
    serverId: string,
    maxRetries: number
  ): Effect.Effect<boolean> {
    return Effect.gen(this, function* () {
      const client = registry.getClient(serverId);
      if (!client) {
        yield* Effect.sync(() => {
          console.warn(`Cannot reconnect - server '${serverId}' not found`);
        });
        return false;
      }

      if (!this.retryState.has(serverId)) {
        this.retryState.set(serverId, { attempts: 0, maxRetries });
      }

      const state = this.retryState.get(serverId)!;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        state.attempts = attempt + 1;

        const initializeResult = yield* Effect.either(
          Effect.tryPromise({
            try: () => client.initialize(),
            catch: (error) => error,
          })
        );

        if (Either.isRight(initializeResult)) {
          registry.updateServerStatus(serverId, 'connected');

          yield* registry.discoverTools(serverId).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                console.warn(
                  `Failed to re-discover tools after reconnect for '${serverId}':`,
                  error instanceof Error ? error.message : String(error)
                );
              })
            )
          );

          this.retryState.delete(serverId);

          if (process.env.NODE_ENV !== 'test') {
            yield* Effect.sync(() => {
              console.log(`Server '${serverId}' reconnected successfully`);
            });
          }

          return true;
        }

        const error = initializeResult.left;
        const attemptNum = attempt + 1;

        if (process.env.NODE_ENV !== 'test') {
          yield* Effect.sync(() => {
            console.warn(
              `Reconnect attempt ${attemptNum}/${maxRetries} failed for '${serverId}':`,
              error instanceof Error ? error.message : String(error)
            );
          });
        }

        if (attempt < maxRetries - 1) {
          const backoffMs = 1000 * Math.pow(2, attempt);
          if (process.env.NODE_ENV !== 'test') {
            yield* Effect.sync(() => {
              console.log(`Waiting ${backoffMs}ms before retry...`);
            });
          }
          yield* Effect.sleep(Duration.millis(backoffMs));
        }
      }

      registry.updateServerStatus(serverId, 'error');
      this.stopHealthCheck(serverId);
      this.retryState.delete(serverId);

      if (process.env.NODE_ENV !== 'test') {
        yield* Effect.sync(() => {
          console.error(
            `Server '${serverId}' failed to reconnect after ${maxRetries} attempts`
          );
        });
      }

      return false;
    });
  }
}
