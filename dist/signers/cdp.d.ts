/**
 * CDP (Coinbase Developer Platform) Signer Adapter
 *
 * This module provides an adapter to use CDP SDK accounts as x402 facilitator signers.
 */
import type { CdpClient, EvmServerAccount } from "@coinbase/cdp-sdk";
import { type FacilitatorEvmSigner } from "@x402/evm";
/** CDP network identifiers - matches SendEvmTransactionBodyNetwork from SDK */
export type CdpNetwork = "base" | "base-sepolia" | "ethereum" | "ethereum-sepolia" | "avalanche" | "polygon" | "optimism" | "arbitrum";
/** Configuration for creating a CDP signer */
export interface CdpSignerConfig {
    /** The CDP client instance */
    cdpClient: CdpClient;
    /** The CDP EVM account (from cdp.evm.getOrCreateAccount) */
    account: EvmServerAccount;
    /** The CDP network name (e.g., "base", "base-sepolia") */
    network: CdpNetwork;
    /** Optional custom RPC URL for the public client */
    rpcUrl?: string;
}
/**
 * Convert CAIP-2 network string to CDP network name
 * @example caip2ToCdpNetwork("eip155:8453") // => "base"
 */
export declare function caip2ToCdpNetwork(caip2: string): CdpNetwork | null;
/**
 * Get the chain ID from a CAIP-2 network string
 * @example getChainIdFromCaip2("eip155:8453") // => 8453
 */
export declare function getChainIdFromCaip2(caip2: string): number | null;
/**
 * Creates a FacilitatorEvmSigner from a CDP SDK account.
 *
 * This adapter bridges the CDP SDK's transaction signing with the
 * x402 facilitator's expected signer interface.
 *
 * @example
 * ```typescript
 * import { CdpClient } from "@coinbase/cdp-sdk";
 * import { createCdpEvmSigner } from "./signers/cdp.js";
 * import { createFacilitator } from "./setup.js";
 *
 * const cdp = new CdpClient();
 * const account = await cdp.evm.getOrCreateAccount({ name: "facilitator" });
 *
 * const cdpSigner = createCdpEvmSigner({
 *   cdpClient: cdp,
 *   account,
 *   network: "base",
 *   rpcUrl: process.env.EVM_RPC_URL_BASE,
 * });
 *
 * const facilitator = createFacilitator({
 *   evmSigners: [{ signer: cdpSigner, networks: "eip155:8453" }],
 * });
 * ```
 */
export declare function createCdpEvmSigner(config: CdpSignerConfig): FacilitatorEvmSigner;
export interface MultiNetworkCdpSignerConfig {
    /** The CDP client instance */
    cdpClient: CdpClient;
    /** The CDP EVM account */
    account: EvmServerAccount;
    /** Network configurations: CDP network name -> RPC URL */
    networks: Partial<Record<CdpNetwork, string | undefined>>;
}
/**
 * Creates multiple CDP signers for different networks.
 *
 * @example
 * ```typescript
 * const signers = createMultiNetworkCdpSigners({
 *   cdpClient: cdp,
 *   account,
 *   networks: {
 *     "base": process.env.EVM_RPC_URL_BASE,
 *     "base-sepolia": process.env.BASE_SEPOLIA_RPC_URL,
 *     "optimism": process.env.OPTIMISM_RPC_URL,
 *   },
 * });
 *
 * const facilitator = createFacilitator({
 *   evmSigners: [
 *     { signer: signers.base!, networks: "eip155:8453" },
 *     { signer: signers["base-sepolia"]!, networks: "eip155:84532" },
 *     { signer: signers.optimism!, networks: "eip155:10" },
 *   ],
 * });
 * ```
 */
export declare function createMultiNetworkCdpSigners(config: MultiNetworkCdpSignerConfig): Partial<Record<CdpNetwork, FacilitatorEvmSigner>>;
//# sourceMappingURL=cdp.d.ts.map