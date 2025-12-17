/**
 * @x402/facilitator/signers - Signer adapters for x402 facilitators
 *
 * This module exports signer adapters for different wallet/key management systems.
 *
 * @example
 * ```typescript
 * import { createCdpEvmSigner } from "@x402/facilitator/signers/cdp";
 * import { CdpClient } from "@coinbase/cdp-sdk";
 *
 * const cdp = new CdpClient();
 * const account = await cdp.evm.getOrCreateAccount({ name: "facilitator" });
 *
 * const signer = createCdpEvmSigner({
 *   cdpClient: cdp,
 *   account,
 *   network: "base",
 *   rpcUrl: process.env.RPC_URL,
 * });
 * ```
 */
// CDP (Coinbase Developer Platform) signer adapter
export { createCdpEvmSigner, createMultiNetworkCdpSigners, caip2ToCdpNetwork, getChainIdFromCaip2, } from "./cdp.js";
//# sourceMappingURL=lib.js.map