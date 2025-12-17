import { x402Facilitator } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
export interface UptoEvmFacilitatorConfig {
    signer: FacilitatorEvmSigner;
    networks: Network | Network[];
}
export declare function registerUptoEvmScheme(facilitator: x402Facilitator, config: UptoEvmFacilitatorConfig): x402Facilitator;
//# sourceMappingURL=register.d.ts.map