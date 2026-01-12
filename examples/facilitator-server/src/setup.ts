/**
 * Default Facilitator Setup - Application-specific with side effects
 *
 * This module creates a default facilitator instance based on environment
 * configuration. It has side effects and should only be imported by the
 * CLI server, not by library consumers.
 *
 * Library consumers should use createFacilitator() from the main export instead.
 */

import "dotenv/config";
import { CdpClient } from "@coinbase/cdp-sdk";

import {
  createFacilitator,
  type FacilitatorConfig,
  type EvmSchemeType,
} from "@daydreamsai/facilitator";
import {
  createCdpEvmSigner,
  createPrivateKeyEvmSigner,
  createPrivateKeySvmSigner,
  type CdpNetwork,
} from "@daydreamsai/facilitator/signers";
import {
  getNetworkSetups,
  getStarknetNetworkSetups,
  getSvmNetworkSetups,
  getRpcUrl,
  USE_CDP,
  SVM_PRIVATE_KEY,
  CDP_ACCOUNT_NAME,
} from "@daydreamsai/facilitator/config";

type EvmSignerConfig = FacilitatorConfig["evmSigners"] extends
  | (infer T)[]
  | undefined
  ? T
  : never;
type SvmSignerConfig = FacilitatorConfig["svmSigners"] extends
  | (infer T)[]
  | undefined
  ? T
  : never;
type StarknetConfig = FacilitatorConfig["starknetConfigs"] extends
  | (infer T)[]
  | undefined
  ? T
  : never;
type NetworkId = EvmSignerConfig["networks"];

// ============================================================================
// Default Signers
// ============================================================================

async function createDefaultSigners(): Promise<{
  evmSigners: EvmSignerConfig[];
  svmSigners: SvmSignerConfig[];
  starknetConfigs: StarknetConfig[];
}> {
  const networkSetups = getNetworkSetups();
  const starknetNetworkSetups = getStarknetNetworkSetups();

  const starknetConfigs: StarknetConfig[] = [];
  for (const network of starknetNetworkSetups) {
    if (!network.rpcUrl) {
      console.warn(`⚠️  No RPC URL for ${network.name} - skipping`);
      continue;
    }
    if (!network.paymasterEndpoint) {
      console.warn(`⚠️  No paymaster endpoint for ${network.name} - skipping`);
      continue;
    }

    starknetConfigs.push({
      network: network.caip as StarknetConfig["network"],
      rpcUrl: network.rpcUrl,
      paymasterEndpoint: network.paymasterEndpoint,
      ...(network.paymasterApiKey
        ? { paymasterApiKey: network.paymasterApiKey }
        : {}),
      sponsorAddress: network.sponsorAddress,
    });
  }

  if (USE_CDP) {
    // CDP Signer (preferred)
    const cdp = new CdpClient();

    const account = await cdp.evm.getOrCreateAccount({
      name: CDP_ACCOUNT_NAME!,
    });

    console.info(`CDP Facilitator account: ${account.address}`);

    const evmSigners: EvmSignerConfig[] = [];

    console.log(`[Setup] Creating ${networkSetups.length} EVM signer(s) for CDP`);
    
    // Create a signer for each configured network
    for (const network of networkSetups) {
      console.log(`[Setup] Creating CDP signer for network: ${network.name} (${network.caip})`);
      const signer = createCdpEvmSigner({
        cdpClient: cdp,
        account,
        network: network.name as CdpNetwork,
        rpcUrl: network.rpcUrl,
      });

      const signerConfig = {
        signer,
        networks: network.caip as NetworkId,
        schemes: ["exact", "upto"] as EvmSchemeType[],
        deployERC4337WithEIP6492: true,
        // Note: v1 registration removed - only v2 is supported
        registerV1: false,
      };
      
      console.log(`[Setup] Signer config: networks=${network.caip}, schemes=exact,upto, deployERC4337WithEIP6492=true`);
      evmSigners.push(signerConfig);
    }

    // CDP doesn't support SVM yet, use private key signer if available
    const svmSigners: SvmSignerConfig[] = [];
    if (SVM_PRIVATE_KEY) {
      console.log("[Setup] Creating SVM signer from private key");
      const svmSigner = await createPrivateKeySvmSigner();
      // Register for each configured SVM network
      const svmNetworkSetups = getSvmNetworkSetups();
      console.log(`[Setup] Registering SVM signer for ${svmNetworkSetups.length} network(s)`);
      for (const network of svmNetworkSetups) {
        console.log(`[Setup] SVM network: ${network.name} (${network.caip})`);
        svmSigners.push({
          signer: svmSigner,
          networks: network.caip as NetworkId,
        });
      }
    } else {
      console.log("[Setup] No SVM_PRIVATE_KEY configured, skipping SVM signers");
    }

    return { evmSigners, svmSigners, starknetConfigs };
  } else {
    // Private Key Signer (fallback)
    console.log("[Setup] Using private key signer (fallback)");
    const evmSigners: EvmSignerConfig[] = [];

    console.log(`[Setup] Creating ${networkSetups.length} EVM signer(s) from private key`);
    
    // Create a signer for each configured network
    for (const network of networkSetups) {
      const rpcUrl = getRpcUrl(network.name);
      if (!rpcUrl) {
        console.warn(`[Setup] ⚠️  No RPC URL for ${network.name} - skipping`);
        continue;
      }

      console.log(`[Setup] Creating private key signer for network: ${network.name} (${network.caip})`);
      const signer = createPrivateKeyEvmSigner({
        network: network.name,
        rpcUrl,
      });

      const signerConfig = {
        signer,
        networks: network.caip as NetworkId,
        schemes: ["exact", "upto"] as EvmSchemeType[],
        deployERC4337WithEIP6492: true,
        // Note: v1 registration removed - only v2 is supported
        registerV1: false,
      };
      
      console.log(`[Setup] Signer config: networks=${network.caip}, schemes=exact,upto, deployERC4337WithEIP6492=true`);
      evmSigners.push(signerConfig);
    }

    const svmSigners: SvmSignerConfig[] = [];
    if (SVM_PRIVATE_KEY) {
      const svmSigner = await createPrivateKeySvmSigner();
      // Register for each configured SVM network
      const svmNetworkSetups = getSvmNetworkSetups();
      for (const network of svmNetworkSetups) {
        svmSigners.push({
          signer: svmSigner,
          networks: network.caip as NetworkId,
        });
      }
    }

    return { evmSigners, svmSigners, starknetConfigs };
  }
}

// ============================================================================
// Default Instance
// ============================================================================

export const defaultSigners = await createDefaultSigners();
