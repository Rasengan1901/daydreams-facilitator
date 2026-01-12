/**
 * Facilitator Factory - Pure library code with no side effects
 *
 * This module provides the createFacilitator factory and associated types.
 * It can be safely imported without triggering any initialization.
 */

import type { FacilitatorEvmSigner } from "@x402/evm";
import type { FacilitatorSvmSigner } from "@x402/svm";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { registerExactSvmScheme } from "@x402/svm/exact/facilitator";

import { ExactStarknetScheme } from "./starknet/exact/facilitator.js";
import type { StarknetConfig } from "./starknet/exact/facilitator.js";
import { registerUptoEvmScheme } from "./upto/evm/register.js";

// ============================================================================
// Types
// ============================================================================

export type EvmSchemeType = "exact" | "upto";
export type SvmSchemeType = "exact";
export type { StarknetConfig };

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
  /**
   * Also register v1 exact scheme for backwards compatibility.
   * Only registers for networks that support v1 (from @x402/evm).
   * Defaults to true.
   */
  registerV1?: boolean;
  /**
   * Network name(s) for v1 registration (e.g., "base", "base-sepolia").
   * Required when registerV1 is true to map CAIP IDs to v1 network names.
   */
  v1NetworkNames?: string | string[];
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
  /** Starknet configurations */
  starknetConfigs?: StarknetConfig[];
  /** Lifecycle hooks for custom logic */
  hooks?: FacilitatorHooks;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a configured x402 Facilitator with injected signers.
 *
 * @example
 * ```typescript
 * import { createFacilitator } from "@daydreamsai/facilitator";
 * import { createCdpEvmSigner } from "@daydreamsai/facilitator/signers/cdp";
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
export function createFacilitator(config: FacilitatorConfig): x402Facilitator {
  console.log("[Factory] Creating facilitator...");
  const facilitator = new x402Facilitator();

  // Register lifecycle hooks
  const hookCount = [
    config.hooks?.onBeforeVerify,
    config.hooks?.onAfterVerify,
    config.hooks?.onVerifyFailure,
    config.hooks?.onBeforeSettle,
    config.hooks?.onAfterSettle,
    config.hooks?.onSettleFailure,
  ].filter(Boolean).length;
  
  if (hookCount > 0) {
    console.log(`[Factory] Registering ${hookCount} lifecycle hooks`);
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
  }

  // Register EVM signers and their schemes
  const evmSignerCount = config.evmSigners?.length ?? 0;
  console.log(`[Factory] Registering ${evmSignerCount} EVM signer(s)`);
  
  for (const evmConfig of config.evmSigners ?? []) {
    const schemes = evmConfig.schemes ?? ["exact", "upto"];
    const networks = Array.isArray(evmConfig.networks) 
      ? evmConfig.networks 
      : [evmConfig.networks];
    
    console.log(`[Factory] EVM signer: networks=${networks.join(", ")}, schemes=${schemes.join(", ")}`);

    if (schemes.includes("exact")) {
      // Register v2 scheme
      console.log(`[Factory] Registering ExactEvmScheme (v2) for networks: ${networks.join(", ")}`);
      facilitator.register(
        evmConfig.networks,
        new ExactEvmScheme(evmConfig.signer, {
          deployERC4337WithEIP6492: evmConfig.deployERC4337WithEIP6492,
        })
      );
    }

    if (schemes.includes("upto")) {
      console.log(`[Factory] Registering UptoEvmScheme for networks: ${networks.join(", ")}`);
      registerUptoEvmScheme(facilitator, {
        signer: evmConfig.signer,
        networks: evmConfig.networks,
      });
    }
  }

  // Register SVM signers and their schemes
  const svmSignerCount = config.svmSigners?.length ?? 0;
  if (svmSignerCount > 0) {
    console.log(`[Factory] Registering ${svmSignerCount} SVM signer(s)`);
    for (const svmConfig of config.svmSigners ?? []) {
      const schemes = svmConfig.schemes ?? ["exact"];
      const networks = Array.isArray(svmConfig.networks) 
        ? svmConfig.networks 
        : [svmConfig.networks];
      
      console.log(`[Factory] SVM signer: networks=${networks.join(", ")}, schemes=${schemes.join(", ")}`);

      if (schemes.includes("exact")) {
        console.log(`[Factory] Registering ExactSvmScheme for networks: ${networks.join(", ")}`);
        registerExactSvmScheme(facilitator, {
          signer: svmConfig.signer,
          networks: svmConfig.networks,
        });
      }
    }
  }

  // Register Starknet schemes
  const starknetCount = config.starknetConfigs?.length ?? 0;
  if (starknetCount > 0) {
    console.log(`[Factory] Registering ${starknetCount} Starknet config(s)`);
    for (const starknetConfig of config.starknetConfigs ?? []) {
      console.log(`[Factory] Registering ExactStarknetScheme for network: ${starknetConfig.network}`);
      facilitator.register(
        starknetConfig.network,
        new ExactStarknetScheme(starknetConfig)
      );
    }
  }

  console.log("[Factory] Facilitator creation complete");
  return facilitator;
}
