import { PublicKey, TransactionInstruction } from "@solana/web3.js";
const LIGHT_TRANSFER2_DISCRIMINATOR = 101;
const LIGHT_TRANSFER2_MAX_INPUTS = 8;
const LIGHT_TRANSFER2_MAX_ACCOUNTS = 26;
const LIGHT_TRANSFER2_SHA_FLAT_VERSION = 3;
const CURRENT_TOKEN_DECIMALS = 6;
const U64_MAX = 0xffffffffffffffffn;
const LIGHT_SYSTEM_PROGRAM = new PublicKey("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7");
const LIGHT_TOKEN_PROGRAM = new PublicKey("cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m");
const LIGHT_TOKEN_CPI_AUTHORITY = new PublicKey("GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy");
const LIGHT_REGISTERED_PROGRAM = new PublicKey("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh");
const LIGHT_COMPRESSION_AUTHORITY = new PublicKey("HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA");
const LIGHT_COMPRESSION_PROGRAM = new PublicKey("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq");
const CURRENT_STATE_TREE_QUEUE = new Map([
    ["bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU", "oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto"],
    ["bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi", "oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg"],
    ["bmt3ccLd4bqSVZVeCJnH1F6C8jNygAhaDfxDwePyyGb", "oq3AxjekBWgo64gpauB6QtuZNesuv19xrhaC1ZM1THQ"],
    ["bmt4d3p1a4YQgk9PeZv5s4DBUmbF5NxqYpk9HGjQsd8", "oq4ypwvVGzCUMoiKKHWh4S1SgZJ9vCvKpcz6RT6A8dq"],
    ["bmt5yU97jC88YXTuSukYHa8Z5Bi2ZDUtmzfkDTA2mG2", "oq5oh5ZR3yGomuQgFduNDzjtGvVWfDRGLuDVjv9a96P"],
]);
/**
 * Validate the exact payer-bound Light v0.23.3 cold-load subset used by RC44.
 * Every batch must consume distinct authenticated token inputs and decompress
 * only into the one expected Light ATA. No token outputs, lamport movement,
 * CPI context, transaction hash, delegate, TLV, or SPL-pool path is admitted.
 */
