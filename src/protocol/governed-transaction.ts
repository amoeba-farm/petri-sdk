import {
  GovernedTransactionValidationError,
  revalidateBoundGovernedTransactionV1,
  type GovernedTransactionRpcV1,
  type GovernedTransactionValidationV1,
} from "./governed-transaction-internal.js";
import { currentGovernedWriteReleaseV1 } from "./current-governed-release-internal.js";

export { GovernedTransactionValidationError };
export type { GovernedTransactionRpcV1, GovernedTransactionValidationV1 };

export interface RevalidateCurrentGovernedTransactionV1Input {
  /** A signed canonical legacy or v0 transaction, exactly as Edge will submit it. */
  readonly serializedTransactionBase64: string;
  /** Finalized floor already trusted by the surrounding prepare/submit workflow. */
  readonly minimumContextSlot: number;
  /** Connection-compatible read capability; no send or signing method is accepted. */
  readonly rpc: GovernedTransactionRpcV1;
}

/**
 * Final governance freshness check for exact signed transaction bytes.
 *
 * This is a prerequisite, not transaction authorization: Lean, the operation
 * registry, exact prepared-plan binding, signer policy, and expiry checks remain
 * independently mandatory. The public API takes no identity or tag allowlist;
 * both come only from the certified SDK release train. While that release is
 * unavailable this rejects before parsing bytes or invoking RPC.
 */
export async function revalidateCurrentGovernedTransactionV1(
  input: RevalidateCurrentGovernedTransactionV1Input,
): Promise<GovernedTransactionValidationV1> {
  const release = currentGovernedWriteReleaseV1();
  return revalidateBoundGovernedTransactionV1({
    ...input,
    release,
  });
}
