/**
 * @x402/facilitator/upto - Upto (batched payment) scheme components
 *
 * This module exports components for implementing the "upto" payment scheme,
 * which allows batched payments with a pre-authorized spending cap.
 *
 * @example
 * ```typescript
 * import {
 *   InMemoryUptoSessionStore,
 *   createUptoSweeper,
 *   settleUptoSession,
 * } from "@x402/facilitator/upto";
 *
 * const store = new InMemoryUptoSessionStore();
 * const sweeper = createUptoSweeper({ store, facilitatorClient });
 * ```
 */
export { InMemoryUptoSessionStore, type UptoSessionStore, type UptoSession, type UptoSessionStatus, } from "./store.js";
export { settleUptoSession, type UptoFacilitatorClient, } from "./settlement.js";
export { createUptoSweeper, type UptoSweeperConfig, } from "./sweeper.js";
//# sourceMappingURL=lib.d.ts.map