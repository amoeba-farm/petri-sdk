import { Buffer } from "buffer";
import { PublicKey, VersionedTransaction, TransactionMessage, ComputeBudgetProgram, AddressLookupTableAccount, AddressLookupTableProgram, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { observeAmoebaGovernanceGateV1, bindAmoebaGovernanceGateContextV1, BPF_LOADER_UPGRADEABLE_PROGRAM_ID } from "@amoeba/spread-release-tools/governance-gate";
import * as receipts from "@amoeba/spread-release-tools/writer-participation";
import { buildDlmmOrderInstruction } from "@amoeba/spread-release-tools/dlmm-orders";
import { MAINNET_PROFILE as p } from "../mainnet/profile.js";
import { resolveG3UserIntent } from "./resolver.js";
import { inspectG3Instruction, G3_ORDER_COMPUTE_UNITS } from "./browser.js";
import { validateG3SignedMessage } from "./transaction.js";
import type { G3OperationPlan, G3UserOperation } from "./operations.js";

export interface MainnetG3ExpectedIntent { readonly owner: string; readonly operation: G3UserOperation; readonly request: unknown }
const hash = async (bytes: Uint8Array | string) => Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(typeof bytes === "string" ? Buffer.from(bytes) : bytes))).toString("hex");
const builders = { receipt_contribute: receipts.buildContributeWriterInstruction, receipt_transfer: receipts.buildTransferWriterContributionInstruction,
  receipt_split: receipts.buildSplitWriterContributionInstruction, receipt_claim: receipts.buildClaimWriterContributionInstruction,
  receipt_close: receipts.buildCloseWriterContributionInstruction, receipt_expire: receipts.buildExpireUnactivatedWriterV3Instruction, order: buildDlmmOrderInstruction };

