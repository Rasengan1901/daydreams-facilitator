import { ExactEvmScheme } from "@x402/evm/exact/server";
/**
 * Minimal v2 resource-server scheme for "upto" on EVM.
 *
 * It reuses ExactEvmScheme's price parsing (USDC default) and simply
 * advertises scheme="upto". Cap should be provided via PaymentOption.extra
 * (e.g. { maxAmountRequired: "50000" }).
 */
export class UptoEvmServerScheme {
    scheme = "upto";
    exact = new ExactEvmScheme();
    registerMoneyParser(parser) {
        this.exact.registerMoneyParser(parser);
        return this;
    }
    parsePrice(price, network) {
        return this.exact.parsePrice(price, network);
    }
    enhancePaymentRequirements(paymentRequirements, _supportedKind, _extensionKeys) {
        return Promise.resolve(paymentRequirements);
    }
}
//# sourceMappingURL=serverScheme.js.map