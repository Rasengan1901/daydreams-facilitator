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
export { createFacilitator, type FacilitatorConfig, type EvmSignerConfig, type SvmSignerConfig, type EvmSchemeType, type SvmSchemeType, type NetworkId, type FacilitatorHooks, } from "./factory.js";
export { x402Facilitator } from "@x402/core/facilitator";
export { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
export { toFacilitatorSvmSigner, type FacilitatorSvmSigner } from "@x402/svm";
export type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse, SupportedResponse, } from "@x402/core/types";
//# sourceMappingURL=lib.d.ts.map