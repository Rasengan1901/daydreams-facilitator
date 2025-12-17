import { Elysia } from "elysia";
import type { UptoSessionStore } from "./store.js";
import { type UptoFacilitatorClient } from "./settlement.js";
export interface UptoSweeperConfig {
    store: UptoSessionStore;
    facilitatorClient: UptoFacilitatorClient;
    idleSettleMs?: number;
    longIdleCloseMs?: number;
    deadlineBufferSec?: number;
    capThresholdNum?: bigint;
    capThresholdDen?: bigint;
    intervalMs?: number;
}
export declare function createUptoSweeper(config: UptoSweeperConfig): Elysia<"", {
    decorator: {};
    store: {};
    derive: {};
    resolve: {};
}, {
    typebox: {};
    error: {};
}, {
    schema: {};
    standaloneSchema: {};
    macro: {};
    macroFn: {};
    parser: {};
    response: {};
}, {}, {
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
}>;
//# sourceMappingURL=sweeper.d.ts.map