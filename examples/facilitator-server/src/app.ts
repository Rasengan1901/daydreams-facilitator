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
    /**
     * POST /verify
     * Verify a payment against requirements
     *
     * Note: Payment tracking and bazaar discovery are handled by lifecycle hooks
     */
    .post("/verify", async ({ body, status }) => {
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

        // Hooks will automatically:
        // - Track verified payment (onAfterVerify)
        // - Extract and catalog discovery info (onAfterVerify)
        const response: VerifyResponse = await facilitator.verify(
          paymentPayload,
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
     * Note: Verification validation and cleanup are handled by lifecycle hooks
     */
    .post("/settle", async ({ body, status }) => {
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

        // Hooks will automatically:
        // - Validate payment was verified (onBeforeSettle - will abort if not)
        // - Check verification timeout (onBeforeSettle)
        // - Clean up tracking (onAfterSettle / onSettleFailure)
        const response: SettleResponse = await facilitator.settle(
          paymentPayload,
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
          // Return a proper SettleResponse instead of 500 error
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
