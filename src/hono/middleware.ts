import type { Context, MiddlewareHandler } from "hono";
import {
  x402HTTPResourceServer,
  type HTTPAdapter,
  type HTTPProcessResult,
  type PaywallConfig,
  type PaywallProvider,
  type RoutesConfig,
} from "@x402/core/http";
import type { x402ResourceServer, FacilitatorClient } from "@x402/core/server";

import {
  trackUptoPayment,
  TRACKING_ERROR_MESSAGES,
  TRACKING_ERROR_STATUS,
  type TrackingResult,
  type UptoModule,
} from "../upto/lib.js";
import { createResourceServer, type ResourceServerConfig } from "../server.js";

export interface HonoPaymentState {
  result: HTTPProcessResult;
  tracking?: TrackingResult;
}

export interface HonoPaymentMiddlewareConfig {
  httpServer?: x402HTTPResourceServer;
  resourceServer?: x402ResourceServer;
  facilitatorClient?: FacilitatorClient;
  routes?: RoutesConfig;
  serverConfig?: ResourceServerConfig;
  paywallConfig?:
    | PaywallConfig
    | ((ctx: { request: Request }) => PaywallConfig | Promise<PaywallConfig>);
  paywallProvider?: PaywallProvider;
  paymentHeaderAliases?: Array<string>;
  autoSettle?: boolean;
  upto?: UptoModule;
}

const DEFAULT_PAYMENT_HEADER_ALIASES = ["x-payment"];

declare module "hono" {
  interface ContextVariableMap {
    x402: HonoPaymentState | null;
  }
}

function isUptoModule(value: unknown): value is UptoModule {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as UptoModule).createSweeper === "function" &&
    typeof (value as UptoModule).settleSession === "function"
  );
}

function normalizePathCandidate(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function resolveUrl(request: Request): URL {
  if (request.url.startsWith("http://") || request.url.startsWith("https://")) {
    return new URL(request.url);
  }
  return new URL(request.url, "http://localhost");
}

function createAdapter(
  c: Context,
  paymentHeaderAliases: Array<string>
): HTTPAdapter {
  const request = c.req.raw;
  const url = resolveUrl(request);
  const adapterPath = c.req.path || url.pathname;
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

  let cachedBody: unknown = undefined;
  let bodyParsed = false;

  return {
    getHeader: (name) => {
      const direct = request.headers.get(name);
      if (direct !== null) return direct;

      if (name.toLowerCase() === "payment-signature") {
        for (const alias of paymentHeaderAliases) {
          const aliasValue = request.headers.get(alias);
          if (aliasValue !== null) return aliasValue;
        }
      }

      return undefined;
    },
    getMethod: () => request.method,
    getPath: () => normalizePathCandidate(adapterPath),
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") ?? "",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
    getQueryParams: () => queryParams,
    getQueryParam: (name) => queryParams[name],
    getBody: () => {
      if (!bodyParsed) {
        try {
          cachedBody = c.req.parseBody();
        } catch {
          cachedBody = undefined;
        }
        bodyParsed = true;
      }
      return cachedBody;
    },
  };
}

async function resolvePaywallConfig(
  source:
    | PaywallConfig
    | ((ctx: { request: Request }) => PaywallConfig | Promise<PaywallConfig>)
    | undefined,
  ctx: { request: Request }
): Promise<PaywallConfig | undefined> {
  if (!source) return undefined;
  if (typeof source === "function") {
    return source(ctx);
  }
  return source;
}

function resolveHttpServer(
  config: HonoPaymentMiddlewareConfig
): x402HTTPResourceServer {
  if (config.httpServer) return config.httpServer;

  if (!config.routes) {
    throw new Error("Hono payment middleware requires routes.");
  }

  const resourceServer =
    config.resourceServer ??
    (config.facilitatorClient
      ? createResourceServer(config.facilitatorClient, config.serverConfig)
      : undefined);

  if (!resourceServer) {
    throw new Error(
      "Hono payment middleware requires a resourceServer or facilitatorClient."
    );
  }

  return new x402HTTPResourceServer(resourceServer, config.routes);
}

export function createHonoPaymentMiddleware(
  config: HonoPaymentMiddlewareConfig
): MiddlewareHandler {
  const httpServer = resolveHttpServer(config);
  const paymentHeaderAliases =
    config.paymentHeaderAliases ?? DEFAULT_PAYMENT_HEADER_ALIASES;
  const autoSettle = config.autoSettle ?? true;
  const uptoModule = config.upto;
  if (config.upto !== undefined && !isUptoModule(config.upto)) {
    throw new Error("Upto middleware requires an upto module.");
  }
  const autoTrack = Boolean(uptoModule?.autoTrack);

  if (config.paywallProvider) {
    httpServer.registerPaywallProvider(config.paywallProvider);
  }

  let initialized = false;

  return async (c, next) => {
    if (!initialized) {
      await httpServer.initialize();
      initialized = true;
    }

    c.set("x402", null);

    const adapter = createAdapter(c, paymentHeaderAliases);
    const paywallConfig = await resolvePaywallConfig(config.paywallConfig, {
      request: c.req.raw,
    });
    const path = adapter.getPath();

    const result = await httpServer.processHTTPRequest(
      {
        adapter,
        path,
        method: adapter.getMethod(),
      },
      paywallConfig
    );

    let state: HonoPaymentState = { result };
    c.set("x402", state);

    if (result.type === "payment-error") {
      const headers = new Headers();
      for (const [key, value] of Object.entries(result.response.headers)) {
        headers.set(key, String(value));
      }
      return c.json(result.response.body, {
        status: result.response.status as 402,
        headers,
      });
    }

    if (
      result.type === "payment-verified" &&
      result.paymentRequirements.scheme === "upto"
    ) {
      if (!uptoModule) {
        throw new Error("Upto middleware requires an upto module.");
      }
      if (autoTrack) {
        const tracking = trackUptoPayment(
          uptoModule.store,
          result.paymentPayload,
          result.paymentRequirements
        );

        state = { result, tracking };
        c.set("x402", state);

        if (!tracking.success) {
          return c.json(
            {
              error: tracking.error,
              message: TRACKING_ERROR_MESSAGES[tracking.error],
              sessionId: tracking.sessionId,
            },
            { status: TRACKING_ERROR_STATUS[tracking.error] as 400 }
          );
        }
      }
    }

    await next();

    const finalState = c.get("x402");
    if (!finalState || finalState.result.type !== "payment-verified") return;

    if (finalState.result.paymentRequirements.scheme === "upto") {
      if (finalState.tracking?.success) {
        c.header("x-upto-session-id", finalState.tracking.sessionId);
      }
      return;
    }

    if (!autoSettle) return;

    const settlement = await httpServer.processSettlement(
      finalState.result.paymentPayload,
      finalState.result.paymentRequirements
    );

    if (settlement.success) {
      for (const [key, value] of Object.entries(settlement.headers)) {
        c.header(key, String(value));
      }
    }
  };
}

export function getHttpServer(
  config: HonoPaymentMiddlewareConfig
): x402HTTPResourceServer {
  return resolveHttpServer(config);
}

export async function initializeHttpServer(
  config: HonoPaymentMiddlewareConfig
): Promise<x402HTTPResourceServer> {
  const httpServer = resolveHttpServer(config);
  await httpServer.initialize();
  return httpServer;
}
