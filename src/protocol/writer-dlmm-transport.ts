import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import preset from "./writer-dlmm-transport.v1.json" with { type: "json" };
import { sha256Canonical } from "../wallet/codec.js";

/** Candidate construction limits only. No measured compute or packet qualification is claimed. */
export const CURRENT_WRITER_DLMM_TRANSPORT_V1 = Object.freeze({ ...preset,
  setupInstructionNames: Object.freeze([...preset.setupInstructionNames]),
  setupInstructionDataBase64: Object.freeze([...preset.setupInstructionDataBase64]),
});
export const WRITER_DLMM_TRANSPORT_SHA256_V1 = sha256Canonical(CURRENT_WRITER_DLMM_TRANSPORT_V1);

/** Exact construction preset binding; the qualified field does not attest measured compute. */
export function isExactWriterDlmmTransportV1(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(CURRENT_WRITER_DLMM_TRANSPORT_V1);
  return Object.keys(record).length === entries.length && entries.every(([key, expected]) => {
    const actual = record[key];
    return Array.isArray(expected)
      ? Array.isArray(actual) && actual.length === expected.length
        && expected.every((item, index) => actual[index] === item)
      : actual === expected;
  });
}
export function currentWriterDlmmComputeInstructions(): readonly TransactionInstruction[] {
  return Object.freeze(CURRENT_WRITER_DLMM_TRANSPORT_V1.setupInstructionDataBase64.map(data => new TransactionInstruction({
    programId: new PublicKey(CURRENT_WRITER_DLMM_TRANSPORT_V1.setupProgramId), keys: [], data: Buffer.from(data, "base64"),
  })));
}
