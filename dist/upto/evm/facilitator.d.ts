import type { PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
export declare class UptoEvmScheme implements SchemeNetworkFacilitator {
    private readonly signer;
    readonly scheme = "upto";
    readonly caipFamily = "eip155:*";
    constructor(signer: FacilitatorEvmSigner);
    getExtra(_: string): Record<string, unknown> | undefined;
    getSigners(_: string): string[];
    verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
    settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}
//# sourceMappingURL=facilitator.d.ts.map