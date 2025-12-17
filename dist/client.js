import { facilitator } from "./setup.js";
export const localFacilitatorClient = {
    verify: (paymentPayload, paymentRequirements) => facilitator.verify(paymentPayload, paymentRequirements),
    settle: (paymentPayload, paymentRequirements) => facilitator.settle(paymentPayload, paymentRequirements),
    getSupported: async () => facilitator.getSupported(),
};
//# sourceMappingURL=client.js.map