/**
 * Paid API Example - Resource Server with x402 Payment Middleware
 *
 * Demonstrates a resource server that accepts both exact and upto payments.
 *
 * Usage:
 *   1. Start the facilitator: bun run dev
 *   2. Start this server: bun run examples/paidApi.ts
 *
 * Endpoints:
 *   GET  /api/premium        - Exact payment ($0.01 EVM)
 *   GET  /api/premium-solana - Exact payment ($0.01 Solana)
 *   GET  /api/upto-premium   - Batched payment (upto scheme)
 *   GET  /api/upto-session/:id - Check session status
 *   POST /api/upto-close     - Close and settle session
 */

import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { x402ResourceServer } from "@x402/core/server";
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  type HTTPAdapter,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

import { evmAccount, svmAccount } from "../src/signers/index.js";
import { UptoEvmServerScheme } from "../src/upto/evm/serverScheme.js";
import {
  createUptoModule,
  trackUptoPayment,
  formatSession,
  TRACKING_ERROR_MESSAGES,
  TRACKING_ERROR_STATUS,
} from "../src/upto/lib.js";

// ============================================================================
// Configuration
// ============================================================================

const PORT = Number(4022);
const FACILITATOR_URL =
  process.env.FACILITATOR_URL ??
  `http://localhost:${process.env.FACILITATOR_PORT ?? 8090}`;

// ============================================================================
// Setup
// ============================================================================

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// Create upto module with automatic sweeper
const upto = createUptoModule({
  facilitatorClient,
  sweeperConfig: {
    intervalMs: 30_000,
    idleSettleMs: 2 * 60_000,
  },
});

// Resource server with all payment schemes
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:*", new ExactEvmScheme())
  .register("eip155:*", new UptoEvmServerScheme())
  .register("solana:*", new ExactSvmScheme());

await resourceServer.initialize();

// ============================================================================
// Route Configuration
// ============================================================================

const routes = {
  "GET /api/premium": {
    accepts: {
      scheme: "exact",
      network: "eip155:8453",
      payTo: evmAccount.address,
      price: "$0.01",
    },
    description: "Premium content (EVM)",
    mimeType: "application/json",
  },
  "GET /api/premium-solana": {
    accepts: {
      scheme: "exact",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      payTo: svmAccount.address,
      price: "$0.01",
    },
    description: "Premium content (Solana)",
    mimeType: "application/json",
  },
  "GET /api/upto-premium": {
    accepts: {
      scheme: "upto",
      network: "eip155:8453",
      payTo: evmAccount.address,
      price: {
        amount: "10000", // $0.01 per request (USDC 6 decimals)
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        extra: {
          name: "USD Coin",
          version: "2",
          maxAmountRequired: "50000", // $0.05 cap
        },
      },
    },
    description: "Premium content (batched payments)",
    mimeType: "application/json",
  },
} as const;

const httpServer = new x402HTTPResourceServer(resourceServer, routes);

// ============================================================================
// HTTP Adapter
// ============================================================================

const X402_RESULT = Symbol.for("x402.result");

function createAdapter(ctx: { request: Request; body: unknown }): HTTPAdapter {
  const url = new URL(ctx.request.url);
  const queryParams: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams.entries()) {
    const existing = queryParams[key];
    if (existing === undefined) {
      queryParams[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      queryParams[key] = [existing, value];
    }
  }

  return {
    getHeader: (name) => ctx.request.headers.get(name) ?? undefined,
    getMethod: () => ctx.request.method,
    getPath: () => url.pathname,
    getUrl: () => ctx.request.url,
    getAcceptHeader: () => ctx.request.headers.get("accept") ?? "",
    getUserAgent: () => ctx.request.headers.get("user-agent") ?? "",
    getQueryParams: () => queryParams,
    getQueryParam: (name) => queryParams[name],
    getBody: () => ctx.body,
  };
}

// ============================================================================
// Elysia Application
// ============================================================================

