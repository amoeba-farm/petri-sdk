/** Finalized, queue-aware compact evidence using the packaged native Light verifier. */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { accountCompressionProgram, createBN254, TreeType } from "@lightprotocol/stateless.js";
import { decodeCompressedAmebaStateLeaf, deriveCompressedStateAddressV1 } from "@amoeba/spread-release-tools/compressed-state";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import { CURRENT_PROTOCOL_DEVNET_GENESIS_HASH } from "./current.js";
import { CURRENT_COMPRESSED_EVIDENCE_SCHEMA, requireCurrentCompressedEvidenceVerifier, validateCurrentCompressedEvidenceRequest } from "./current-compressed-evidence-verifier.js";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const keyHex = (value) => value.toBuffer().toString("hex");
function invalid(message) { throw new Error(`CURRENT_PHOTON_VERIFIED_EVIDENCE_INVALID: ${message}`); }
function fieldHex(value) {
    if (value.isNeg() || value.byteLength() > 32)
        invalid("field value exceeds32bytes");
    return value.toArrayLike(Buffer, "be", 32).toString("hex");
}
function proofHex(value, length) {
    if (value.length !== length || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))
        invalid("proof limb has invalid bytes");
    return Buffer.from(value).toString("hex");
}
/** Internal to the attested Photon composition; caller supplies only its already bound transports/topology. */
export async function readCurrentVerifiedCompressedStateEvidence(input) {
    requireCurrentCompressedEvidenceVerifier(input.verifier);
    const start = await input.stateConnection.getSlot("finalized");
    const requestedFloor = input.minimumContextSlot ?? start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedFloor) || requestedFloor < 0 || start < requestedFloor
        || await input.stateConnection.getGenesisHash() !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH)
        invalid("finalized Devnet read floor unavailable");
    const program = new PublicKey(AMOEBA_SPREAD_PROGRAM_ID);
    const addressTree = new PublicKey(input.topology.addressTree);
    const addressQueue = new PublicKey(input.topology.addressQueue);
    const compressedAddress = deriveCompressedStateAddressV1(program, addressTree, input.domain, input.canonicalPda);
    const account = await input.getCompressedAccount(createBN254(compressedAddress.toBytes()));
    let raw = null;
    let leaf = null;
    let statement;
    let proofBytes = null;
    let proofStatementJson;
    let proofSlot = start;
    if (account !== null) {
        const topology = input.topology.stateTrees.find(tree => tree.stateTree === account.treeInfo.tree.toBase58());
        if (!topology || topology.queue !== account.treeInfo.queue.toBase58() || topology.cpiContext !== account.treeInfo.cpiContext?.toBase58()
            || account.treeInfo.treeType !== TreeType.StateV2 || !account.owner.equals(program) || account.address === null
            || !Buffer.from(account.address).equals(compressedAddress.toBuffer()) || account.data === null
            || account.lamports.toString() !== "0" || !Number.isSafeInteger(account.leafIndex) || account.leafIndex < 0 || account.leafIndex > 0xffff_ffff
            || typeof account.proveByIndex !== "boolean")
            invalid("compressed account identity/topology is invalid");
        const decoded = decodeCompressedAmebaStateLeaf(account);
        if (decoded.domain !== input.domain || !decoded.canonicalPda.equals(input.canonicalPda))
            invalid("compact domain/PDA mismatch");
        const encodedData = Buffer.from(account.data.data);
        const dataHash = createHash("sha256").update(encodedData).digest();
        dataHash[0] = 0;
        if (proofHex(account.data.discriminator, 8) !== digest("CompressedAmebaStateLeaf").slice(0, 16)
            || proofHex(account.data.dataHash, 32) !== dataHash.toString("hex"))
            invalid("compact discriminator/data hash mismatch");
        raw = Object.freeze({ owner: account.owner.toBase58(), address: compressedAddress.toBase58(), lamports: account.lamports.toString(),
            data: Object.freeze({ discriminatorHex: proofHex(account.data.discriminator, 8), dataBase64: encodedData.toString("base64"), dataHashHex: dataHash.toString("hex") }),
            tree: account.treeInfo.tree.toBase58(), queue: account.treeInfo.queue.toBase58(), leafIndex: String(account.leafIndex), proveByIndex: account.proveByIndex, hashHex: fieldHex(account.hash) });
        leaf = Object.freeze({ schemaVersion: decoded.schemaVersion, canonicalPda: decoded.canonicalPda.toBase58(), domain: decoded.domain, revision: decoded.revision.toString(), dataBase64: Buffer.from(decoded.data).toString("base64") });
        statement = { kind: account.proveByIndex ? "state_queue" : "state_merkle", treeKeyHex: keyHex(account.treeInfo.tree), queueKeyHex: keyHex(account.treeInfo.queue), valueHex: raw.hashHex, leafIndex: raw.leafIndex };
    }
    else
        statement = { kind: "address_absent", treeKeyHex: keyHex(addressTree), valueHex: keyHex(compressedAddress) };
    if (statement.kind === "state_queue") {
        proofStatementJson = JSON.stringify({ kind: "state_queue", compressedAddress: compressedAddress.toBase58(), hashHex: raw.hashHex, tree: raw.tree, queue: raw.queue, leafIndex: raw.leafIndex, proveByIndex: true });
    }
    else {
        const hashes = account === null ? [] : [{ hash: account.hash, tree: account.treeInfo.tree, queue: account.treeInfo.queue }];
        const addresses = account === null ? [{ address: createBN254(compressedAddress.toBytes()), tree: addressTree, queue: addressQueue }] : [];
        const response = await input.getValidityProof(hashes, addresses);
        const proof = response.value;
        if (!Number.isSafeInteger(response.context.slot) || response.context.slot < 0 || proof.compressedProof === null
            || [proof.roots, proof.rootIndices, proof.leaves, proof.leafIndices, proof.proveByIndices, proof.treeInfos].some(values => values.length !== 1))
            invalid("single-statement proof response invalid");
        proofSlot = response.context.slot;
        const tree = proof.treeInfos[0];
        if (keyHex(tree.tree) !== statement.treeKeyHex || (account !== null ? keyHex(tree.queue) !== statement.queueKeyHex : !tree.queue.equals(addressQueue))
            || tree.treeType !== (account === null ? TreeType.AddressV2 : TreeType.StateV2)
            || !Number.isInteger(proof.rootIndices[0]) || proof.rootIndices[0] < 0 || proof.rootIndices[0] > 65535
            || (account === null ? !proof.leaves[0].isZero() : fieldHex(proof.leaves[0]) !== statement.valueHex || proof.leafIndices[0] !== account.leafIndex || proof.proveByIndices[0] !== false))
            invalid("proof statement differs from requested account/address");
        proofBytes = proofHex(proof.compressedProof.a, 32) + proofHex(proof.compressedProof.b, 64) + proofHex(proof.compressedProof.c, 32);
        statement = { ...statement, rootHex: fieldHex(proof.roots[0]), rootIndex: proof.rootIndices[0], proofHex: proofBytes };
        proofStatementJson = JSON.stringify({ kind: statement.kind, compressedAddress: compressedAddress.toBase58(), roots: proof.roots.map(fieldHex), rootIndices: proof.rootIndices,
            leaves: proof.leaves.map(fieldHex), leafIndices: proof.leafIndices, proveByIndices: proof.proveByIndices,
            trees: proof.treeInfos.map(value => ({ tree: value.tree.toBase58(), queue: value.queue.toBase58(), treeType: value.treeType })), contextSlot: proofSlot });
    }
    const floor = Math.max(start, requestedFloor, proofSlot);
    const addresses = [new PublicKey(Buffer.from(statement.treeKeyHex, "hex")), ...(statement.queueKeyHex === undefined ? [] : [new PublicKey(Buffer.from(statement.queueKeyHex, "hex"))])];
    const snapshot = await input.stateConnection.getMultipleAccountsInfoAndContext(addresses, { commitment: "finalized", minContextSlot: floor });
    if (!Number.isSafeInteger(snapshot.context.slot) || snapshot.context.slot < floor || snapshot.value.length !== addresses.length)
        invalid("finalized root/queue snapshot slot invalid");
    const accounts = snapshot.value.map((info, index) => {
        if (!info || info.executable || info.owner.toBase58() !== accountCompressionProgram || info.data.length < 8 || info.data.length > 16 * 1024 * 1024)
            invalid("root/queue snapshot owner or size invalid");
        return Object.freeze({ keyHex: keyHex(addresses[index]), ownerHex: keyHex(info.owner), executable: false, dataHex: Buffer.from(info.data).toString("hex") });
    });
    const identity = Object.freeze({ programIdHex: keyHex(program), addressTreeKeyHex: keyHex(addressTree), canonicalPdaHex: keyHex(input.canonicalPda), domain: input.domain });
    const contextBindingJson = JSON.stringify({ schema: CURRENT_COMPRESSED_EVIDENCE_SCHEMA, identity, providerOriginSha256: input.providerOriginSha256,
        compressedAddress: compressedAddress.toBase58(), compressedAccount: raw, leaf, proofStatementJson, proofBase64: proofBytes === null ? null : Buffer.from(proofBytes, "hex").toString("base64"), minimumSlot: String(floor) });
    const request = Object.freeze({ schema: CURRENT_COMPRESSED_EVIDENCE_SCHEMA,
        finalizedSlot: String(snapshot.context.slot), minimumSlot: String(floor), contextBindingHex: digest(contextBindingJson), identity,
        ...(raw === null ? {} : { compressedAccount: Object.freeze({ ownerHex: keyHex(program), addressHex: keyHex(compressedAddress), lamports: raw.lamports,
                discriminatorHex: raw.data.discriminatorHex, dataHex: Buffer.from(raw.data.dataBase64, "base64").toString("hex"), dataHashHex: raw.data.dataHashHex }) }),
        statement: Object.freeze(statement), accounts: Object.freeze(accounts) });
    validateCurrentCompressedEvidenceRequest(request);
    const result = await input.verifier.verify(request);
    return Object.freeze({ exists: account !== null, canonicalPda: input.canonicalPda.toBase58(), domain: input.domain, compressedAddress: compressedAddress.toBase58(),
        providerOriginSha256: input.providerOriginSha256, compressedAccount: raw, leaf,
        proofBase64: proofBytes === null ? null : Buffer.from(proofBytes, "hex").toString("base64"), proofStatementJson,
        verificationEvidence: Object.freeze({ request, result, contextBindingJson, executableSha256: input.verifier.executableSha256 }) });
}
//# sourceMappingURL=current-photon-verified.js.map