import { Buffer } from "buffer";
import {} from "@solana/web3.js";
import { buildOracleEvidenceUpload, decodeOracleEvidenceObject, deriveOracleEvidenceObject, oracleEvidenceCommitment } from "@amoeba/spread-release-tools/oracle-evidence";
/** Re-read the actual draft before selecting one upload. This never signs future chunks. */
export async function prepareNextG3EvidenceUpload(input) {
    const bytes = Buffer.from(input.bytes);
    const commitment = oracleEvidenceCommitment(input.kind, bytes);
    const address = deriveOracleEvidenceObject(input.programId, input.payer, input.kind, commitment);
    const info = await input.connection.getAccountInfo(address, "finalized");
    const existing = info === null ? null : decodeOracleEvidenceObject(input.programId, address, info);
    if (existing && (!existing.payer.equals(input.payer) || existing.kind !== input.kind
        || !existing.commitment.equals(commitment) || existing.totalBytes !== bytes.length
        || !bytes.subarray(0, existing.writtenBytes).equals(existing.bytes.subarray(0, existing.writtenBytes))))
        throw new Error("Evidence draft differs from original exact bytes");
    const writtenBytes = existing?.writtenBytes ?? 0;
    const instruction = existing?.sealed ? null : buildOracleEvidenceUpload({ ...input, bytes, expectedCommitment: commitment, writtenBytes })[0] ?? null;
    return Object.freeze({ address, commitment, writtenBytes, totalBytes: bytes.length,
        complete: existing?.sealed === true, instruction });
}
//# sourceMappingURL=evidence.js.map