export const app = new Elysia({
  prefix: "/api",
  name: "paidApi",
  adapter: node(),
})
  .use(upto.sweeper)

  // Payment verification middleware
  .onBeforeHandle(async (ctx) => {
    const adapter = createAdapter(ctx);
    const result = await httpServer.processHTTPRequest({
      adapter,
      path: adapter.getPath(),
      method: adapter.getMethod(),
      paymentHeader: adapter.getHeader("x-payment"),
    });

    (ctx.request as unknown as Record<symbol, unknown>)[X402_RESULT] = result;

    if (result.type === "payment-error") {
      ctx.set.status = result.response.status;
      ctx.set.headers = { ...ctx.set.headers, ...result.response.headers };
      return result.response.body;
    }

    if (
      result.type === "payment-verified" &&
      result.paymentRequirements.scheme === "upto"
    ) {
      const tracking = trackUptoPayment(
        upto.store,
        result.paymentPayload,
        result.paymentRequirements
      );

      if (!tracking.success) {
        ctx.set.status = TRACKING_ERROR_STATUS[tracking.error];
        ctx.set.headers["content-type"] = "application/json";
        return {
          error: tracking.error,
          message: TRACKING_ERROR_MESSAGES[tracking.error],
          sessionId: tracking.sessionId,
        };
      }

      ctx.set.headers["x-upto-session-id"] = tracking.sessionId;
    }
  })

  // Settlement middleware (for exact scheme only)
  .onAfterHandle(async (ctx) => {
    const result = (ctx.request as unknown as Record<symbol, unknown>)[
      X402_RESULT
    ] as
      | {
          type: string;
          paymentPayload?: unknown;
          paymentRequirements?: { scheme: string };
        }
      | undefined;

    if (result?.type !== "payment-verified") return;
    if (result.paymentRequirements?.scheme === "upto") return; // Upto settles via sweeper or /upto-close

    const settlement = await httpServer.processSettlement(
      result.paymentPayload as Parameters<
        typeof httpServer.processSettlement
      >[0],
      result.paymentRequirements as Parameters<
        typeof httpServer.processSettlement
      >[1]
    );

    if (settlement.success) {
      ctx.set.headers = { ...ctx.set.headers, ...settlement.headers };
    } else {
      console.error("Settlement failed:", settlement.errorReason);
    }
  })

  // ---- Routes ----

  .get("/premium", () => ({ message: "premium content (evm)" }))
  .get("/premium-solana", () => ({ message: "premium content (solana)" }))
  .get("/upto-premium", () => ({ message: "premium content (upto evm)" }))

  .get("/upto-session/:id", ({ params }) => {
    const session = upto.store.get(params.id);
    if (!session) return { error: "unknown_session" };
    return { id: params.id, ...formatSession(session) };
  })

  .post("/upto-close", async ({ body, set }) => {
    const { sessionId } = body as { sessionId?: string };
    if (!sessionId) {
      set.status = 400;
      return { error: "missing_session_id" };
    }

    const session = upto.store.get(sessionId);
    if (!session) {
      set.status = 404;
      return { error: "unknown_session" };
    }

    await upto.settleSession(sessionId, "manual_close", true);

    const updated = upto.store.get(sessionId);
    return {
      success: updated?.lastSettlement?.receipt.success ?? true,
      ...formatSession(updated ?? session),
    };
  });

// ============================================================================
// Start Server
// ============================================================================

app.listen(4022);
console.log(`
Paid API listening on http://localhost:${PORT}
Facilitator: ${FACILITATOR_URL}

Endpoints:
  GET  /api/premium          - Exact payment ($0.01 EVM)
  GET  /api/premium-solana   - Exact payment ($0.01 Solana)
  GET  /api/upto-premium     - Batched payment (upto scheme)
  GET  /api/upto-session/:id - Check session status
  POST /api/upto-close       - Close and settle session
`);
