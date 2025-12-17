import { getAddress, parseSignature } from "viem";
function errorSummary(error) {
    if (!error)
        return "unknown_error";
    if (typeof error === "string")
        return error;
    if (error instanceof Error)
        return error.message;
    if (typeof error === "object") {
        const anyErr = error;
        if (typeof anyErr.shortMessage === "string")
            return anyErr.shortMessage;
        if (typeof anyErr.message === "string")
            return anyErr.message;
    }
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
const permitAbi = [
    {
        type: "function",
        name: "permit",
        stateMutability: "nonpayable",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "v", type: "uint8" },
            { name: "r", type: "bytes32" },
            { name: "s", type: "bytes32" },
        ],
        outputs: [],
    },
];
const erc20Abi = [
    {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ name: "amount", type: "uint256" }],
    },
    {
        type: "function",
        name: "transferFrom",
        stateMutability: "nonpayable",
        inputs: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
        ],
        outputs: [{ name: "success", type: "bool" }],
    },
];
function toBigInt(value) {
    if (!value)
        return 0n;
    try {
        return BigInt(value);
    }
    catch {
        return 0n;
    }
}
export class UptoEvmScheme {
    signer;
    scheme = "upto";
    caipFamily = "eip155:*";
    constructor(signer) {
        this.signer = signer;
    }
    getExtra(_) {
        return undefined;
    }
    getSigners(_) {
        return [...this.signer.getAddresses()];
    }
    async verify(payload, requirements) {
        const uptoPayload = payload.payload;
        const authorization = uptoPayload.authorization;
        const payer = authorization?.from;
        if (payload.accepted.scheme !== "upto" || requirements.scheme !== "upto") {
            return {
                isValid: false,
                invalidReason: "unsupported_scheme",
                payer,
            };
        }
        if (!authorization || !uptoPayload.signature) {
            return {
                isValid: false,
                invalidReason: "invalid_upto_evm_payload",
                payer,
            };
        }
        const owner = authorization.from;
        const spender = authorization.to ?? requirements.payTo;
        const nonce = authorization.nonce;
        const validBefore = authorization.validBefore;
        const value = authorization.value;
        if (!owner || !spender || !nonce || !validBefore || !value) {
            return {
                isValid: false,
                invalidReason: "invalid_upto_evm_payload",
                payer,
            };
        }
        const ownerAddress = getAddress(owner);
        const spenderAddress = getAddress(spender);
        if (payload.accepted.network !== requirements.network) {
            return {
                isValid: false,
                invalidReason: "network_mismatch",
                payer,
            };
        }
        const extra = requirements.extra;
        const name = extra?.name;
        const version = extra?.version;
        if (!name || !version) {
            return {
                isValid: false,
                invalidReason: "missing_eip712_domain",
                payer,
            };
        }
        // The spender in the permit must be this facilitator (who will call transferFrom),
        // NOT the payTo address (who receives the payment)
        const facilitatorAddresses = this.signer
            .getAddresses()
            .map((a) => getAddress(a));
        if (!facilitatorAddresses.includes(spenderAddress)) {
            return {
                isValid: false,
                invalidReason: "spender_not_facilitator",
                payer,
            };
        }
        const cap = toBigInt(value);
        const requiredAmount = toBigInt(requirements.amount);
        if (cap < requiredAmount) {
            return {
                isValid: false,
                invalidReason: "cap_too_low",
                payer,
            };
        }
        const maxAmountRequired = toBigInt(extra?.maxAmountRequired ??
            extra?.maxAmount);
        if (maxAmountRequired > 0n && cap < maxAmountRequired) {
            return {
                isValid: false,
                invalidReason: "cap_below_required_max",
                payer,
            };
        }
        const now = BigInt(Math.floor(Date.now() / 1000));
        const deadline = toBigInt(validBefore);
        if (deadline < now + 6n) {
            return {
                isValid: false,
                invalidReason: "authorization_expired",
                payer,
            };
        }
        const chainId = Number(requirements.network.split(":")[1]);
        if (!Number.isFinite(chainId)) {
            return {
                isValid: false,
                invalidReason: "invalid_chain_id",
                payer,
            };
        }
        const permitTypedData = {
            types: {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            },
            primaryType: "Permit",
            domain: {
                name,
                version,
                chainId,
                verifyingContract: getAddress(requirements.asset),
            },
            message: {
                owner: ownerAddress,
                spender: spenderAddress,
                value: cap,
                nonce: toBigInt(nonce),
                deadline,
            },
        };
        try {
            const ok = await this.signer.verifyTypedData({
                address: ownerAddress,
                domain: permitTypedData.domain,
                types: permitTypedData.types,
                primaryType: permitTypedData.primaryType,
                message: permitTypedData.message,
                signature: uptoPayload.signature,
            });
            if (!ok) {
                return {
                    isValid: false,
                    invalidReason: "invalid_permit_signature",
                    payer,
                };
            }
        }
        catch {
            return {
                isValid: false,
                invalidReason: "invalid_permit_signature",
                payer,
            };
        }
        return {
            isValid: true,
            payer,
        };
    }
    async settle(payload, requirements) {
        const verification = await this.verify(payload, requirements);
        if (!verification.isValid) {
            return {
                success: false,
                errorReason: verification.invalidReason ?? "invalid_upto_evm_payload",
                transaction: "",
                network: payload.accepted.network,
                payer: verification.payer,
            };
        }
        const uptoPayload = payload.payload;
        const authorization = uptoPayload.authorization;
        const payer = getAddress(authorization.from);
        const spender = getAddress((authorization.to ?? requirements.payTo));
        const cap = toBigInt(authorization.value);
        const totalSpent = toBigInt(requirements.amount);
        if (totalSpent > cap) {
            return {
                success: false,
                errorReason: "total_exceeds_cap",
                transaction: "",
                network: payload.accepted.network,
                payer,
            };
        }
        const erc20Address = getAddress(requirements.asset);
        // Permit signatures are ECDSA 65-byte only for now.
        let parsedSig = null;
        try {
            parsedSig = parseSignature(uptoPayload.signature);
        }
        catch {
            parsedSig = null;
        }
        if (!parsedSig || (!parsedSig.v && parsedSig.yParity === undefined)) {
            return {
                success: false,
                errorReason: "unsupported_signature_type",
                transaction: "",
                network: payload.accepted.network,
                payer,
            };
        }
        const v = parsedSig.v ?? parsedSig.yParity;
        const r = parsedSig.r;
        const s = parsedSig.s;
        const deadline = toBigInt(authorization.validBefore);
        // 1) Try to apply permit for the cap.
        let permitError;
        try {
            const permitTx = await this.signer.writeContract({
                address: erc20Address,
                abi: permitAbi,
                functionName: "permit",
                args: [payer, spender, cap, deadline, v, r, s],
            });
            await this.signer.waitForTransactionReceipt({ hash: permitTx });
        }
        catch (error) {
            permitError = error;
            // If permit fails (already used), rely on allowance.
            try {
                const allowance = (await this.signer.readContract({
                    address: erc20Address,
                    abi: erc20Abi,
                    functionName: "allowance",
                    args: [payer, spender],
                }));
                if (allowance < totalSpent) {
                    console.error("Permit failed:", errorSummary(permitError));
                    console.error("Allowance insufficient:", {
                        allowance: allowance.toString(),
                        required: totalSpent.toString(),
                        payer,
                        spender,
                        asset: erc20Address,
                    });
                    return {
                        success: false,
                        errorReason: "insufficient_allowance",
                        transaction: "",
                        network: payload.accepted.network,
                        payer,
                    };
                }
            }
            catch {
                return {
                    success: false,
                    errorReason: "permit_failed",
                    transaction: "",
                    network: payload.accepted.network,
                    payer,
                };
            }
        }
        // 2) transferFrom totalSpent to payTo.
        try {
            const tx = await this.signer.writeContract({
                address: erc20Address,
                abi: erc20Abi,
                functionName: "transferFrom",
                args: [payer, getAddress(requirements.payTo), totalSpent],
            });
            const receipt = await this.signer.waitForTransactionReceipt({ hash: tx });
            if (receipt.status !== "success") {
                return {
                    success: false,
                    errorReason: "invalid_transaction_state",
                    transaction: tx,
                    network: payload.accepted.network,
                    payer,
                };
            }
            return {
                success: true,
                transaction: tx,
                network: payload.accepted.network,
                payer,
            };
        }
        catch (error) {
            console.error("Failed to settle upto payment:", error);
            return {
                success: false,
                errorReason: "transaction_failed",
                transaction: "",
                network: payload.accepted.network,
                payer,
            };
        }
    }
}
//# sourceMappingURL=facilitator.js.map