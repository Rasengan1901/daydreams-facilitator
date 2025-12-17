import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
export declare const localFacilitatorClient: {
    verify: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) => Promise<VerifyResponse>;
    settle: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) => Promise<SettleResponse>;
    getSupported: () => Promise<SupportedResponse>;
};
//# sourceMappingURL=client.d.ts.map