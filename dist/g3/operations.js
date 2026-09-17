import { MAINNET_PROFILE } from "../mainnet/profile.js";
import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import { PublicKey, TransactionMessage, VersionedTransaction, AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { G3_INTEGRATION_LOCK, observeG3Candidate, observeG3Mainnet, buildG3CandidateInstruction, inspectG3CandidateInstructions } from "./runtime.js";
import { validateG3SignedMessage } from "./transaction.js";
import { g3BusinessInstructions, G3_ORDER_COMPUTE_UNITS } from "./browser.js";
const builders = {
    receipt_contribute: "buildContributeWriterInstruction",
    receipt_transfer: "buildTransferWriterContributionInstruction",
    receipt_split: "buildSplitWriterContributionInstruction",
    receipt_claim: "buildClaimWriterContributionInstruction",
    receipt_close: "buildCloseWriterContributionInstruction",
    receipt_expire: "buildExpireUnactivatedWriterV3Instruction",
    order: "buildDlmmOrderInstruction",
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
function commitment(plan) {
    return sha(JSON.stringify(["amoeba.g3.user-operation.v1", plan.schemaVersion, plan.operation,
        plan.owner, plan.profileSha256, plan.sourceCommit, plan.epoch, plan.observedSlot,
        plan.blockhash, plan.lastValidBlockHeight, plan.serializedTransactionBase64, plan.messageSha256,
        plan.lookupTable ? [plan.lookupTable.address, plan.lookupTable.dataBase64] : null]));
}
async function readLookup(connection, address, floor) {
    const read = await connection.getAccountInfoAndContext(address, { commitment: "finalized", minContextSlot: floor });
    if (read.context.slot < floor || !read.value || read.value.executable
        || !read.value.owner.equals(AddressLookupTableProgram.programId))
        throw new Error("G3 lookup table identity mismatch");
    const table = new AddressLookupTableAccount({ key: address, state: AddressLookupTableAccount.deserialize(read.value.data) });
    if (!table.isActive() || table.state.lastExtendedSlot >= read.context.slot)
        throw new Error("G3 lookup table is not active and mature");
    return { table, dataBase64: read.value.data.toString("base64"), slot: read.context.slot };
}
/** Typed canonical construction. The host must admit observed business state before calling. */
export async function prepareG3UserOperation(connection, owner, input, minimumContextSlot, lookupTableAddress, network = "local-test") {
    if (!Object.hasOwn(builders, input.operation))
        throw new Error("G3 operation is not supported");
    const context = await (network === "mainnet-beta" ? observeG3Mainnet : observeG3Candidate)(connection, minimumContextSlot);
    const business = buildG3CandidateInstruction({ context, builderName: builders[input.operation],
        builderInput: input.builderInput });
    if (business.length !== 1)
        throw new Error("G3 user action requires one canonical instruction");
    const instructions = input.operation === "order"
        ? [ComputeBudgetProgram.setComputeUnitLimit({ units: G3_ORDER_COMPUTE_UNITS }), ...business] : business;
    const signers = instructions.flatMap(ix => ix.keys.filter(meta => meta.isSigner));
    if (!signers.length || signers.some(meta => !meta.pubkey.equals(owner)))
        throw new Error("G3 operation owner mismatch");
    const lifetime = await connection.getLatestBlockhashAndContext({ commitment: "finalized", minContextSlot: context.observedSlot });
    if (lifetime.context.slot < context.observedSlot || !Number.isSafeInteger(lifetime.value.lastValidBlockHeight)
        || lifetime.value.lastValidBlockHeight < 0)
        throw new Error("G3 transaction lifetime is invalid");
    const lookup = lookupTableAddress ? await readLookup(connection, lookupTableAddress, lifetime.context.slot) : undefined;
    const message = new TransactionMessage({ payerKey: owner, recentBlockhash: lifetime.value.blockhash, instructions: [...instructions] });
    const transaction = new VersionedTransaction(lookup ? message.compileToV0Message([lookup.table]) : message.compileToLegacyMessage());
    const bytes = Buffer.from(transaction.serialize());
    if (bytes.length > 1232)
        throw new Error("G3 action exceeds packet size; an admitted lookup-table plan is required");
    const fields = {
        schemaVersion: 3, operation: input.operation, owner: owner.toBase58(),
        profileSha256: network === "mainnet-beta" ? MAINNET_PROFILE.profileSha256 : G3_INTEGRATION_LOCK.profile.profileSha256, sourceCommit: network === "mainnet-beta" ? MAINNET_PROFILE.publicSourceCommit : G3_INTEGRATION_LOCK.spread.sourceCommit,
        epoch: context.epoch, observedSlot: Math.max(context.observedSlot, lifetime.context.slot, lookup?.slot ?? 0), ...lifetime.value,
        serializedTransactionBase64: bytes.toString("base64"), messageSha256: sha(transaction.message.serialize()),
        ...(lookup ? { lookupTable: { address: lookup.table.key.toBase58(), dataBase64: lookup.dataBase64 } } : {}),
    };
    const digest = commitment(fields);
    return Object.freeze({ ...fields, operationId: digest, preparedPlanDigest: digest });
}
/** Revalidate an already admitted durable plan; a plan hash is not business admission. */
export async function revalidateG3UserOperation(connection, plan, signedTransactionBase64) {
    const mainnet = plan.profileSha256 === MAINNET_PROFILE.profileSha256;
    if (plan.schemaVersion !== 3 || !Object.hasOwn(builders, plan.operation)
        || plan.profileSha256 !== (mainnet ? MAINNET_PROFILE.profileSha256 : G3_INTEGRATION_LOCK.profile.profileSha256)
        || plan.sourceCommit !== (mainnet ? MAINNET_PROFILE.publicSourceCommit : G3_INTEGRATION_LOCK.spread.sourceCommit)
        || !Number.isSafeInteger(plan.observedSlot) || plan.observedSlot < 0
        || commitment(plan) !== plan.preparedPlanDigest || plan.operationId !== plan.preparedPlanDigest)
        throw new Error("G3 plan identity mismatch");
    const facts = await validateG3SignedMessage(plan, signedTransactionBase64);
    const prepared = VersionedTransaction.deserialize(Buffer.from(plan.serializedTransactionBase64, "base64"));
    if (sha(prepared.message.serialize()) !== plan.messageSha256
        || !Number.isSafeInteger(plan.lastValidBlockHeight) || plan.lastValidBlockHeight < 0)
        throw new Error("G3 prepared message commitment mismatch");
    const context = await (mainnet ? observeG3Mainnet : observeG3Candidate)(connection, plan.observedSlot);
    if (context.epoch !== plan.epoch)
        throw new Error("G3 gate epoch changed; prepare a new operation");
    const lookup = plan.lookupTable ? await readLookup(connection, new PublicKey(plan.lookupTable.address), context.observedSlot) : undefined;
    if (lookup && lookup.dataBase64 !== plan.lookupTable.dataBase64)
        throw new Error("G3 lookup table changed; prepare again");
    const decoded = TransactionMessage.decompile(prepared.message, { addressLookupTableAccounts: lookup ? [lookup.table] : [] });
    const views = inspectG3CandidateInstructions(context, g3BusinessInstructions(plan.operation, decoded.instructions));
    const expected = { receipt_contribute: "contribute", receipt_transfer: "transfer", receipt_split: "split",
        receipt_claim: "claim", receipt_close: "close", receipt_expire: "expire-never-active" };
    if (views.length !== 1 || (plan.operation === "order" ? views[0].family !== "public-order"
        : views[0].family !== "writer-receipt" || views[0].action !== expected[plan.operation]))
        throw new Error("G3 operation selector mismatch");
    const valid = await connection.isBlockhashValid(plan.blockhash, { commitment: "finalized", minContextSlot: context.observedSlot });
    const height = await connection.getBlockHeight({ commitment: "finalized", minContextSlot: context.observedSlot });
    if (valid.context.slot < context.observedSlot || !valid.value || height > plan.lastValidBlockHeight)
        throw new Error("G3 transaction lifetime expired");
    return Object.freeze({ ...facts, validated: true, finalizedObservationSlot: context.observedSlot });
}
//# sourceMappingURL=operations.js.map