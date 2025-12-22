/**
 * Exact Starknet Facilitator Scheme
 *
 * Implements the SchemeNetworkFacilitator interface for Starknet exact payments.
 * Uses x402-starknet to verify and settle via a configured paymaster.
 */

import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  createProvider,
  verifyPayment,
  settlePayment,
  PAYMENT_PAYLOAD_SCHEMA,
  PAYMENT_REQUIREMENTS_SCHEMA,
  type PaymentPayload as StarknetPaymentPayload,
  type PaymentRequirements as StarknetPaymentRequirements,
  type StarknetNetworkId,
} from "x402-starknet";

export interface StarknetConfig {
  /** CAIP-2 network identifier (e.g., "starknet:mainnet") */
  network: StarknetNetworkId;
  /** RPC URL for Starknet network */
  rpcUrl: string;
  /** Paymaster endpoint to use for settlement */
  paymasterEndpoint: string;
  /** Optional paymaster API key */
  paymasterApiKey?: string;
  /** Sponsor address for /supported signers */
  sponsorAddress: string;
}

function hasTypedData(
  payload: StarknetPaymentPayload
): payload is StarknetPaymentPayload & { typedData: Record<string, unknown> } {
  const typedData = (payload as { typedData?: unknown }).typedData;
  return (
    typeof typedData === "object" && typedData !== null && !Array.isArray(typedData)
  );
}

function parseStarknetPayload(
  payload: PaymentPayload
): StarknetPaymentPayload | null {
  const parsed = PAYMENT_PAYLOAD_SCHEMA.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseStarknetRequirements(
  requirements: PaymentRequirements
): StarknetPaymentRequirements | null {
  const parsed = PAYMENT_REQUIREMENTS_SCHEMA.safeParse(requirements);
  return parsed.success ? parsed.data : null;
}

export class ExactStarknetScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "starknet:*";

  private readonly provider: ReturnType<typeof createProvider>;

  constructor(private readonly config: StarknetConfig) {
    if (!config.sponsorAddress) {
      throw new Error("Starknet sponsor address is required.");
    }
    this.provider = createProvider({
      network: config.network,
      rpcUrl: config.rpcUrl,
    });
  }

  getExtra(_network: string): Record<string, unknown> | undefined {
    return {
      paymasterEndpoint: this.config.paymasterEndpoint,
      sponsorAddress: this.config.sponsorAddress,
    };
  }

  getSigners(_network: string): string[] {
    return [this.config.sponsorAddress];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    const parsedPayload = parseStarknetPayload(payload);
    const parsedRequirements = parseStarknetRequirements(requirements);

    if (!parsedPayload) {
      return { isValid: false, invalidReason: "invalid_payload" };
    }
    if (!parsedRequirements) {
      return { isValid: false, invalidReason: "invalid_payment_requirements" };
    }
    if (!hasTypedData(parsedPayload)) {
      return { isValid: false, invalidReason: "invalid_payload" };
    }
    return verifyPayment(
      this.provider,
      parsedPayload,
      parsedRequirements
    );
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    const parsedPayload = parseStarknetPayload(payload);
    const parsedRequirements = parseStarknetRequirements(requirements);

    if (!parsedPayload) {
      return {
        success: false,
        errorReason: "invalid_payload",
        transaction: "",
        network: requirements.network,
      };
    }

    if (!parsedRequirements) {
      return {
        success: false,
        errorReason: "invalid_payment_requirements",
        transaction: "",
        network: requirements.network,
      };
    }

    if (!hasTypedData(parsedPayload)) {
      return {
        success: false,
        errorReason: "invalid_payload",
        transaction: "",
        network: requirements.network,
      };
    }
    return settlePayment(
      this.provider,
      parsedPayload,
      parsedRequirements,
      {
        paymasterConfig: {
          endpoint: this.config.paymasterEndpoint,
          network: this.config.network,
          ...(this.config.paymasterApiKey
            ? { apiKey: this.config.paymasterApiKey }
            : {}),
        },
      }
    );
  }
}
