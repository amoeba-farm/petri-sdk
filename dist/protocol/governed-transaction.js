import { GovernedTransactionValidationError, revalidateBoundGovernedTransactionV1, } from "./governed-transaction-internal.js";
import { currentGovernedWriteReleaseV1 } from "./current-governed-release-internal.js";
export { GovernedTransactionValidationError };
/**
 * Final governance freshness check for exact signed transaction bytes.
 *
 * This is a prerequisite, not transaction authorization: Lean, the operation
 * registry, exact prepared-plan binding, signer policy, and expiry checks remain
 * independently mandatory. The public API takes no identity or tag allowlist;
 * both come only from the certified SDK release train. While that release is
 * unavailable this rejects before parsing bytes or invoking RPC.
 */
export async function revalidateCurrentGovernedTransactionV1(input) {
    const release = currentGovernedWriteReleaseV1();
    return revalidateBoundGovernedTransactionV1({
        ...input,
        release,
    });
}
//# sourceMappingURL=governed-transaction.js.map