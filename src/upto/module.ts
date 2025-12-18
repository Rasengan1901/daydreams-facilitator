/**
 * Upto Module Factory
 *
 * Creates an injectable upto module with configurable session store.
 * This allows users to provide custom store implementations (Redis, PostgreSQL, etc.)
 * instead of being locked into the in-memory default.
 *
 * @example
 * ```typescript
 * import { createUptoModule, InMemoryUptoSessionStore } from "@daydreamsai/facilitator/upto";
 *
 * // Default in-memory store
 * const upto = createUptoModule({ facilitatorClient });
 *
 * // Custom Redis store
 * const redisStore = new RedisUptoSessionStore(redisClient);
 * const upto = createUptoModule({ store: redisStore, facilitatorClient });
 *
 * // Use in Elysia app
 * app.use(upto.sweeper);
 *
 * // Access store for session management
 * const session = upto.store.get(sessionId);
 * ```
 */

import { InMemoryUptoSessionStore, type UptoSessionStore } from "./store.js";
import { createUptoSweeper, type UptoSweeperConfig } from "./sweeper.js";
import { settleUptoSession, type UptoFacilitatorClient } from "./settlement.js";

export interface UptoModuleConfig {
  /**
   * Session store implementation.
   * Defaults to InMemoryUptoSessionStore if not provided.
   *
   * Implement UptoSessionStore interface for custom persistence:
   * - RedisUptoSessionStore for distributed deployments
   * - PostgresUptoSessionStore for durable persistence
   */
  store?: UptoSessionStore;

  /**
   * Facilitator client for settling payments.
   * Required for the sweeper to auto-settle sessions.
   */
  facilitatorClient: UptoFacilitatorClient;

  /**
   * Sweeper configuration options.
   * See UptoSweeperConfig for available options.
   */
  sweeperConfig?: Omit<UptoSweeperConfig, "store" | "facilitatorClient">;
}

export interface UptoModule {
  /**
   * The session store instance.
   * Use this to manage sessions (get, set, delete).
   */
  store: UptoSessionStore;

  /**
   * Elysia plugin for automatic session sweeping.
   * Monitors sessions and triggers settlements based on idle time,
   * deadline proximity, and cap thresholds.
   */
  sweeper: ReturnType<typeof createUptoSweeper>;

  /**
   * Manually settle a session.
   * Useful for immediate settlement outside of the sweeper cycle.
   */
  settleSession: (
    sessionId: string,
    reason: string,
    closeAfter?: boolean
  ) => Promise<void>;
}

/**
 * Creates an upto module with injectable dependencies.
 *
 * This factory enables:
 * - Custom session store implementations for production scaling
 * - Configurable sweeper behavior
 * - Testable components with mock dependencies
 */
export function createUptoModule(config: UptoModuleConfig): UptoModule {
  const store = config.store ?? new InMemoryUptoSessionStore();

  const sweeper = createUptoSweeper({
    store,
    facilitatorClient: config.facilitatorClient,
    ...config.sweeperConfig,
  });

  const settleSession = async (
    sessionId: string,
    reason: string,
    closeAfter = false
  ) => {
    await settleUptoSession(
      store,
      config.facilitatorClient,
      sessionId,
      reason,
      closeAfter
    );
  };

  return {
    store,
    sweeper,
    settleSession,
  };
}
