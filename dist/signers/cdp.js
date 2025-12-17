/**
 * CDP (Coinbase Developer Platform) Signer Adapter
 *
 * This module provides an adapter to use CDP SDK accounts as x402 facilitator signers.
 */
import { toFacilitatorEvmSigner } from "@x402/evm";
import { createPublicClient, encodeFunctionData, http, } from "viem";
import { base, baseSepolia, mainnet, optimism, arbitrum, polygon } from "viem/chains";
// ============================================================================
// Network Mapping
// ============================================================================
/** Map CAIP-2 chain IDs to CDP network names */
const CAIP2_TO_CDP_NETWORK = {
    1: "ethereum",
    8453: "base",
    84532: "base-sepolia",
    10: "optimism",
    42161: "arbitrum",
    137: "polygon",
    43114: "avalanche",
    11155111: "ethereum-sepolia",
};
/** Map CDP network names to viem Chain configs */
const CDP_NETWORK_TO_CHAIN = {
    base: base,
    "base-sepolia": baseSepolia,
    ethereum: mainnet,
    "ethereum-sepolia": mainnet, // Uses mainnet config with sepolia RPC
    optimism: optimism,
    arbitrum: arbitrum,
    polygon: polygon,
    avalanche: mainnet, // Fallback - add avalanche chain if needed
};
/**
 * Convert CAIP-2 network string to CDP network name
 * @example caip2ToCdpNetwork("eip155:8453") // => "base"
 */
export function caip2ToCdpNetwork(caip2) {
    const match = caip2.match(/^eip155:(\d+)$/);
    if (!match)
        return null;
    const chainId = parseInt(match[1], 10);
    return CAIP2_TO_CDP_NETWORK[chainId] ?? null;
}
/**
 * Get the chain ID from a CAIP-2 network string
 * @example getChainIdFromCaip2("eip155:8453") // => 8453
 */
export function getChainIdFromCaip2(caip2) {
    const match = caip2.match(/^eip155:(\d+)$/);
    if (!match)
        return null;
    return parseInt(match[1], 10);
}
// ============================================================================
// CDP Signer Factory
// ============================================================================
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
export function createCdpEvmSigner(config) {
    const { cdpClient, account, network, rpcUrl } = config;
    const chain = CDP_NETWORK_TO_CHAIN[network];
    if (!chain) {
        throw new Error(`Unsupported CDP network: ${network}`);
    }
    // Create a public client for read operations
    const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
    });
    // Use toFacilitatorEvmSigner to wrap with getAddresses() support
    return toFacilitatorEvmSigner({
        address: account.address,
        /**
         * Get bytecode at an address (for contract detection)
         */
        getCode: async (args) => {
            return publicClient.getCode({ address: args.address });
        },
        /**
         * Read from a contract (view/pure functions)
         */
        readContract: async (args) => {
            return publicClient.readContract({
                address: args.address,
                abi: args.abi,
                functionName: args.functionName,
                args: args.args ?? [],
            });
        },
        /**
         * Verify an EIP-712 typed data signature
         */
        verifyTypedData: async (args) => {
            return publicClient.verifyTypedData({
                address: args.address,
                domain: args.domain,
                types: args.types,
                primaryType: args.primaryType,
                message: args.message,
                signature: args.signature,
            });
        },
        /**
         * Write to a contract (state-changing functions)
         * Uses CDP SDK to sign and broadcast the transaction
         */
        writeContract: async (args) => {
            // Encode the function call data
            const data = encodeFunctionData({
                abi: args.abi,
                functionName: args.functionName,
                args: args.args,
            });
            // Send via CDP SDK
            const result = await cdpClient.evm.sendTransaction({
                address: account.address,
                network,
                transaction: {
                    to: args.address,
                    data,
                    value: 0n,
                },
            });
            return result.transactionHash;
        },
        /**
         * Send a raw transaction
         * Uses CDP SDK to sign and broadcast
         */
        sendTransaction: async (args) => {
            const result = await cdpClient.evm.sendTransaction({
                address: account.address,
                network,
                transaction: {
                    to: args.to,
                    data: args.data,
                    value: 0n,
                },
            });
            return result.transactionHash;
        },
        /**
         * Wait for a transaction to be mined
         */
        waitForTransactionReceipt: async (args) => {
            return publicClient.waitForTransactionReceipt({
                hash: args.hash,
                retryCount: 3,
                retryDelay: 5000,
            });
        },
    });
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
export function createMultiNetworkCdpSigners(config) {
    const { cdpClient, account, networks } = config;
    const signers = {};
    for (const [network, rpcUrl] of Object.entries(networks)) {
        if (rpcUrl) {
            signers[network] = createCdpEvmSigner({
                cdpClient,
                account,
                network: network,
                rpcUrl,
            });
        }
    }
    return signers;
}
//# sourceMappingURL=cdp.js.map