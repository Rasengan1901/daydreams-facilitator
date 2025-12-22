import { Elysia } from "elysia";
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

export interface ElysiaPaymentState {
  result: HTTPProcessResult;
  tracking?: TrackingResult;
}

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = {
  [Key in Keys]-?: Required<Pick<T, Key>> & Partial<Omit<T, Key>>;
}[Keys];

type ResourceServerRequirement = RequireAtLeastOne<{
  /** Prebuilt HTTP resource server (highest priority). */
  httpServer?: x402HTTPResourceServer;
  /** Prebuilt resource server instance. */
  resourceServer?: x402ResourceServer;
  /** Facilitator client used to build a resource server. */
  facilitatorClient?: FacilitatorClient;
}>;

export type ElysiaPaymentMiddlewareConfig = ResourceServerRequirement & {
  /** Explicit routes config for the HTTP resource server. */
  routes?: RoutesConfig;
  /** Lazy route config resolver (used when routes are collected later). */
  routesResolver?: () => RoutesConfig;
  /** Optional resource server config (used when facilitatorClient is provided). */
  serverConfig?: ResourceServerConfig;
  scope?: "local" | "scoped" | "global";
  pluginName?: string;
  pluginSeed?: unknown;
  paywallConfig?:
    | PaywallConfig
    | ((ctx: { request: Request }) => PaywallConfig | Promise<PaywallConfig>);
  paywallProvider?: PaywallProvider;
  paymentHeaderAliases?: Array<string>;
  autoSettle?: boolean;
  syncFacilitatorOnStart?: boolean;
  upto?: UptoModule;
};

const DEFAULT_PAYMENT_HEADER_ALIASES = ["x-payment"];
const DEFAULT_PLUGIN_NAME = "x402-elysia-payments";
type HeaderValue = string | number;
type HeaderRecord = Record<string, HeaderValue>;

function mergeHeaders(
  current: HeaderRecord | undefined,
  next: HeaderRecord
): HeaderRecord {
  return { ...(current ?? {}), ...next };
}

function isUptoModule(value: unknown): value is UptoModule {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as UptoModule).createSweeper === "function" &&
    typeof (value as UptoModule).settleSession === "function"
  );
}

