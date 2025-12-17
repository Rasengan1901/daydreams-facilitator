import { UptoEvmScheme } from "./facilitator.js";
export function registerUptoEvmScheme(facilitator, config) {
    facilitator.register(config.networks, new UptoEvmScheme(config.signer));
    return facilitator;
}
//# sourceMappingURL=register.js.map