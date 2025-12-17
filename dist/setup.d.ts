/**
 * Default Facilitator Setup - Application-specific with side effects
 *
 * This module creates a default facilitator instance based on environment
 * configuration. It has side effects and should only be imported by the
 * CLI server, not by library consumers.
 *
 * Library consumers should use createFacilitator() from the main export instead.
 */
export * from "./factory.js";
/**
 * Default facilitator instance using environment-configured signers.
 * Uses CDP signer if CDP credentials are provided, otherwise falls back to private keys.
 * For custom signers, use createFacilitator() instead.
 */
export declare const facilitator: import("@x402/core/facilitator").x402Facilitator;
//# sourceMappingURL=setup.d.ts.map