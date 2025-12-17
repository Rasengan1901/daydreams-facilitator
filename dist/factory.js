/**
 * Facilitator Factory - Pure library code with no side effects
 *
 * This module provides the createFacilitator factory and associated types.
 * It can be safely imported without triggering any initialization.
 */
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { registerExactSvmScheme } from "@x402/svm/exact/facilitator";
import { registerUptoEvmScheme } from "./upto/evm/register.js";
// ============================================================================
// Factory
// ============================================================================
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
export function createFacilitator(config) {
    const facilitator = new x402Facilitator();
    // Register lifecycle hooks
    if (config.hooks?.onBeforeVerify) {
        facilitator.onBeforeVerify(config.hooks.onBeforeVerify);
    }
    if (config.hooks?.onAfterVerify) {
        facilitator.onAfterVerify(config.hooks.onAfterVerify);
    }
    if (config.hooks?.onVerifyFailure) {
        facilitator.onVerifyFailure(config.hooks.onVerifyFailure);
    }
    if (config.hooks?.onBeforeSettle) {
        facilitator.onBeforeSettle(config.hooks.onBeforeSettle);
    }
    if (config.hooks?.onAfterSettle) {
        facilitator.onAfterSettle(config.hooks.onAfterSettle);
    }
    if (config.hooks?.onSettleFailure) {
        facilitator.onSettleFailure(config.hooks.onSettleFailure);
    }
    // Register EVM signers and their schemes
    for (const evmConfig of config.evmSigners ?? []) {
        const schemes = evmConfig.schemes ?? ["exact", "upto"];
        if (schemes.includes("exact")) {
            registerExactEvmScheme(facilitator, {
                signer: evmConfig.signer,
                networks: evmConfig.networks,
                deployERC4337WithEIP6492: evmConfig.deployERC4337WithEIP6492,
            });
        }
        if (schemes.includes("upto")) {
            registerUptoEvmScheme(facilitator, {
                signer: evmConfig.signer,
                networks: evmConfig.networks,
            });
        }
    }
    // Register SVM signers and their schemes
    for (const svmConfig of config.svmSigners ?? []) {
        const schemes = svmConfig.schemes ?? ["exact"];
        if (schemes.includes("exact")) {
            registerExactSvmScheme(facilitator, {
                signer: svmConfig.signer,
                networks: svmConfig.networks,
            });
        }
    }
    return facilitator;
}
//# sourceMappingURL=factory.js.map