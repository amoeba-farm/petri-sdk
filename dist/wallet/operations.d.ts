/** Browser-native RC44 operation reconstruction from fresh finalized account bytes. */
import { TransactionInstruction } from "@solana/web3.js";
import { type CurrentWalletReobservation } from "./observation.js";
import type { CurrentCollectiveOperationPrepareEnvelope } from "./plans.js";
/** Validate original signed governance bytes, reconstruct the business view, then return only the original bytes. */
export declare function validateAndMaterializeCollectivePlan(envelope: CurrentCollectiveOperationPrepareEnvelope, reobservation: CurrentWalletReobservation): readonly (readonly TransactionInstruction[])[];
//# sourceMappingURL=operations.d.ts.map