import { AmebaProtocolError } from "../errors.js";
import { CURRENT_LIVE_DEPLOYMENT as live } from "./release-train.js";
import { observeCurrentV3RuntimeAfterGenesisV1 } from "./current-v3-runtime-internal.js";
/** Finalized deployment and business readiness, distinct from package capability. */
export async function observeCurrentV3RuntimeV1(input) {
    if (!Number.isSafeInteger(input.minimumContextSlot) || input.minimumContextSlot < live.minimumContextSlot) {
        throw new AmebaProtocolError("finalized slot floor precedes the V3 release evidence", { code: "CURRENT_V3_CONTEXT_INVALID" });
    }
    if (await input.rpc.getGenesisHash() !== live.genesisHash) {
        throw new AmebaProtocolError("RPC is not the exact Devnet genesis", { code: "CURRENT_V3_GENESIS_INVALID" });
    }
    return observeCurrentV3RuntimeAfterGenesisV1(input);
}
//# sourceMappingURL=current-v3-runtime.js.map