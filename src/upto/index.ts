/**
 * Default Upto Module Instance
 *
 * This module creates a default upto module instance using the in-memory store.
 * It provides backward compatibility for existing code that imports
 * uptoStore and uptoSweeper directly.
 *
 * For custom store implementations, use createUptoModule() from the lib export:
 *
 * @example
 * ```typescript
 * import { createUptoModule } from "@daydreamsai/facilitator/upto";
 *
 * const upto = createUptoModule({
 *   store: new RedisUptoSessionStore(redisClient),
 *   facilitatorClient,
 * });
 * ```
 */

import { createUptoModule } from "./module.js";
import { localFacilitatorClient } from "../client.js";

// Create default module instance with in-memory store
const defaultModule = createUptoModule({
  facilitatorClient: localFacilitatorClient,
});

/**
 * Default in-memory session store.
 * @deprecated Use createUptoModule() for custom store implementations.
 */
export const uptoStore = defaultModule.store;

/**
 * Default sweeper plugin.
 * @deprecated Use createUptoModule() to create a sweeper with custom store.
 */
export const uptoSweeper = defaultModule.sweeper;
