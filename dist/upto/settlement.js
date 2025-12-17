export async function settleUptoSession(store, facilitatorClient, sessionId, reason, closeAfter = false, deadlineBufferSec = 60) {
    const session = store.get(sessionId);
    if (!session)
        return;
    if (session.status === "settling")
        return;
    const initialStatus = session.status;
    if (session.pendingSpent <= 0n) {
        if (closeAfter) {
            session.status = "closed";
            store.set(sessionId, session);
        }
        return;
    }
    session.status = "settling";
    store.set(sessionId, session);
    const settleAmount = session.pendingSpent;
    const settleRequirements = {
        ...session.paymentRequirements,
        amount: settleAmount.toString(),
    };
    let receipt;
    try {
        receipt = await facilitatorClient.settle(session.paymentPayload, settleRequirements);
    }
    catch (error) {
        receipt = {
            success: false,
            errorReason: error instanceof Error ? error.message : "settlement_failed",
            transaction: "",
            network: session.paymentPayload.accepted.network,
            payer: undefined,
        };
    }
    if (receipt.success) {
        session.settledTotal += settleAmount;
        session.pendingSpent = 0n;
    }
    session.lastSettlement = {
        atMs: Date.now(),
        reason,
        receipt,
    };
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (receipt.success) {
        if (closeAfter ||
            session.settledTotal >= session.cap ||
            session.deadline <= nowSec + BigInt(deadlineBufferSec)) {
            session.status = "closed";
        }
        else {
            session.status = "open";
        }
    }
    else {
        // If settlement failed, keep the session retryable.
        // - On manual close: mark closed (stop accrual) but allow re-close retries.
        // - Otherwise: restore prior status.
        session.status = closeAfter ? "closed" : initialStatus;
    }
    store.set(sessionId, session);
}
//# sourceMappingURL=settlement.js.map