/** Reconstruct from the original UI intent and fresh chain bytes, never backend metas. Does not sign. */
export async function materializeMainnetG3Plan(input: { connection: Connection; plan: G3OperationPlan; expected: MainnetG3ExpectedIntent }) {
  const plan = structuredClone(input.plan), expected = structuredClone(input.expected), connection = input.connection;
  if (connection.rpcEndpoint !== "https://api.amoeba.farm/rpc") throw new Error("MAINNET_BROWSER_GATEWAY_REQUIRED");
  if (!Object.hasOwn(builders, expected.operation) || plan.schemaVersion !== 3 || plan.owner !== expected.owner || plan.operation !== expected.operation
    || plan.profileSha256 !== p.profileSha256 || plan.sourceCommit !== p.publicSourceCommit
    || !Number.isSafeInteger(plan.observedSlot) || plan.observedSlot < p.minimumContextSlot
    || (plan.lookupTable && (typeof plan.lookupTable.dataBase64 !== "string" || plan.lookupTable.dataBase64.length > 12000))
    || !Number.isSafeInteger(plan.lastValidBlockHeight) || plan.lastValidBlockHeight < 0) throw new Error("MAINNET_G3_PLAN_IDENTITY_INVALID");
  const digest = await hash(JSON.stringify(["amoeba.g3.user-operation.v1", plan.schemaVersion, plan.operation, plan.owner,
    plan.profileSha256, plan.sourceCommit, plan.epoch, plan.observedSlot, plan.blockhash, plan.lastValidBlockHeight,
    plan.serializedTransactionBase64, plan.messageSha256, plan.lookupTable ? [plan.lookupTable.address, plan.lookupTable.dataBase64] : null]));
  if (digest !== plan.operationId || digest !== plan.preparedPlanDigest) throw new Error("MAINNET_G3_PLAN_DIGEST_INVALID");
  if (typeof plan.serializedTransactionBase64 !== "string" || plan.serializedTransactionBase64.length > 1644) throw new Error("MAINNET_G3_PACKET_INVALID");
  const bytes = Buffer.from(plan.serializedTransactionBase64, "base64");
  if (bytes.length > 1232 || bytes.toString("base64") !== plan.serializedTransactionBase64) throw new Error("MAINNET_G3_PACKET_INVALID");
  const supplied = VersionedTransaction.deserialize(bytes);
  if (supplied.signatures.some(sig => sig.some(b => b !== 0)) || supplied.message.header.numRequiredSignatures !== 1
    || supplied.message.staticAccountKeys[0]?.toBase58() !== expected.owner) throw new Error("MAINNET_G3_SIGNER_INVALID");
  const context = await observeAmoebaGovernanceGateV1({connection,controllerAbi:3,cluster:{clusterDomain:p.network,genesisHash:p.genesisHash},
    controllerProgram:new PublicKey(p.controllerProgramId),targetProgram:new PublicKey(p.programId),minimumContextSlot:plan.observedSlot});
  if (context.epoch.toString() !== plan.epoch || context.gate.toBase58() !== p.gate) throw new Error("MAINNET_G3_GATE_CHANGED");
  const accounts = await connection.getMultipleAccountsInfoAndContext([context.targetProgram, context.targetProgramdata],{commitment:"finalized",minContextSlot:context.finalizedObservationSlot});
  const [program,data] = accounts.value;
  if (!Number.isSafeInteger(accounts.context.slot) || accounts.context.slot < context.finalizedObservationSlot || !program || !data || !program.executable || data.executable
    || !program.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || !data.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)
    || program.data.length !== 36 || program.data.readUInt32LE(0) !== 2 || !program.data.subarray(4).equals(context.targetProgramdata.toBuffer())
    || data.data.length !== p.programDataAccountBytes || await hash(data.data) !== p.programDataAccountSha256) throw new Error("MAINNET_G3_EXECUTABLE_MISMATCH");
  const resolved = await resolveG3UserIntent(connection, expected.owner, expected.operation, expected.request, accounts.context.slot, "mainnet-beta");
  const builder = builders[expected.operation] as (value: never) => TransactionInstruction;
  const instruction = builder({ ...resolved.input.builderInput, programId: bindAmoebaGovernanceGateContextV1(context) } as never);
  inspectG3Instruction(instruction, context);
  const instructions = expected.operation === "order" ? [ComputeBudgetProgram.setComputeUnitLimit({units:G3_ORDER_COMPUTE_UNITS}),instruction] : [instruction];
  if (instructions.flatMap(ix => ix.keys.filter(k=>k.isSigner)).some(k=>k.pubkey.toBase58()!==expected.owner)) throw new Error("MAINNET_G3_SIGNER_INVALID");
  let table: AddressLookupTableAccount | undefined;
  if (plan.lookupTable) {
    const address = new PublicKey(plan.lookupTable.address);
    const read = await connection.getAccountInfoAndContext(address,{commitment:"finalized",minContextSlot:resolved.observedSlot});
    if (read.context.slot < resolved.observedSlot || !read.value || read.value.executable || !read.value.owner.equals(AddressLookupTableProgram.programId)
      || read.value.data.toString("base64") !== plan.lookupTable.dataBase64) throw new Error("MAINNET_G3_LOOKUP_CHANGED");
    table = new AddressLookupTableAccount({key:address,state:AddressLookupTableAccount.deserialize(read.value.data)});
    if (!table.isActive() || table.state.lastExtendedSlot >= read.context.slot) throw new Error("MAINNET_G3_LOOKUP_INVALID");
  }
  const message = new TransactionMessage({payerKey:new PublicKey(expected.owner),recentBlockhash:plan.blockhash,instructions});
  const transaction = new VersionedTransaction(table ? message.compileToV0Message([table]) : message.compileToLegacyMessage());
  const messageBytes = transaction.message.serialize();
  if (!Buffer.from(messageBytes).equals(Buffer.from(supplied.message.serialize())) || await hash(messageBytes) !== plan.messageSha256) throw new Error("MAINNET_G3_INTENT_MISMATCH");
  const valid = await connection.isBlockhashValid(plan.blockhash,{commitment:"finalized",minContextSlot:resolved.observedSlot});
  if (!valid.value || valid.context.slot < resolved.observedSlot || await connection.getBlockHeight({commitment:"finalized",minContextSlot:resolved.observedSlot}) > plan.lastValidBlockHeight) throw new Error("MAINNET_G3_LIFETIME_EXPIRED");
  return Object.freeze({transaction,messageBytes,owner:expected.owner,operation:expected.operation,operationId:plan.operationId,
    preparedPlanDigest:plan.preparedPlanDigest,messageSha256:plan.messageSha256,
    validateSignedTransaction: (signedBase64:string) => validateG3SignedMessage(plan,signedBase64)});
}
