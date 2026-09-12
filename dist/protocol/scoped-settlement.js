/** Source-owned decoding of wallet/position settlement capabilities. No signing or policy decisions. */
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { decodeWriterSleeve, decodeWriterSeriesBook } from "@amoeba/spread-release-tools/writer-sleeve-accounts";
import { WRITER_ACCOUNT_SIZES } from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import { deriveCollectiveSettlementDelegatePda, derivePositionSettlementAuthorityPda } from "./writer-sleeve.js";
import { LIGHT_TOKEN_PROGRAM_ID } from "@amoeba/spread-release-tools/oracle-dlmm";
import { deriveLightAssociatedTokenAddress } from "@amoeba/spread-release-tools/token-primitives";
import { semanticCurrentSpreadInstructionV1 } from "./current-governed-write-internal.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
function invalid() { throw Object.assign(new Error("Scoped settlement account identity is invalid"), { code: "SCOPED_SETTLEMENT_INVALID" }); }
function programAccount(info, program) {
    if (!info || info.executable || !info.owner.equals(program))
        invalid();
    return info;
}
export function decodeCurrentScopedLongAuthorization(input) {
    const { address, account, programId } = input;
    const data = account.data;
    if (!programId.equals(new PublicKey(AMOEBA_SPREAD_PROGRAM_ID)) || account.executable || !account.owner.equals(LIGHT_TOKEN_PROGRAM_ID)
        || data.length !== 272 || data[108] !== 1 || data.readUInt32LE(72) !== 1 || data.readUInt32LE(109) !== 0
        || data.readUInt32LE(129) !== 0 || data[165] !== 2 || data[166] !== 1 || data.readUInt32LE(167) !== 1 || data[171] !== 32)
        invalid();
    const mint = new PublicKey(data.subarray(0, 32)), owner = new PublicKey(data.subarray(32, 64));
    const delegate = deriveCollectiveSettlementDelegatePda(owner, mint, programId)[0];
    const amount = data.readBigUInt64LE(64), allowance = data.readBigUInt64LE(121);
    if (!address.equals(deriveLightAssociatedTokenAddress(mint, owner)) || !delegate.equals(new PublicKey(data.subarray(76, 108))) || allowance < amount)
        invalid();
    return { owner: owner.toBase58(), mint: mint.toBase58(), amountAtoms: amount.toString(), authority: delegate.toBase58() };
}
export function decodeCurrentScopedPositionAuthorization(input) {
    const { address, programId } = input;
    const data = programAccount(input.account, programId).data;
    if (data.length !== 105 || data.subarray(0, 8).toString() !== "APSAUTH1")
        invalid();
    const owner = new PublicKey(data.subarray(9, 41)), pool = new PublicKey(data.subarray(41, 73)), position = new PublicKey(data.subarray(73, 105));
    const [expected, bump] = derivePositionSettlementAuthorityPda(owner, position, programId);
    if (!expected.equals(address) || data[8] !== bump)
        invalid();
    return { owner: owner.toBase58(), pool: pool.toBase58(), position: position.toBase58(), authority: address.toBase58() };
}
/** Finalized, bounded inventory. Capability presence is reread again before keeper signing. */
export async function discoverCurrentScopedSettlements(input) {
    const { connection, programId } = input;
    if (!programId.equals(new PublicKey(AMOEBA_SPREAD_PROGRAM_ID)))
        invalid();
    const [sleeves, markers] = await Promise.all([
        connection.getProgramAccounts(programId, { commitment: "finalized", filters: [{ dataSize: WRITER_ACCOUNT_SIZES.sleeve }] }),
        connection.getProgramAccounts(programId, { commitment: "finalized", filters: [{ dataSize: 105 }] }),
    ]);
    if (sleeves.length > 256 || markers.length > 4096)
        invalid();
    const positions = markers.map(({ pubkey, account }) => decodeCurrentScopedPositionAuthorization({ address: pubkey, account, programId }));
    const longs = [];
    for (const entry of sleeves) {
        const sleeve = decodeWriterSleeve(entry.pubkey, programAccount(entry.account, programId).data, programId);
        const book = decodeWriterSeriesBook(sleeve.seriesBook, programAccount(await connection.getAccountInfo(sleeve.seriesBook, "finalized"), programId).data, programId);
        if (!book.sleeve.equals(entry.pubkey))
            invalid();
        for (let seriesIndex = 0; seriesIndex < book.seriesCount; seriesIndex++) {
            const record = book.records[seriesIndex];
            if (!record.active)
                continue;
            const holders = await connection.getProgramAccounts(LIGHT_TOKEN_PROGRAM_ID, { commitment: "finalized", filters: [{ dataSize: 272 }, { memcmp: { offset: 0, bytes: record.contractMint.toBase58() } }] });
            if (holders.length > 4096)
                invalid();
            for (const holder of holders) {
                let authorization;
                try {
                    authorization = decodeCurrentScopedLongAuthorization({ address: holder.pubkey, account: holder.account, programId });
                }
                catch {
                    continue;
                }
                if (authorization.amountAtoms === "0")
                    continue;
                longs.push({ kind: "long_claim", owner: authorization.owner, target: authorization.mint, expiryUnixSeconds: sleeve.expiryTs.toString(),
                    request: { owner: authorization.owner, sleeve: entry.pubkey.toBase58(), claimVariant: "collective_long", seriesIndex, amountAtoms: authorization.amountAtoms } });
                if (longs.length > 4096)
                    invalid();
            }
        }
    }
    return { longs, positions };
}
/** Converts an already-admitted canonical manual claim into native scoped-builder arguments. */
export function currentScopedCollectiveBuilderInput(instruction, keeper) {
    const semantic = semanticCurrentSpreadInstructionV1(instruction);
    const keys = semantic.keys;
    if (semantic.data[0] !== 246 || keys.length !== 20)
        invalid();
    const names = ["holder", "vaultConfig", "sleeve", "settlementGroup", "seriesBook", "market", "contractMint", "holderClaimSource", "retirementCustody", "contractSplInterface", "sleeveUsdcVault", "holderUsdcDestination", "settlementMint", "usdcSplInterface", "lightTokenProgram", "compressedTokenAuthority", "splTokenProgram", "systemProgram", "compressibleConfig", "rentSponsor"];
    return { ...Object.fromEntries(names.map((name, i) => [name, keys[i].pubkey])), keeper };
}
//# sourceMappingURL=scoped-settlement.js.map