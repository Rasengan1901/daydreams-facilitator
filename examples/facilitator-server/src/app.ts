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

  // Create the facilitator
  const facilitator = createFacilitator({
    ...defaultSigners,
  });

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
          paymentPayload?: PaymentPayload;
          paymentRequirements?: PaymentRequirements;
        };

        // Debug logging for payment payload
        console.log("=== X-Payment Debug ===");
        console.log("paymentPayload type:", typeof paymentPayload);
        console.log("paymentPayload:", JSON.stringify(paymentPayload, null, 2));
        console.log("paymentRequirements:", JSON.stringify(paymentRequirements, null, 2));
        
        // If paymentPayload is a string (base64), try to decode it
        if (typeof paymentPayload === "string") {
          try {
            const decoded = Buffer.from(paymentPayload, "base64").toString("utf-8");
            console.log("Raw decoded (base64):", decoded);
            const parsed = JSON.parse(decoded);
            console.log("Parsed structure:", JSON.stringify(parsed, null, 2));
          } catch (e) {
            console.log("Failed to decode X-Payment as base64:", e);
          }
        }
        
        // Also check if there's a nested payload that's base64 encoded
        if (paymentPayload && typeof paymentPayload === "object" && "payload" in paymentPayload) {
          const innerPayload = (paymentPayload as Record<string, unknown>).payload;
          if (typeof innerPayload === "string") {
            try {
              const decoded = Buffer.from(innerPayload, "base64").toString("utf-8");
              console.log("Inner payload decoded (base64):", decoded);
              const parsed = JSON.parse(decoded);
              console.log("Inner parsed structure:", JSON.stringify(parsed, null, 2));
            } catch (e) {
              console.log("Failed to decode inner payload as base64:", e);
            }
          } else {
            console.log("Inner payload (not string):", JSON.stringify(innerPayload, null, 2));
          }
        }
        console.log("=== End Debug ===");

        if (!paymentPayload || !paymentRequirements) {
          return status(400, {
            error: "Missing paymentPayload or paymentRequirements",
          });
        }

        // Default x402Version to 2 if not provided (for compatibility with clients
        // that don't send the version, like Coinbase's MCP)
        const normalizedPayload: PaymentPayload = {
          ...paymentPayload,
          x402Version: paymentPayload.x402Version ?? 2,
        };

        const response: VerifyResponse = await facilitator.verify(
          normalizedPayload,
          paymentRequirements
        );

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
          paymentPayload?: PaymentPayload;
          paymentRequirements?: PaymentRequirements;
        };

        if (!paymentPayload || !paymentRequirements) {
          return status(400, {
            error: "Missing paymentPayload or paymentRequirements",
          });
        }

        // Default x402Version to 2 if not provided (for compatibility with clients
        // that don't send the version, like Coinbase's MCP)
        const normalizedPayload: PaymentPayload = {
          ...paymentPayload,
          x402Version: paymentPayload.x402Version ?? 2,
        };

        const response: SettleResponse = await facilitator.settle(
          normalizedPayload,
          paymentRequirements
        );

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
