/**
 * @x402/facilitator - x402 Payment Facilitator Library
 *
 * This module exports the core facilitator setup and types for building
 * x402 payment facilitators with custom signers.
 *
 * @example
 * ```typescript
 * import { createFacilitator } from "@x402/facilitator";
 * import { createCdpEvmSigner } from "@x402/facilitator/signers/cdp";
 *
 * const signer = createCdpEvmSigner({ ... });
 * const facilitator = createFacilitator({
 *   evmSigners: [{ signer, networks: "eip155:8453" }],
 * });
 * ```
 */
// Core facilitator factory and types
export { createFacilitator, } from "./factory.js";
// Re-export x402Facilitator class for advanced use cases
export { x402Facilitator } from "@x402/core/facilitator";
// Re-export signer utilities from @x402/evm
export { toFacilitatorEvmSigner } from "@x402/evm";
// Re-export signer utilities from @x402/svm
export { toFacilitatorSvmSigner } from "@x402/svm";
//# sourceMappingURL=lib.js.map