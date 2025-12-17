/**
 * Facilitator Factory - Pure library code with no side effects
 *
 * This module provides the createFacilitator factory and associated types.
 * It can be safely imported without triggering any initialization.
 */
import type { FacilitatorEvmSigner } from "@x402/evm";
import type { FacilitatorSvmSigner } from "@x402/svm";
import { x402Facilitator } from "@x402/core/facilitator";
export type EvmSchemeType = "exact" | "upto";
export type SvmSchemeType = "exact";
/** CAIP-2 network identifier (e.g., "eip155:8453", "solana:...") */
export type NetworkId = `${string}:${string}`;
export interface EvmSignerConfig {
    /** The EVM signer instance (use toFacilitatorEvmSigner to create one) */
    signer: FacilitatorEvmSigner;
    /** Network(s) to register - CAIP-2 format (e.g., "eip155:8453") */
    networks: NetworkId | NetworkId[];
    /** Which schemes to register for this signer. Defaults to ["exact", "upto"] */
    schemes?: EvmSchemeType[];
    /** Enable ERC-4337 with EIP-6492 signature validation */
    deployERC4337WithEIP6492?: boolean;
}
export interface SvmSignerConfig {
    /** The SVM signer instance (use toFacilitatorSvmSigner to create one) */
    signer: FacilitatorSvmSigner;
    /** Network(s) to register - CAIP-2 format (e.g., "solana:...") */
    networks: NetworkId | NetworkId[];
    /** Which schemes to register for this signer. Defaults to ["exact"] */
    schemes?: SvmSchemeType[];
}
export interface FacilitatorHooks {
    onBeforeVerify?: (ctx: unknown) => Promise<void>;
    onAfterVerify?: (ctx: unknown) => Promise<void>;
    onVerifyFailure?: (ctx: unknown) => Promise<void>;
    onBeforeSettle?: (ctx: unknown) => Promise<void>;
    onAfterSettle?: (ctx: unknown) => Promise<void>;
    onSettleFailure?: (ctx: unknown) => Promise<void>;
}
export interface FacilitatorConfig {
    /** EVM signer configurations */
    evmSigners?: EvmSignerConfig[];
    /** SVM signer configurations */
    svmSigners?: SvmSignerConfig[];
    /** Lifecycle hooks for custom logic */
    hooks?: FacilitatorHooks;
}
/**
 * Creates a configured x402 Facilitator with injected signers.
 *
 * @example
 * ```typescript
 * import { createFacilitator } from "@x402/facilitator";
 * import { createCdpEvmSigner } from "@x402/facilitator/signers/cdp";
 *
 * const signer = createCdpEvmSigner({ ... });
 * const facilitator = createFacilitator({
 *   evmSigners: [{
 *     signer,
 *     networks: ["eip155:8453", "eip155:10"],
 *     schemes: ["exact", "upto"],
 *   }],
 *   hooks: {
 *     onAfterSettle: async (ctx) => analytics.track("settlement", ctx),
 *   },
 * });
 * ```
 */
export declare function createFacilitator(config: FacilitatorConfig): x402Facilitator;
//# sourceMappingURL=factory.d.ts.map