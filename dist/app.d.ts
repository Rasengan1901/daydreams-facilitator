import { Elysia } from "elysia";
import type { SettleResponse, VerifyResponse } from "@x402/core/types";
export declare const app: Elysia<"", {
    decorator: {};
    store: {
        readonly startTime?: number | undefined;
        readonly endTime?: number | undefined;
        readonly responseTime?: number | undefined;
    };
    derive: {
        readonly log: import("@bogeychan/elysia-logger/types").Logger;
    };
    resolve: {};
}, {
    typebox: {};
    error: {};
} & {
    typebox: {};
    error: {};
}, {
    schema: {};
    standaloneSchema: {};
    macro: {};
    macroFn: {};
    parser: {};
    response: {};
} & {
    schema: {};
    standaloneSchema: {};
    macro: {};
    macroFn: {};
    parser: {};
    response: {};
}, {
    verify: {
        post: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: VerifyResponse;
                400: {
                    readonly error: "Missing paymentPayload or paymentRequirements";
                };
                500: {
                    readonly error: string;
                };
            };
        };
    };
} & {
    settle: {
        post: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: SettleResponse;
                400: {
                    readonly error: "Missing paymentPayload or paymentRequirements";
                };
                500: {
                    readonly error: string;
                };
            };
        };
    };
} & {
    supported: {
        get: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: {
                    kinds: Array<{
                        x402Version: number;
                        scheme: string;
                        network: string;
                        extra?: Record<string, unknown>;
                    }>;
                    extensions: string[];
                    signers: Record<string, string[]>;
                };
                500: {
                    readonly error: string;
                };
            };
        };
    };
}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
} & {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
} & {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}>;
//# sourceMappingURL=app.d.ts.map