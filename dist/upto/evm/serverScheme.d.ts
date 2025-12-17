import type { AssetAmount, MoneyParser, Network, PaymentRequirements, Price, SchemeNetworkServer } from "@x402/core/types";
/**
 * Minimal v2 resource-server scheme for "upto" on EVM.
 *
 * It reuses ExactEvmScheme's price parsing (USDC default) and simply
 * advertises scheme="upto". Cap should be provided via PaymentOption.extra
 * (e.g. { maxAmountRequired: "50000" }).
 */
export declare class UptoEvmServerScheme implements SchemeNetworkServer {
    readonly scheme = "upto";
    private readonly exact;
    registerMoneyParser(parser: MoneyParser): this;
    parsePrice(price: Price, network: Network): Promise<AssetAmount>;
    enhancePaymentRequirements(paymentRequirements: PaymentRequirements, _supportedKind: {
        x402Version: number;
        scheme: string;
        network: Network;
        extra?: Record<string, unknown>;
    }, _extensionKeys: string[]): Promise<PaymentRequirements>;
}
//# sourceMappingURL=serverScheme.d.ts.map