export function validateCurrentLightTransfer2LoadSequence(transfers, expected) {
    if (transfers.length < 1 || transfers.length > 8
        || expected.amountAtoms < 1n || expected.amountAtoms > U64_MAX) {
        fail("cold load must contain 1..8 Transfer2 batches for one positive u64 balance");
    }
    let totalAmount = 0n;
    const inputIdentities = new Set();
    for (const transfer of transfers) {
        const decoded = decodeTransfer2Load(transfer, expected);
        totalAmount += decoded.amountAtoms;
        if (totalAmount > U64_MAX)
            fail("cold load amount exceeds the current u64 token domain");
        for (const input of decoded.inputs) {
            const identity = `${input.tree}:${input.queue}:${input.leafIndex}`;
            if (inputIdentities.has(identity)) {
                fail("cold load reuses one compressed input across sequential batches");
            }
            inputIdentities.add(identity);
        }
    }
    if (totalAmount !== expected.amountAtoms) {
        fail("cold load amount does not equal the authenticated cold balance");
    }
}
function decodeTransfer2Load(instruction, expected) {
    if (!instruction.programId.equals(LIGHT_TOKEN_PROGRAM)
        || instruction.keys.length < 12
        || instruction.keys.length > LIGHT_TRANSFER2_MAX_ACCOUNTS) {
        fail("instruction is not the bounded current Light Transfer2 account grammar");
    }
    const fixed = [
        [LIGHT_SYSTEM_PROGRAM, false, false],
        [expected.payer, true, true],
        [LIGHT_TOKEN_CPI_AUTHORITY, false, false],
        [LIGHT_REGISTERED_PROGRAM, false, false],
        [LIGHT_COMPRESSION_AUTHORITY, false, false],
        [LIGHT_COMPRESSION_PROGRAM, false, false],
        [PublicKey.default, false, false],
    ];
    for (const [index, [pubkey, isSigner, isWritable]] of fixed.entries()) {
        const meta = instruction.keys[index];
        if (meta === undefined || !meta.pubkey.equals(pubkey)
            || meta.isSigner !== isSigner || meta.isWritable !== isWritable) {
            fail("Transfer2 fixed accounts or payer flags are not exact");
        }
    }
    const packed = instruction.keys.slice(7);
    const mintIndex = packed.length - 3;
    const ownerIndex = packed.length - 2;
    const destinationIndex = packed.length - 1;
    if (mintIndex < 2
        || new Set(packed.slice(0, mintIndex).map((meta) => meta.pubkey.toBase58())).size !== mintIndex
        || packed.slice(0, mintIndex).some((meta) => meta.isSigner || !meta.isWritable)
        || !sameMeta(packed[mintIndex], expected.mint, false, false)
        || !sameMeta(packed[ownerIndex], expected.owner, true, false)
        || !sameMeta(packed[destinationIndex], expected.destination, false, true)) {
        fail("Transfer2 proof accounts or mint-owner-destination suffix are not exact");
    }
    const cursor = new Transfer2Cursor(Buffer.from(instruction.data));
    if (cursor.u8("discriminator") !== LIGHT_TRANSFER2_DISCRIMINATOR) {
        fail("instruction discriminator is not Transfer2");
    }
    if (cursor.bool("withTransactionHash")
        || cursor.bool("withLamportsChangeAccountMerkleTreeIndex")
        || cursor.u8("lamportsChangeAccountMerkleTreeIndex") !== 0
        || cursor.u8("lamportsChangeAccountOwnerIndex") !== 0) {
        fail("Transfer2 transaction-hash or lamport-change mode is not allowed");
    }
    const outputQueue = cursor.u8("outputQueue");
    if (cursor.u16("maxTopUp") !== 0xffff || cursor.option("cpiContext")) {
        fail("Transfer2 top-up or CPI context is not the pinned load mode");
    }
    if (!cursor.option("compressions") || cursor.vecLength("compressions", 1) !== 1) {
        fail("Transfer2 must contain one decompression");
    }
    const compressionMode = cursor.u8("compression.mode");
    const compressionAmount = cursor.u64("compression.amount");
    const compressionMint = cursor.u8("compression.mint");
    const compressionDestination = cursor.u8("compression.sourceOrRecipient");
    const compressionAuthority = cursor.u8("compression.authority");
    const poolAccountIndex = cursor.u8("compression.poolAccountIndex");
    const poolIndex = cursor.u8("compression.poolIndex");
    const poolBump = cursor.u8("compression.bump");
    const decimals = cursor.u8("compression.decimals");
    if (compressionMode !== 1 || compressionAmount < 1n
        || compressionMint !== mintIndex || compressionDestination !== destinationIndex
        || compressionAuthority !== 0 || poolAccountIndex !== 0 || poolIndex !== 0
        || poolBump !== 0 || decimals !== CURRENT_TOKEN_DECIMALS) {
        fail("Transfer2 decompression does not bind the exact mint, destination, amount, or pool-free path");
    }
    const hasProof = cursor.option("proof");
    const proof = hasProof ? cursor.bytes(128, "proof") : null;
    if (proof !== null && proof.every((byte) => byte === 0)) {
        fail("Transfer2 full proof is all zero");
    }
    const inputCount = cursor.vecLength("inTokenData", LIGHT_TRANSFER2_MAX_INPUTS);
    if (inputCount < 1)
        fail("Transfer2 contains no compressed token input");
    const inputs = [];
    const referencedProofAccounts = new Set();
    let inputAmount = 0n;
    for (let index = 0; index < inputCount; index += 1) {
        const inputOwner = cursor.u8(`inTokenData[${index}].owner`);
        const amountAtoms = cursor.u64(`inTokenData[${index}].amount`);
        const hasDelegate = cursor.bool(`inTokenData[${index}].hasDelegate`);
        const delegate = cursor.u8(`inTokenData[${index}].delegate`);
        const inputMint = cursor.u8(`inTokenData[${index}].mint`);
        const version = cursor.u8(`inTokenData[${index}].version`);
        const treeIndex = cursor.u8(`inTokenData[${index}].tree`);
        const queueIndex = cursor.u8(`inTokenData[${index}].queue`);
        const leafIndex = cursor.u32(`inTokenData[${index}].leafIndex`);
        const proveByIndex = cursor.bool(`inTokenData[${index}].proveByIndex`);
        const rootIndex = cursor.u16(`inTokenData[${index}].rootIndex`);
        if (inputOwner !== ownerIndex || amountAtoms < 1n || hasDelegate || delegate !== 0
            || inputMint !== mintIndex || version !== LIGHT_TRANSFER2_SHA_FLAT_VERSION
            || treeIndex >= mintIndex || queueIndex >= mintIndex || treeIndex === queueIndex
            || (proveByIndex && rootIndex !== 0)) {
            fail("Transfer2 input token identity, amount, delegate, version, or proof context is not exact");
        }
        inputAmount += amountAtoms;
        if (inputAmount > U64_MAX)
            fail("Transfer2 input amount exceeds u64");
        const tree = packed[treeIndex].pubkey.toBase58();
        const queue = packed[queueIndex].pubkey.toBase58();
        if (CURRENT_STATE_TREE_QUEUE.get(tree) !== queue) {
            fail("Transfer2 input tree and queue are not one pinned current Light topology pair");
        }
        referencedProofAccounts.add(treeIndex);
        referencedProofAccounts.add(queueIndex);
        inputs.push(Object.freeze({
            tree,
            queue,
            leafIndex,
            treeIndex,
            queueIndex,
            amountAtoms,
            proveByIndex,
        }));
    }
    if (referencedProofAccounts.size !== mintIndex
        || [...Array(mintIndex).keys()].some((index) => !referencedProofAccounts.has(index))) {
        fail("Transfer2 proof-account prefix contains an unused or unreferenced account");
    }
    if (compressionAmount !== inputAmount || outputQueue !== inputs[0]?.queueIndex
        || (hasProof === inputs.every((input) => input.proveByIndex))) {
        fail("Transfer2 proof mode, output queue, or decompressed amount does not match its inputs");
    }
    if (cursor.vecLength("outTokenData", 0) !== 0
        || cursor.option("inLamports") || cursor.option("outLamports")
        || cursor.option("inTlv") || cursor.option("outTlv")) {
        fail("Transfer2 cold load may not create compressed outputs, move lamports, or carry TLV extensions");
    }
    cursor.finish();
    return Object.freeze({
        amountAtoms: inputAmount,
        inputs: Object.freeze(inputs.map(({ tree, queue, leafIndex }) => Object.freeze({ tree, queue, leafIndex }))),
    });
}
function sameMeta(meta, pubkey, isSigner, isWritable) {
    return meta !== undefined && meta.pubkey.equals(pubkey)
        && meta.isSigner === isSigner && meta.isWritable === isWritable;
}
class Transfer2Cursor {
    #bytes;
    #offset = 0;
    constructor(bytes) {
        if (bytes.length < 1 || bytes.length > 16_384)
            fail("Transfer2 data size is outside 1..16384 bytes");
        this.#bytes = bytes;
    }
    u8(field) {
        this.#require(1, field);
        return this.#bytes[this.#offset++];
    }
    bool(field) {
        const value = this.u8(field);
        if (value > 1)
            fail(`${field} is not a canonical Borsh bool`);
        return value === 1;
    }
    u16(field) {
        this.#require(2, field);
        const value = this.#bytes.readUInt16LE(this.#offset);
        this.#offset += 2;
        return value;
    }
    u32(field) {
        this.#require(4, field);
        const value = this.#bytes.readUInt32LE(this.#offset);
        this.#offset += 4;
        return value;
    }
    u64(field) {
        this.#require(8, field);
        const value = this.#bytes.readBigUInt64LE(this.#offset);
        this.#offset += 8;
        return value;
    }
    option(field) {
        const value = this.u8(`${field} option`);
        if (value > 1)
            fail(`${field} has a noncanonical Borsh option`);
        return value === 1;
    }
    vecLength(field, maximum) {
        const value = this.u32(`${field} length`);
        if (value > maximum)
            fail(`${field} exceeds its current bound`);
        return value;
    }
    bytes(length, field) {
        this.#require(length, field);
        const value = Object.freeze([...this.#bytes.subarray(this.#offset, this.#offset + length)]);
        this.#offset += length;
        return value;
    }
    finish() {
        if (this.#offset !== this.#bytes.length)
            fail("Transfer2 contains trailing bytes");
    }
    #require(length, field) {
        if (this.#offset + length > this.#bytes.length)
            fail(`Transfer2 ${field} is truncated`);
    }
}
function fail(message) {
    throw new Error(`current Light Transfer2 invalid: ${message}`);
}
//# sourceMappingURL=current-light-transfer2.js.map