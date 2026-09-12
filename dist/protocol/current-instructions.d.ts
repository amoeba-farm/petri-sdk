import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { CURRENT_VAULT_INSTRUCTION_TAG, type VaultInstructionTag } from "./current.js";
export interface InitUserCollateralAccounts {
    readonly user: PublicKey;
    readonly userCollateral: PublicKey;
}
/** Build current VaultInstruction::InitUserCollateral (tag 9). */
export declare function buildInitUserCollateralInstruction(input: {
    readonly accounts: InitUserCollateralAccounts;
    readonly programId?: PublicKey;
}): TransactionInstruction;
export interface ProposeEmergencySettlementSignerRecoveryParams {
    readonly targetVersion: bigint;
    readonly threshold: number;
    readonly signers: readonly PublicKey[];
    readonly rotationDelaySlots: bigint;
    readonly activateAfterSlot: bigint;
}
export interface ProposeEmergencySettlementSignerRecoveryAccounts {
    readonly admin: PublicKey;
    readonly oracleAuthority: PublicKey;
    readonly recoveryAuthority: PublicKey;
    readonly vaultConfig: PublicKey;
    readonly signerRegistry: PublicKey;
    readonly currentSignerSet: PublicKey;
    readonly pendingSignerSet: PublicKey;
}
/** Build the canonical governed emergency signer recovery instruction (tag 94). */
export declare function buildProposeEmergencySettlementSignerRecoveryInstruction(input: {
    readonly accounts: ProposeEmergencySettlementSignerRecoveryAccounts;
    readonly params: ProposeEmergencySettlementSignerRecoveryParams;
    readonly programId?: PublicKey;
}): TransactionInstruction;
export interface WithdrawCollateralAccounts {
    readonly owner: PublicKey;
    readonly vaultTokenAccount: PublicKey;
    readonly destinationTokenAccount: PublicKey;
    readonly vaultConfig: PublicKey;
    readonly userCollateral: PublicKey;
    readonly collateralMint: PublicKey;
}
/** Build current VaultInstruction::WithdrawCollateral (tag 11). */
export declare function buildWithdrawCollateralInstruction(input: {
    readonly accounts: WithdrawCollateralAccounts;
    readonly amount: bigint;
    readonly programId?: PublicKey;
}): TransactionInstruction;
export interface CurrentDecodedInstruction {
    readonly tag: VaultInstructionTag;
    readonly payload: Buffer;
}
export interface CurrentPackedStateTreeInfo {
    readonly rootIndex: number;
    readonly proveByIndex: boolean;
    readonly treeAccountIndex: number;
    readonly queueAccountIndex: number;
    readonly leafIndex: number;
}
export interface CurrentCompressedValidityProof {
    readonly aBase64: string;
    readonly bBase64: string;
    readonly cBase64: string;
}
export type CurrentExecuteCompressedStateAccess = {
    readonly kind: "readOnly";
    readonly accountIndex: number;
    readonly treeInfo: CurrentPackedStateTreeInfo;
    readonly domain: number;
    readonly revision: bigint;
    readonly compactDataBase64: string;
} | {
    readonly kind: "mutable";
    readonly accountIndex: number;
    readonly treeInfo: CurrentPackedStateTreeInfo;
    readonly outputStateTreeIndex: number;
    readonly domain: number;
    readonly revision: bigint;
    readonly compactDataBase64: string;
} | {
    readonly kind: "initialize";
    readonly accountIndex: number;
    readonly domain: number;
    readonly addressTreeAccountIndex: number;
    readonly addressQueueAccountIndex: number;
    readonly addressRootIndex: number;
    readonly outputStateTreeIndex: number;
};
/** Exact decoded rc.44 `ExecuteCompressedStateV1` (outer tag 205) payload. */
export interface CurrentExecuteCompressedStateV1Payload {
    readonly tag: typeof CURRENT_VAULT_INSTRUCTION_TAG.ExecuteCompressedStateV1;
    readonly coreAccountCount: number;
    readonly rentPayerIndex: number;
    readonly proof: CurrentCompressedValidityProof | null;
    readonly accesses: readonly CurrentExecuteCompressedStateAccess[];
    readonly innerInstructionDataBase64: string;
    readonly logicalTag: VaultInstructionTag;
}
/**
 * Decode and bound the actual outer tag-205 bytes. This never trusts projected metadata: it
 * validates the complete Borsh grammar, validates the nested current instruction, preserves the
 * encoded access order (including duplicate account indexes across distinct domains), and rejects
 * nested tag 205 or trailing bytes.
 */
export declare function decodeCurrentExecuteCompressedStateV1(data: Uint8Array): CurrentExecuteCompressedStateV1Payload;
/**
 * Fail-closed decoder for the exact current rc.44 VaultInstruction ABI.
 *
 * This validates the complete payload grammar (including canonical Borsh option/bool/enum bytes,
 * bounded vectors/strings, compression envelopes, exact fixed lengths, and no trailing bytes).
 */
export declare function decodeCurrentVaultInstruction(data: Uint8Array): CurrentDecodedInstruction;
//# sourceMappingURL=current-instructions.d.ts.map