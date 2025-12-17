/**
 * Default signers using raw private keys.
 * Only loaded when CDP credentials are not configured.
 */
export declare const evmAccount: {
    address: import("viem").Address;
    nonceManager?: import("viem").NonceManager | undefined;
    sign: (parameters: {
        hash: import("viem").Hash;
    }) => Promise<import("viem").Hex>;
    signAuthorization: (parameters: import("viem").AuthorizationRequest) => Promise<import("viem/accounts").SignAuthorizationReturnType>;
    signMessage: ({ message }: {
        message: import("viem").SignableMessage;
    }) => Promise<import("viem").Hex>;
    signTransaction: <serializer extends import("viem").SerializeTransactionFn<import("viem").TransactionSerializable> = import("viem").SerializeTransactionFn<import("viem").TransactionSerializable>, transaction extends Parameters<serializer>[0] = Parameters<serializer>[0]>(transaction: transaction, options?: {
        serializer?: serializer | undefined;
    } | undefined) => Promise<import("viem").Hex>;
    signTypedData: <const typedData extends import("viem").TypedData | Record<string, unknown>, primaryType extends keyof typedData | "EIP712Domain" = keyof typedData>(parameters: import("viem").TypedDataDefinition<typedData, primaryType>) => Promise<import("viem").Hex>;
    publicKey: import("viem").Hex;
    source: "privateKey";
    type: "local";
};
export declare const svmAccount: import("@solana/kit").KeyPairSigner<string>;
export declare const evmSigner: import("@x402/evm").FacilitatorEvmSigner;
export declare const svmSigner: import("@x402/svm").FacilitatorSvmSigner;
//# sourceMappingURL=default.d.ts.map