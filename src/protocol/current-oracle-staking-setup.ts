/** Browser-safe exact activation prerequisite, derived independently of backend plans. */
import { Buffer } from "buffer";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export function currentOracleActivationSetup(programId: PublicKey, owner: PublicKey): readonly TransactionInstruction[] {
  const token = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const associated = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const mint = PublicKey.findProgramAddressSync([Buffer.from("ameba-spread-v2"), Buffer.from("oracle_samba_mint")], programId)[0];
  const ata = PublicKey.findProgramAddressSync([owner.toBuffer(), token.toBuffer(), mint.toBuffer()], associated)[0];
  return Object.freeze([
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    new TransactionInstruction({ programId: associated, data: Buffer.from([1]), keys: [
      { pubkey: owner, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: token, isSigner: false, isWritable: false },
    ] }),
  ]);
}
export function currentOracleActivationSetupManifests(programId: PublicKey, owner: PublicKey) {
  return currentOracleActivationSetup(programId, owner).map((instruction, index) => Object.freeze({
    programId: instruction.programId.toBase58(), dataBase64: Buffer.from(instruction.data).toString("base64"),
    accounts: instruction.keys.map(meta => ({ pubkey: meta.pubkey.toBase58(), isSigner: meta.isSigner, isWritable: meta.isWritable })),
    decodedParams: { instructionName: index === 0 ? "SetComputeUnitLimit" : "CreateAssociatedTokenAccountIdempotent", tag: index === 0 ? 2 : 1 },
  }));
}
