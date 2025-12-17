/**
 * @x402/facilitator/upto/evm - EVM-specific Upto scheme components
 *
 * This module exports EVM-specific implementations of the upto scheme
 * for both facilitators and resource servers.
 *
 * @example
 * ```typescript
 * // Facilitator side
 * import { registerUptoEvmScheme } from "@x402/facilitator/upto/evm";
 * registerUptoEvmScheme(facilitator, { signer, networks: "eip155:8453" });
 *
 * // Resource server side
 * import { UptoEvmServerScheme } from "@x402/facilitator/upto/evm";
 * resourceServer.register("eip155:*", new UptoEvmServerScheme());
 * ```
 */
export { registerUptoEvmScheme } from "./register.js";
export { UptoEvmScheme } from "./facilitator.js";
export { UptoEvmServerScheme } from "./serverScheme.js";
//# sourceMappingURL=lib.d.ts.map