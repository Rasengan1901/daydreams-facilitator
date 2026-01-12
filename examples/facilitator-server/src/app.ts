import { Elysia, file } from "elysia";
import { node } from "@elysiajs/node";
import { staticPlugin } from "@elysiajs/static";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";

import { logger } from "@bogeychan/elysia-logger";
import { defaultSigners } from "./setup";
import { createFacilitator } from "@daydreamsai/facilitator";
import {
  createUptoModule,
  InMemoryUptoSessionStore,
  type UptoSessionStore,
} from "@daydreamsai/facilitator/upto";
import { RedisSessionStore } from "./upto/redisStore";

// ============================================================================
// Constants
// ============================================================================

const startTime = Date.now();
const VERSION = process.env.npm_package_version || "1.0.0";

// Idempotency cache for /internal/track (in-memory, expires after 1 hour)
const idempotencyCache = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

// Clean up expired idempotency keys periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of idempotencyCache.entries()) {
    if (now - timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// ============================================================================
// Network Normalization
// ============================================================================

/**
 * Map short network names to CAIP-2 format for facilitator compatibility.
 * The facilitator expects CAIP-2 format (eip155:8453), but MCPs may send
 * short names (base).
 */
function normalizeNetwork(network: string): string {
  const networkMap: Record<string, string> = {
    base: "eip155:8453",
    "base-sepolia": "eip155:84532",
    ethereum: "eip155:1",
    sepolia: "eip155:11155111",
    optimism: "eip155:10",
    "optimism-sepolia": "eip155:11155420",
    arbitrum: "eip155:42161",
    "arbitrum-sepolia": "eip155:421614",
    polygon: "eip155:137",
    "polygon-amoy": "eip155:80002",
    avalanche: "eip155:43114",
    "avalanche-fuji": "eip155:43113",
    abstract: "eip155:2741",
    "abstract-testnet": "eip155:11124",
  };

  return networkMap[network.toLowerCase()] || network;
}

// ============================================================================
// Payment Payload Preprocessing
// ============================================================================

interface PreprocessedVerifyInput {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  error?: {
    status: number;
    error: string;
    message: string;
  };
}

/**
 * Preprocess payment payload and requirements for verification.
 *
 * Handles:
 * 1. Network normalization (base → eip155:8453)
 * 2. Payload structure normalization (ensures accepted property exists)
 * 3. Authorization guardrails (validates authorization matches requirements)
 * 4. Domain detection logging (logs payload shape for domain inference)
 *
 * Returns either normalized input or an error response.
 */
function preprocessVerifyInput(
  paymentPayload: PaymentPayload | string,
  paymentRequirements: PaymentRequirements
): PreprocessedVerifyInput {
  // Step 1: Decode base64 if needed
  let payload: PaymentPayload;
  if (typeof paymentPayload === "string") {
    try {
      const decoded = Buffer.from(paymentPayload, "base64").toString("utf-8");
      payload = JSON.parse(decoded) as PaymentPayload;
    } catch (e) {
      return {
        payload: {} as PaymentPayload,
        requirements: paymentRequirements,
        error: {
          status: 400,
          error: "Invalid paymentPayload",
          message: "Failed to decode base64 payment payload",
        },
      };
    }
  } else {
    payload = paymentPayload;
  }

  // Step 2: Normalize network in requirements
  const normalizedNetwork = normalizeNetwork(paymentRequirements.network) as `eip155:${number}` | `solana:${string}` | `starknet:${string}`;
  const normalizedRequirements: PaymentRequirements = {
    ...paymentRequirements,
    network: normalizedNetwork,
  };

  // Step 3: Normalize payload structure for x402Version 2
  const x402Version = payload.x402Version ?? 2;

  // Ensure payload has the correct structure: { x402Version, accepted, payload }
  let normalizedPayload: PaymentPayload;

  if (payload.accepted) {
    // Already has accepted property, normalize network there too
    const acceptedNetwork = payload.accepted.network 
      ? normalizeNetwork(payload.accepted.network) as `eip155:${number}` | `solana:${string}` | `starknet:${string}`
      : normalizedNetwork;
    
    normalizedPayload = {
      ...payload,
      x402Version,
      accepted: {
        ...payload.accepted,
        network: acceptedNetwork,
      },
    };
  } else {
    // Missing accepted property - construct from requirements
    // Also handle case where authorization might be at top level
    const topLevelAuth = (payload as { authorization?: unknown }).authorization;
    const existingPayload = payload.payload as Record<string, unknown> | undefined;

    normalizedPayload = {
      x402Version,
      resource: payload.resource || "unknown",
      accepted: normalizedRequirements,
      payload: {
        ...(existingPayload || {}),
        // Move authorization from top level to payload if needed
        ...(topLevelAuth && !existingPayload?.authorization
          ? { authorization: topLevelAuth }
          : {}),
      } as PaymentPayload["payload"],
    };
  }

  // Step 4: Guardrails - validate authorization matches requirements (if present)
  const payloadData = normalizedPayload.payload as
    | { authorization?: { from?: string; to?: string; value?: string } }
    | undefined;

  if (payloadData?.authorization) {
    const auth = payloadData.authorization;

    // Validate payTo matches authorization.to
    if (auth.to && normalizedRequirements.payTo) {
      if (auth.to.toLowerCase() !== normalizedRequirements.payTo.toLowerCase()) {
        return {
          payload: normalizedPayload,
          requirements: normalizedRequirements,
          error: {
            status: 400,
            error: "authorization_mismatch",
            message: `Authorization 'to' (${auth.to}) does not match payment requirements 'payTo' (${normalizedRequirements.payTo})`,
          },
        };
      }
    }

    // Validate amount/authorization.value
    if (auth.value && normalizedRequirements.amount) {
      const authValue = BigInt(auth.value);
      const requiredAmount = BigInt(normalizedRequirements.amount);

      if (authValue < requiredAmount) {
        return {
          payload: normalizedPayload,
          requirements: normalizedRequirements,
          error: {
            status: 400,
            error: "authorization_amount_insufficient",
            message: `Authorization value (${auth.value}) is less than required amount (${normalizedRequirements.amount})`,
          },
        };
      }
    }
  }

  // Step 5: Log payload shape for domain detection (redacted)
  const payloadShape = {
    hasAccepted: !!normalizedPayload.accepted,
    hasPayload: !!normalizedPayload.payload,
    payloadKeys: normalizedPayload.payload
      ? Object.keys(normalizedPayload.payload as Record<string, unknown>)
      : [],
    authorizationShape: payloadData?.authorization
      ? {
          hasFrom: !!payloadData.authorization.from,
          hasTo: !!payloadData.authorization.to,
          hasValue: !!payloadData.authorization.value,
          hasValidAfter: !!(payloadData.authorization as { validAfter?: unknown })
            .validAfter,
          hasValidBefore: !!(payloadData.authorization as { validBefore?: unknown })
            .validBefore,
          hasNonce: !!(payloadData.authorization as { nonce?: unknown }).nonce,
        }
      : null,
  };

  console.log(
    `[Preprocess] Payload shape (redacted):`,
    JSON.stringify(payloadShape, null, 2)
  );

  // Check if domain info is missing from requirements.extra
  const extra = normalizedRequirements.extra as
    | { name?: string; version?: string; verifyingContract?: string }
    | undefined;

  if (!extra?.name || !extra?.version) {
    // Log what's missing for debugging
    console.log(
      `[Preprocess] WARNING: Missing EIP-712 domain info in requirements.extra`
    );
    console.log(
      `[Preprocess] extra keys:`,
      extra ? Object.keys(extra) : "extra is undefined"
    );
    console.log(
      `[Preprocess] This may cause verification to fail with 'missing_eip712_domain'`
    );
  }

  return {
    payload: normalizedPayload,
    requirements: normalizedRequirements,
  };
}

// ============================================================================
// API Key Validation
// ============================================================================

/**
 * Validate API key from Authorization header.
 * Protected endpoints require: Authorization: Bearer <FACILITATOR_API_KEY>
 */
function validateApiKey(request: Request): boolean {
  const apiKey = process.env.FACILITATOR_API_KEY;

  // If no API key configured, allow all requests (development mode)
  if (!apiKey) {
    return true;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix
  return token === apiKey;
}

// ============================================================================
// Session Store Setup
// ============================================================================

async function createSessionStore(): Promise<UptoSessionStore> {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    console.log("🔌 Connecting to Redis for upto session storage...");
    const redisStore = new RedisSessionStore(redisUrl);
    await redisStore.connect(); // Hydrates sessions from Redis
    return redisStore;
  }

  console.log("📦 Using in-memory session store (no REDIS_URL configured)");
  return new InMemoryUptoSessionStore();
}

// ============================================================================
// App Factory
// ============================================================================

export async function createApp() {
  // Initialize session store (Redis if available, otherwise in-memory)
  const sessionStore = await createSessionStore();

  // Create the facilitator (v1 scheme registration is handled by the factory)
  console.log("[App] Creating facilitator with default signers...");
  console.log(`[App] EVM signers: ${defaultSigners.evmSigners?.length ?? 0}`);
  console.log(`[App] SVM signers: ${defaultSigners.svmSigners?.length ?? 0}`);
  console.log(`[App] Starknet configs: ${defaultSigners.starknetConfigs?.length ?? 0}`);
  
  const facilitator = createFacilitator({
    ...defaultSigners,
  });
  
  console.log("[App] Facilitator created successfully");

  // Create the upto module with the session store
  const upto = createUptoModule({
    store: sessionStore,
    facilitatorClient: facilitator,
    sweeperConfig: {
      // Sweep every 30 seconds
      intervalMs: 30_000,
      // Settle idle sessions after 2 minutes
      idleSettleMs: 120_000,
      // Close very idle sessions after 30 minutes
      longIdleCloseMs: 30 * 60 * 1000,
      // Settle when 90% of cap is used
      capThresholdNum: 9n,
      capThresholdDen: 10n,
    },
  });

  // Create the sweeper Elysia plugin
  const sweeper = upto.createSweeper();

  // Elysia app (Node adapter for Node.js runtime)
  const app = new Elysia({ adapter: node() })
    .use(
      logger({
        autoLogging: true,
        level: "info",
      })
    )
    .use(
      opentelemetry({
        serviceName: process.env.OTEL_SERVICE_NAME ?? "x402-facilitator",
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
      })
    )
    // Mount the upto sweeper for automatic session settlement
    .use(sweeper)
    .get("/", () => file("./public/index.html"))
    .use(staticPlugin())

    // =========================================================================
    // Public Endpoints (No Auth Required)
    // =========================================================================

    /**
     * GET /health
     * Health check endpoint - confirms facilitator is running
     */
    .get("/health", () => {
      return {
        status: "ok",
        timestamp: Date.now(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
      };
    })

    /**
     * GET /supported
     * Get supported payment kinds and extensions
     */
    .get("/supported", ({ status }) => {
      try {
        return facilitator.getSupported();
      } catch (error) {
        console.error("Supported error:", error);
        return status(500, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })

    /**
     * GET /upto/sessions
     * Get the count of active upto sessions (for debugging/monitoring)
     */
    .get("/upto/sessions", ({ status }) => {
      try {
        let count = 0;
        for (const _ of sessionStore.entries()) {
          count++;
        }

        // Determine store type
        const storeType = sessionStore instanceof RedisSessionStore
          ? "redis"
          : "memory";

        // Get Redis connection status if applicable
        const redisConnected = sessionStore instanceof RedisSessionStore
          ? sessionStore.isConnected
          : undefined;

        return {
          count,
          storeType,
          ...(redisConnected !== undefined && { redisConnected }),
        };
      } catch (error) {
        console.error("Sessions count error:", error);
        return status(500, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })

    // =========================================================================
    // Protected Endpoints (API Key Required)
    // =========================================================================

    /**
     * POST /verify
     * Verify a payment against requirements
     *
     * Requires: Authorization: Bearer <PAPERPOD_API_KEY>
     */
    .post("/verify", async ({ body, status, request }) => {
      // Validate API key
      if (!validateApiKey(request)) {
        return status(401, {
          error: "Unauthorized",
          message: "Missing or invalid API key",
        });
      }

      try {
        const { paymentPayload, paymentRequirements } = body as {
          paymentPayload?: PaymentPayload | string;
          paymentRequirements?: PaymentRequirements;
        };

        console.log("[Verify] === Payment Verification Request ===");
        console.log(`[Verify] paymentPayload type: ${typeof paymentPayload}`);
        console.log(
          `[Verify] paymentRequirements:`,
          JSON.stringify(paymentRequirements, null, 2)
        );

        if (!paymentPayload || !paymentRequirements) {
          console.error("[Verify] Missing paymentPayload or paymentRequirements");
          return status(400, {
            error: "Missing paymentPayload or paymentRequirements",
          });
        }

        // Preprocess: normalize network, payload structure, validate guardrails
        const preprocessed = preprocessVerifyInput(
          paymentPayload,
          paymentRequirements
        );

        if (preprocessed.error) {
          console.error(`[Verify] Preprocessing error:`, preprocessed.error);
          return status(preprocessed.error.status, {
            error: preprocessed.error.error,
            message: preprocessed.error.message,
          });
        }

        console.log(
          `[Verify] Preprocessed - Scheme: ${preprocessed.requirements.scheme || "unknown"}, Network: ${preprocessed.requirements.network}`
        );
        console.log(
          `[Verify] Payload x402Version: ${preprocessed.payload.x402Version}`
        );
        console.log(
          `[Verify] Payload has accepted: ${!!preprocessed.payload.accepted}`
        );

        // Check for missing EIP-712 domain in exact scheme payments
        const payloadData = preprocessed.payload.payload as any;

        if (
          preprocessed.requirements.scheme === "exact" &&
          !payloadData?.domain &&
          !payloadData?.eip712Domain
        ) {
          console.error("[Verify] Missing EIP-712 domain in exact payment payload");
          console.error("[Verify] Authorization shape:", payloadData?.authorization);

          return status(400, {
            error: "missing_eip712_domain",
            message:
              "Exact EVM payments must include EIP-712 domain. MCP did not provide one.",
          });
        }

        console.log("[Verify] Calling facilitator.verify()...");
        const response: VerifyResponse = await facilitator.verify(
          preprocessed.payload,
          preprocessed.requirements
        );
        
        console.log(`[Verify] Verification result: isValid=${response.isValid}, invalidReason=${response.invalidReason || "none"}`);
        console.log("[Verify] === End Verification ===");

        return response;
      } catch (error) {
        console.error("Verify error:", error);
        return status(500, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })

    /**
     * POST /settle
     * Settle a payment on-chain
     *
     * Requires: Authorization: Bearer <PAPERPOD_API_KEY>
     */
    .post("/settle", async ({ body, status, request }) => {
      // Validate API key
      if (!validateApiKey(request)) {
        return status(401, {
          error: "Unauthorized",
          message: "Missing or invalid API key",
        });
      }

      try {
        const { paymentPayload, paymentRequirements } = body as {
          paymentPayload?: PaymentPayload | string;
          paymentRequirements?: PaymentRequirements;
        };

        console.log("[Settle] === Payment Settlement Request ===");
        console.log(`[Settle] paymentPayload type: ${typeof paymentPayload}`);
        console.log(
          `[Settle] paymentRequirements:`,
          JSON.stringify(paymentRequirements, null, 2)
        );

        if (!paymentPayload || !paymentRequirements) {
          console.error("[Settle] Missing paymentPayload or paymentRequirements");
          return status(400, {
            error: "Missing paymentPayload or paymentRequirements",
          });
        }

        // Preprocess: normalize network, payload structure, validate guardrails
        const preprocessed = preprocessVerifyInput(
          paymentPayload,
          paymentRequirements
        );

        if (preprocessed.error) {
          console.error(`[Settle] Preprocessing error:`, preprocessed.error);
          return status(preprocessed.error.status, {
            error: preprocessed.error.error,
            message: preprocessed.error.message,
          });
        }

        console.log(
          `[Settle] Preprocessed - Scheme: ${preprocessed.requirements.scheme || "unknown"}, Network: ${preprocessed.requirements.network}`
        );
        console.log(
          `[Settle] Payload x402Version: ${preprocessed.payload.x402Version}`
        );
        console.log(
          `[Settle] Payload has accepted: ${!!preprocessed.payload.accepted}`
        );

        // Check for missing EIP-712 domain in exact scheme payments
        const payloadData = preprocessed.payload.payload as any;

        if (
          preprocessed.requirements.scheme === "exact" &&
          !payloadData?.domain &&
          !payloadData?.eip712Domain
        ) {
          console.error("[Settle] Missing EIP-712 domain in exact payment payload");
          console.error("[Settle] Authorization shape:", payloadData?.authorization);

          return status(400, {
            error: "missing_eip712_domain",
            message:
              "Exact EVM payments must include EIP-712 domain. MCP did not provide one.",
          });
        }

        console.log("[Settle] Calling facilitator.settle()...");
        const response: SettleResponse = await facilitator.settle(
          preprocessed.payload,
          preprocessed.requirements
        );
        
        console.log(`[Settle] Settlement result: success=${response.success}, errorReason=${response.errorReason || "none"}`);
        console.log("[Settle] === End Settlement ===");

        return response;
      } catch (error) {
        console.error("Settle error:", error);

        // Check if this was an abort from hook
        if (
          error instanceof Error &&
          error.message.includes("Settlement aborted:")
        ) {
          const { paymentPayload } = body as {
            paymentPayload?: PaymentPayload;
          };

          return {
            success: false,
            errorReason: error.message.replace("Settlement aborted: ", ""),
            network: paymentPayload?.accepted?.network || "unknown",
          } as SettleResponse;
        }

        return status(500, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })

    /**
     * POST /internal/track
     * Track usage for metered billing (called by PaperPod after execution)
     *
     * Requires: Authorization: Bearer <PAPERPOD_API_KEY>
     *
     * Body:
     * {
     *   "wallet": "0x1234...",
     *   "amount": "0.004438",
     *   "uptoSessionId": "session-abc",
     *   "executionId": "exec_xyz",
     *   "operation": "execute"
     * }
     */
    .post("/internal/track", async ({ body, status, request }) => {
      // Validate API key
      if (!validateApiKey(request)) {
        return status(401, {
          error: "Unauthorized",
          message: "Missing or invalid API key",
        });
      }

      try {
        const { wallet, amount, uptoSessionId, executionId, operation } = body as {
          wallet?: string;
          amount?: string;
          uptoSessionId?: string;
          executionId?: string;
          operation?: string;
        };

        // Validate required fields
        if (!uptoSessionId || !amount) {
          return status(400, {
            error: "Missing required fields",
            message: "uptoSessionId and amount are required",
          });
        }

        // Get the session from store
        const session = sessionStore.get(uptoSessionId);
        if (!session) {
          return status(404, {
            error: "Session not found",
            message: `No upto session found with ID: ${uptoSessionId}`,
          });
        }

        // Check session status
        if (session.status === "closed") {
          return status(400, {
            error: "Session closed",
            message: "Cannot track usage on a closed session",
          });
        }

        // Idempotency check
        const idempotencyKey = `${uptoSessionId}:${executionId || Date.now()}`;
        if (idempotencyCache.has(idempotencyKey)) {
          // Already tracked, return current state
          const remaining = session.cap - session.pendingSpent - session.settledTotal;
          return {
            success: true,
            idempotent: true,
            pendingSpent: session.pendingSpent.toString(),
            settledTotal: session.settledTotal.toString(),
            remaining: remaining.toString(),
            cap: session.cap.toString(),
          };
        }

        // Parse amount (handle both decimal string and integer string)
        // Amount is in the same units as the session cap (e.g., USDC with 6 decimals)
        let amountBigInt: bigint;
        try {
          // If amount contains a decimal point, we need to handle it
          if (amount.includes(".")) {
            // Assume 6 decimal places for USDC
            const [whole, decimal = ""] = amount.split(".");
            const paddedDecimal = decimal.padEnd(6, "0").slice(0, 6);
            amountBigInt = BigInt(whole + paddedDecimal);
          } else {
            amountBigInt = BigInt(amount);
          }
        } catch {
          return status(400, {
            error: "Invalid amount",
            message: "Amount must be a valid number string",
          });
        }

        // Check if this would exceed the cap
        const newTotal = session.pendingSpent + session.settledTotal + amountBigInt;
        if (newTotal > session.cap) {
          const remaining = session.cap - session.pendingSpent - session.settledTotal;
          return status(400, {
            error: "Cap exceeded",
            message: "This amount would exceed the session cap",
            pendingSpent: session.pendingSpent.toString(),
            settledTotal: session.settledTotal.toString(),
            remaining: remaining.toString(),
            cap: session.cap.toString(),
            requestedAmount: amountBigInt.toString(),
          });
        }

        // Update session pending spent
        session.pendingSpent += amountBigInt;
        session.lastActivityMs = Date.now();
        sessionStore.set(uptoSessionId, session);

        // Record idempotency
        idempotencyCache.set(idempotencyKey, Date.now());

        // Calculate remaining
        const remaining = session.cap - session.pendingSpent - session.settledTotal;

        console.log(
          `[TRACK] Session ${uptoSessionId}: +${amountBigInt} | ` +
          `pending=${session.pendingSpent} settled=${session.settledTotal} ` +
          `remaining=${remaining} | wallet=${wallet} op=${operation}`
        );

        return {
          success: true,
          pendingSpent: session.pendingSpent.toString(),
          settledTotal: session.settledTotal.toString(),
          remaining: remaining.toString(),
          cap: session.cap.toString(),
        };
      } catch (error) {
        console.error("Track error:", error);
        return status(500, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

  return app;
}

// For backwards compatibility, create and export the app
// Note: This uses top-level await
export const app = await createApp();

// Start the server
const port = Number(process.env.PORT ?? 8090);

app.listen(port);

console.log(`🚀 Facilitator listening on port ${port}`);