type ElysiaRequestContext = {
  request: Request;
  body: unknown;
  path?: string;
  route?: string;
};

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
  ctx: ElysiaRequestContext,
  paymentHeaderAliases: Array<string>
): HTTPAdapter {
  const url = resolveUrl(ctx.request);
  const adapterPath =
    typeof ctx.path === "string" && ctx.path.length > 0
      ? normalizePathCandidate(ctx.path)
      : url.pathname;
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
    getHeader: (name) => {
      const direct = ctx.request.headers.get(name);
      if (direct !== null) return direct;

      if (name.toLowerCase() === "payment-signature") {
        for (const alias of paymentHeaderAliases) {
          const aliasValue = ctx.request.headers.get(alias);
          if (aliasValue !== null) return aliasValue;
        }
      }

      return undefined;
    },
    getMethod: () => ctx.request.method,
    getPath: () => adapterPath,
    getUrl: () => ctx.request.url,
    getAcceptHeader: () => ctx.request.headers.get("accept") ?? "",
    getUserAgent: () => ctx.request.headers.get("user-agent") ?? "",
    getQueryParams: () => queryParams,
    getQueryParam: (name) => queryParams[name],
    getBody: () => ctx.body,
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

function resolveRoutes(config: ElysiaPaymentMiddlewareConfig): RoutesConfig {
  if (config.routes) return config.routes;
  if (config.routesResolver) {
    const resolved = config.routesResolver();
    if (!resolved) {
      throw new Error(
        "Elysia payment middleware requires routes from routesResolver."
      );
    }
    return resolved;
  }
  throw new Error("Elysia payment middleware requires routes.");
}

function buildHttpServer(
  config: ElysiaPaymentMiddlewareConfig
): x402HTTPResourceServer {
  if (config.httpServer) return config.httpServer;

  const routes = resolveRoutes(config);

  const resourceServer =
    config.resourceServer ??
    (config.facilitatorClient
      ? createResourceServer(config.facilitatorClient, config.serverConfig)
      : undefined);

  if (!resourceServer) {
    throw new Error(
      "Elysia payment middleware requires a resourceServer or facilitatorClient."
    );
  }

  return new x402HTTPResourceServer(resourceServer, routes);
}

export function createElysiaPaymentMiddleware(
  config: ElysiaPaymentMiddlewareConfig
) {
  let httpServer: x402HTTPResourceServer | undefined;
  const getHttpServer = (): x402HTTPResourceServer => {
    if (!httpServer) {
      httpServer = buildHttpServer(config);
      if (config.paywallProvider) {
        httpServer.registerPaywallProvider(config.paywallProvider);
      }
    }
    return httpServer;
  };
  const paymentHeaderAliases =
    config.paymentHeaderAliases ?? DEFAULT_PAYMENT_HEADER_ALIASES;
  const autoSettle = config.autoSettle ?? true;
  const scope = config.scope ?? "scoped";
  const pluginName = config.pluginName ?? DEFAULT_PLUGIN_NAME;
  const uptoModule = config.upto;
  if (config.upto !== undefined && !isUptoModule(config.upto)) {
    throw new Error("Upto middleware requires an upto module.");
  }
  const sweeperEnabled = Boolean(uptoModule?.autoSweeper);
  const shouldTrackUpto = Boolean(uptoModule?.autoTrack);

  const app = new Elysia({
    name: pluginName,
    ...(config.pluginSeed !== undefined ? { seed: config.pluginSeed } : {}),
  }).decorate("x402", null as ElysiaPaymentState | null);

  if (sweeperEnabled) {
    if (uptoModule?.sweeper) {
      app.use(uptoModule.sweeper);
    } else if (uptoModule?.createSweeper) {
      app.use(uptoModule.createSweeper());
    }
  }

  if (config.syncFacilitatorOnStart ?? true) {
    app.onStart(async () => {
      await getHttpServer().initialize();
    });
  }

  app.onBeforeHandle({ as: scope }, async (ctx) => {
    const httpServer = getHttpServer();
    const adapter = createAdapter(ctx, paymentHeaderAliases);
    const paywallConfig = await resolvePaywallConfig(config.paywallConfig, ctx);
    const path = adapter.getPath();

    const result = await httpServer.processHTTPRequest(
      {
        adapter,
        path,
        method: adapter.getMethod(),
      },
      paywallConfig
    );

    ctx.x402 = { result };

    if (result.type === "payment-error") {
      ctx.set.status = result.response.status;
      ctx.set.headers = mergeHeaders(ctx.set.headers, result.response.headers);
      return result.response.body;
    }

    if (
      result.type === "payment-verified" &&
      result.paymentRequirements.scheme === "upto"
    ) {
      if (!uptoModule) {
        throw new Error("Upto middleware requires an upto module.");
      }
      if (!shouldTrackUpto) {
        return;
      }
      const tracking = trackUptoPayment(
        uptoModule.store,
        result.paymentPayload,
        result.paymentRequirements
      );

      ctx.x402 = { result, tracking };

      if (!tracking.success) {
        ctx.set.status = TRACKING_ERROR_STATUS[tracking.error];
        ctx.set.headers = mergeHeaders(ctx.set.headers, {
          "content-type": "application/json",
        });
        return {
          error: tracking.error,
          message: TRACKING_ERROR_MESSAGES[tracking.error],
          sessionId: tracking.sessionId,
        };
      }
    }
  });

  app.onAfterHandle({ as: scope }, async (ctx) => {
    const state = ctx.x402;

    if (!state || state.result.type !== "payment-verified") return;

    if (state.result.paymentRequirements.scheme === "upto") {
      if (state.tracking?.success) {
        ctx.set.headers = mergeHeaders(ctx.set.headers, {
          "x-upto-session-id": state.tracking.sessionId,
        });
      }
      return;
    }

    if (!autoSettle) return;

    const httpServer = getHttpServer();
    const settlement = await httpServer.processSettlement(
      state.result.paymentPayload,
      state.result.paymentRequirements
    );

    if (settlement.success) {
      ctx.set.headers = mergeHeaders(ctx.set.headers, settlement.headers);
    }
  });

  return app;
}
