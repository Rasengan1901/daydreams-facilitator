/**
 * Pre-configured x402 Resource Server with Daydreams schemes
 *
 * This module exports a factory to create resource servers with
 * all supported schemes (exact EVM, exact SVM, upto EVM) pre-registered.
 *
 * @example
 * ```typescript
 * import { createResourceServer } from "@x402/facilitator/server";
 * import { HTTPFacilitatorClient } from "@x402/core/http";
 *
 * const facilitatorClient = new HTTPFacilitatorClient({ url: "http://localhost:8090" });
 * const resourceServer = createResourceServer(facilitatorClient);
 *
 * // Ready to use with all schemes registered
 * await resourceServer.initialize();
 * ```
 */
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
export interface ResourceServerConfig {
    /** Enable EVM exact scheme (default: true) */
    exactEvm?: boolean;
    /** Enable EVM upto scheme (default: true) */
    uptoEvm?: boolean;
    /** Enable SVM exact scheme (default: true) */
    exactSvm?: boolean;
}
/**
 * Creates a pre-configured x402ResourceServer with Daydreams schemes.
 *
 * By default, registers:
 * - `eip155:*` - ExactEvmScheme (immediate EVM payments)
 * - `eip155:*` - UptoEvmServerScheme (batched EVM payments)
 * - `solana:*` - ExactSvmScheme (immediate Solana payments)
 *
 * @param facilitatorClient - The facilitator client for verification/settlement
 * @param config - Optional configuration to enable/disable specific schemes
 * @returns Configured x402ResourceServer instance
 *
 * @example
 * ```typescript
 * import { createResourceServer } from "@x402/facilitator/server";
 * import { HTTPFacilitatorClient } from "@x402/core/http";
 *
 * const client = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL });
 * const server = createResourceServer(client);
 *
 * // Or with specific schemes only
 * const evmOnlyServer = createResourceServer(client, {
 *   exactEvm: true,
 *   uptoEvm: true,
 *   exactSvm: false,
 * });
 * ```
 */
export declare function createResourceServer(facilitatorClient: FacilitatorClient, config?: ResourceServerConfig): x402ResourceServer;
export { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
export { HTTPFacilitatorClient, x402HTTPResourceServer, type HTTPAdapter, } from "@x402/core/http";
export { ExactEvmScheme } from "@x402/evm/exact/server";
export { ExactSvmScheme } from "@x402/svm/exact/server";
export { UptoEvmServerScheme } from "./upto/evm/serverScheme.js";
//# sourceMappingURL=server.d.ts.map