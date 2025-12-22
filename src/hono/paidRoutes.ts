import type { Hono } from "hono";
import type { RouteConfig, RoutesConfig } from "@x402/core/http";

type HttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "options"
  | "all";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => any;

export interface PaidRouteOptions {
  payment?: RouteConfig;
}

export interface PaidRoutesOptions {
  basePath?: string;
}

export interface PaidRoutes {
  routes: RoutesConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply<T extends Hono<any>>(app: T): T;
  get(path: string, handler: AnyHandler, options?: PaidRouteOptions): PaidRoutes;
  post(path: string, handler: AnyHandler, options?: PaidRouteOptions): PaidRoutes;
  put(path: string, handler: AnyHandler, options?: PaidRouteOptions): PaidRoutes;
  patch(path: string, handler: AnyHandler, options?: PaidRouteOptions): PaidRoutes;
  delete(path: string, handler: AnyHandler, options?: PaidRouteOptions): PaidRoutes;
  options(path: string, handler: AnyHandler, options?: PaidRouteOptions): PaidRoutes;
  all(path: string, handler: AnyHandler, options?: PaidRouteOptions): PaidRoutes;
}

interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: AnyHandler;
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath) return "";
  if (basePath === "/") return "";
  const trimmed = basePath.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function normalizeRoutePath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

function joinPaths(basePath: string, path: string): string {
  const normalizedPath = normalizeRoutePath(path);
  if (!basePath) return normalizedPath;
  if (normalizedPath === "/") return basePath;
  return `${basePath}${normalizedPath}`;
}

function toX402RoutePattern(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "[$1]");
}

export function createPaidRoutes(options: PaidRoutesOptions = {}): PaidRoutes {
  const basePath = normalizeBasePath(options.basePath);
  const routes: Record<string, RouteConfig> = {};
  const definitions: Array<RouteDefinition> = [];

  const register = (
    method: HttpMethod,
    path: string,
    handler: AnyHandler,
    opts?: PaidRouteOptions
  ): PaidRoutes => {
    const payment = opts?.payment;

    if (payment) {
      const fullPath = joinPaths(basePath, path);
      const routeKey = `${method.toUpperCase()} ${toX402RoutePattern(fullPath)}`;

      if (routes[routeKey]) {
        throw new Error(`Duplicate payment config for ${routeKey}`);
      }

      routes[routeKey] = payment;
    }

    definitions.push({ method, path, handler });
    return api;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apply = <T extends Hono<any>>(app: T): T => {
    for (const definition of definitions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registrar = (app as any)[definition.method];

      if (!registrar) {
        throw new Error(
          `Hono app missing method '${definition.method}' for ${definition.path}`
        );
      }

      registrar.call(app, definition.path, definition.handler);
    }
    return app;
  };

  const api: PaidRoutes = {
    routes,
    apply,
    get: (path, handler, opts) => register("get", path, handler, opts),
    post: (path, handler, opts) => register("post", path, handler, opts),
    put: (path, handler, opts) => register("put", path, handler, opts),
    patch: (path, handler, opts) => register("patch", path, handler, opts),
    delete: (path, handler, opts) => register("delete", path, handler, opts),
    options: (path, handler, opts) => register("options", path, handler, opts),
    all: (path, handler, opts) => register("all", path, handler, opts),
  };

  return api;
}
