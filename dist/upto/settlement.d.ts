import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import type { UptoSessionStore } from "./store.js";
export type UptoFacilitatorClient = {
    settle: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) => Promise<SettleResponse>;
};
export declare function settleUptoSession(store: UptoSessionStore, facilitatorClient: UptoFacilitatorClient, sessionId: string, reason: string, closeAfter?: boolean, deadlineBufferSec?: number): Promise<void>;
//# sourceMappingURL=settlement.d.ts.map