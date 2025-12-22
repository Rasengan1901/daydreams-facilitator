import type { Request, Response, NextFunction, RequestHandler } from "express";
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

export interface ExpressPaymentState {
  result: HTTPProcessResult;
  tracking?: TrackingResult;
}

export interface ExpressPaymentMiddlewareConfig {
  httpServer?: x402HTTPResourceServer;
  resourceServer?: x402ResourceServer;
  facilitatorClient?: FacilitatorClient;
  routes?: RoutesConfig;
  serverConfig?: ResourceServerConfig;
  paywallConfig?:
    | PaywallConfig
    | ((req: Request) => PaywallConfig | Promise<PaywallConfig>);
  paywallProvider?: PaywallProvider;
  paymentHeaderAliases?: Array<string>;
  autoSettle?: boolean;
  upto?: UptoModule;
}

const DEFAULT_PAYMENT_HEADER_ALIASES = ["x-payment"];

declare global {
  namespace Express {
    interface Request {
      x402?: ExpressPaymentState | null;
    }
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

function createAdapter(
  req: Request,
  paymentHeaderAliases: Array<string>
): HTTPAdapter {
  const protocol = req.protocol || "http";
  const host = req.get("host") || "localhost";
  const url = new URL(req.originalUrl || req.url, `${protocol}://${host}`);
  const adapterPath = req.path || url.pathname;
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
      const direct = req.get(name);
      if (direct !== undefined) return direct;

      if (name.toLowerCase() === "payment-signature") {
        for (const alias of paymentHeaderAliases) {
          const aliasValue = req.get(alias);
          if (aliasValue !== undefined) return aliasValue;
        }
      }

      return undefined;
    },
    getMethod: () => req.method,
    getPath: () => normalizePathCandidate(adapterPath),
    getUrl: () => url.toString(),
    getAcceptHeader: () => req.get("accept") ?? "",
    getUserAgent: () => req.get("user-agent") ?? "",
    getQueryParams: () => queryParams,
    getQueryParam: (name) => queryParams[name],
    getBody: () => req.body,
  };
}

async function resolvePaywallConfig(
  source:
    | PaywallConfig
    | ((req: Request) => PaywallConfig | Promise<PaywallConfig>)
    | undefined,
  req: Request
): Promise<PaywallConfig | undefined> {
  if (!source) return undefined;
  if (typeof source === "function") {
    return source(req);
  }
  return source;
}

function resolveHttpServer(
  config: ExpressPaymentMiddlewareConfig
): x402HTTPResourceServer {
  if (config.httpServer) return config.httpServer;

  if (!config.routes) {
    throw new Error("Express payment middleware requires routes.");
  }

  const resourceServer =
    config.resourceServer ??
    (config.facilitatorClient
      ? createResourceServer(config.facilitatorClient, config.serverConfig)
      : undefined);

  if (!resourceServer) {
    throw new Error(
      "Express payment middleware requires a resourceServer or facilitatorClient."
    );
  }

  return new x402HTTPResourceServer(resourceServer, config.routes);
}

export function createExpressPaymentMiddleware(
  config: ExpressPaymentMiddlewareConfig
): RequestHandler {
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

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!initialized) {
        await httpServer.initialize();
        initialized = true;
      }

      req.x402 = null;

      const adapter = createAdapter(req, paymentHeaderAliases);
      const paywallConfig = await resolvePaywallConfig(config.paywallConfig, req);
      const path = adapter.getPath();

      const result = await httpServer.processHTTPRequest(
        {
          adapter,
          path,
          method: adapter.getMethod(),
        },
        paywallConfig
      );

      let state: ExpressPaymentState = { result };
      req.x402 = state;

      if (result.type === "payment-error") {
        for (const [key, value] of Object.entries(result.response.headers)) {
          res.setHeader(key, String(value));
        }
        res.status(result.response.status).json(result.response.body);
        return;
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
          req.x402 = state;

          if (!tracking.success) {
            res.status(TRACKING_ERROR_STATUS[tracking.error]).json({
              error: tracking.error,
              message: TRACKING_ERROR_MESSAGES[tracking.error],
              sessionId: tracking.sessionId,
            });
            return;
          }
        }
      }

      // Intercept response to add settlement headers after handler completes
      const originalSend = res.send.bind(res);
      let settlementHandled = false;

      const handleAfterResponse = async () => {
        if (settlementHandled) return;
        settlementHandled = true;

        const finalState = req.x402;
        if (!finalState || finalState.result.type !== "payment-verified") return;

        if (finalState.result.paymentRequirements.scheme === "upto") {
          if (finalState.tracking?.success) {
            res.setHeader("x-upto-session-id", finalState.tracking.sessionId);
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
            res.setHeader(key, String(value));
          }
        }
      };

      // Override res.send to inject settlement before sending
      // res.send calls res.end internally, so we only need to intercept send
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res.send = function (body?: any) {
        handleAfterResponse().then(() => {
          originalSend(body);
        }).catch(() => {
          originalSend(body);
        });
        return res;
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getHttpServer(
  config: ExpressPaymentMiddlewareConfig
): x402HTTPResourceServer {
  return resolveHttpServer(config);
}

export async function initializeHttpServer(
  config: ExpressPaymentMiddlewareConfig
): Promise<x402HTTPResourceServer> {
  const httpServer = resolveHttpServer(config);
  await httpServer.initialize();
  return httpServer;
}
