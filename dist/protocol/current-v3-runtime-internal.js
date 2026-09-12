import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { CURRENT_LIVE_DEPLOYMENT as live, CURRENT_GOVERNANCE_GENERATION_3 as identity } from "./release-train.js";
import { assertExactDeploymentPayloadV1 } from "./deployment-payload-internal.js";
import { BPF_UPGRADEABLE_LOADER_PROGRAM_ID, validateProtocolGovernanceGateAccountV1 } from "./governance.js";
/** Package-private observation after the caller has verified the exact Devnet genesis. */
export async function observeCurrentV3RuntimeAfterGenesisV1(input) {
    const fail = (code, message) => { throw new AmebaProtocolError(message, { code }); };
    if (!Number.isSafeInteger(input.minimumContextSlot) || input.minimumContextSlot < live.minimumContextSlot)
        fail("CURRENT_V3_CONTEXT_INVALID", "finalized slot floor precedes the V3 release evidence");
    if (typeof input.rpc.getMultipleAccountsInfoAndContext !== "function")
        fail("CURRENT_V3_RPC_INVALID", "V3 runtime requires one finalized Program, ProgramData, gate and vault observation");
    const programId = new PublicKey(live.programId);
    const [vaultAddress, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from(live.stateNamespace), Buffer.from("vault_config")], programId);
    const addresses = [programId, new PublicKey(live.programDataAddress), new PublicKey(identity.protocolGatePda), vaultAddress];
    const response = await input.rpc.getMultipleAccountsInfoAndContext(addresses, { commitment: "finalized", minContextSlot: input.minimumContextSlot });
    if (!Number.isSafeInteger(response?.context?.slot) || response.context.slot < input.minimumContextSlot || response.value?.length !== 4)
        fail("CURRENT_V3_CONTEXT_INVALID", "finalized V3 observation is incomplete or regressed");
    const [program, data, gateAccount, vault] = response.value;
    const hash = async (bytes) => Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))).toString("hex");
    const loader = new PublicKey(BPF_UPGRADEABLE_LOADER_PROGRAM_ID);
    if (!program || !data || !gateAccount)
        fail("CURRENT_V3_DEPLOYMENT_ABSENT", "V3 Program, ProgramData or gate is absent");
    if (!program.owner.equals(loader) || program.executable !== true || program.data.length !== live.programAccountBytes
        || await hash(program.data) !== live.programAccountSha256 || !data.owner.equals(loader) || data.executable !== false
        || data.data.length !== live.programDataAccountBytes || await hash(data.data) !== live.programDataAccountSha256)
        fail("CURRENT_V3_DEPLOYMENT_INVALID", "V3 Program or ProgramData differs from exact finalized release bytes");
    await assertExactDeploymentPayloadV1(data.data.subarray(45), live);
    const gate = validateProtocolGovernanceGateAccountV1({ address: addresses[2], owner: gateAccount.owner, executable: gateAccount.executable, data: gateAccount.data, identity });
    let businessState = "uninitialized";
    if (vault) {
        const b = vault.data;
        if (!vault.owner.equals(programId) || vault.executable !== false || b.length !== 135 || b[0] !== 1 || b[1] !== vaultBump
            || Buffer.from(b.subarray(131, 134)).toString("ascii") !== "VCF" || b[134] !== 1 || (b[130] !== 0 && b[130] !== 1))
            fail("CURRENT_V3_VAULT_INVALID", "V3 vault is not the exact initialized canonical business account");
        businessState = b[130] === 1 ? "paused" : "ready";
    }
    // Runtime identity is shared by every operation. Operation-specific admission
    // enforces its custody/lifecycle predicates; a global pause bit cannot prohibit
    // contract-supported principal exits, claims, LP access or staking transitions.
    const writeReady = gate.statusName === "Active" && gate.epoch > 0n && businessState !== "uninitialized";
    if (input.requireWriteReady && !writeReady)
        fail(gate.statusName !== "Active" ? "GOVERNANCE_GATE_FROZEN" : "CURRENT_V3_BUSINESS_UNAVAILABLE", "V3 requires an Active gate and initialized canonical business state");
    return Object.freeze({ observedSlot: response.context.slot, gate, gateAccountSha256: await hash(gateAccount.data), businessState, writeReady, vaultAddress });
}
//# sourceMappingURL=current-v3-runtime-internal.js.map