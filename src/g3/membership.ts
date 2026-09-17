import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import { type Connection, type PublicKey } from "@solana/web3.js";
import { deriveOracleRecipeSourceIndexPda, deriveOracleBucketSourceIndexPda,
  decodeOracleRecipeSourceIndex, decodeOracleBucketSourceIndex, deriveOracleMemberPagePda,
  decodeOracleMemberPage } from "@amoeba/spread-release-tools/oracle-dlmm";

export interface G3MembershipCursor {
  readonly version: 3; readonly scope: string; readonly nextPage: number; readonly minimumSlot: number;
}
/** Bounded read continuation. A returned prefix is never a complete median/rank witness. */
export async function readG3MembershipPage(input: {
  connection: Pick<Connection, "getGenesisHash" | "getMultipleAccountsInfoAndContext">;
  programId: PublicKey; genesisHash: string; oracleMonth: PublicKey; bucketId: Uint8Array;
  expectedRecipeHash: Uint8Array; expectedManifestHash: Uint8Array; minimumSlot: number;
  cursor?: G3MembershipCursor; pagesPerRead?: number;
}) {
  const pages = input.pagesPerRead ?? 8;
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 16 || !Number.isSafeInteger(input.minimumSlot)
    || input.minimumSlot < 0) throw new Error("Invalid membership page bound");
  const hashes = [input.bucketId, input.expectedRecipeHash, input.expectedManifestHash].map(v=>Buffer.from(v));
  if (hashes.some(v=>v.length!==32 || v.every(b=>b===0))) throw new Error("Membership requires exact nonzero hashes");
  const scope = createHash("sha256").update(JSON.stringify([3,input.genesisHash,input.programId.toBase58(),
    input.oracleMonth.toBase58(),...hashes.map(v=>v.toString("hex"))])).digest("hex");
  const c = input.cursor;
  if (c && (c.version!==3 || c.scope!==scope || !Number.isSafeInteger(c.nextPage) || c.nextPage<1
    || !Number.isSafeInteger(c.minimumSlot) || c.minimumSlot<0)) throw new Error("Foreign or invalid membership cursor");
  if (await input.connection.getGenesisHash() !== input.genesisHash) throw new Error("Membership genesis mismatch");
  const s = {programId:input.programId,oracleMonthPda:input.oracleMonth};
  const rootAddress = deriveOracleRecipeSourceIndexPda(s);
  const bucketAddress = deriveOracleBucketSourceIndexPda({...s,bucketId:hashes[0]!});
  const floor = Math.max(input.minimumSlot,c?.minimumSlot??0);
  const raw = await input.connection.getMultipleAccountsInfoAndContext([rootAddress,bucketAddress],{commitment:"finalized",minContextSlot:floor});
  if (!Number.isSafeInteger(raw.context.slot) || raw.context.slot<floor || raw.value.length!==2) throw new Error("Incomplete root observation");
  const [rootInfo,bucketInfo] = raw.value;
  for(const info of raw.value) if (!info || info.executable || !info.owner.equals(input.programId)) throw new Error("Invalid membership root owner");
  const root = decodeOracleRecipeSourceIndex({...s,data:rootInfo!.data});
  if (!root.complete || !root.recipeHash.equals(hashes[1]!) || !root.manifestHash.equals(hashes[2]!)) throw new Error("Unfinished or mismatched frozen root");
  const bucket = decodeOracleBucketSourceIndex({programId:input.programId,data:bucketInfo!.data,index:root,bucketId:hashes[0]!});
  const totalPages = Math.ceil(bucket.sourceCount/6), first = c?.nextPage??0;
  if (first>=totalPages) throw new Error("Cursor exceeds frozen membership");
  // Reload the prior page instead of trusting a cursor-supplied boundary value.
  const begin = Math.max(0,first-1), end = Math.min(totalPages,first+pages);
  const indices = Array.from({length:end-begin},(_,i)=>begin+i);
  const addresses = indices.map(pageIndex=>deriveOracleMemberPagePda({programId:input.programId,bucket:bucketAddress,pageIndex}));
  const batch = await input.connection.getMultipleAccountsInfoAndContext(addresses,{commitment:"finalized",minContextSlot:raw.context.slot});
  if (!Number.isSafeInteger(batch.context.slot) || batch.context.slot<raw.context.slot || batch.value.length!==indices.length) throw new Error("Incomplete member-page observation");
  const ids: Buffer[]=[]; let previous:Buffer|undefined;
  for(let j=0;j<indices.length;j++) {
    const info=batch.value[j]; if (!info || info.executable) throw new Error("Missing member page");
    const decoded=decodeOracleMemberPage({programId:input.programId,owner:info.owner,address:addresses[j]!,data:info.data,
      bucket:bucketAddress,sourceCount:bucket.sourceCount,pageIndex:indices[j]!});
    for(const id of decoded.descendingIds) {
      if(previous && Buffer.compare(previous,id)<=0) throw new Error("Member pages overlap or reorder sources");
      previous=id;if(indices[j]!>=first)ids.push(Buffer.from(id));
    }
  }
  const cursor:G3MembershipCursor|null=end===totalPages?null:Object.freeze({version:3,scope,nextPage:end,minimumSlot:batch.context.slot});
  return Object.freeze({sourceIds:Object.freeze(ids),sourceCount:bucket.sourceCount,firstPage:first,
    atEnd:cursor===null,membershipComplete:first===0 && cursor===null,cursor,observedSlot:batch.context.slot});
}
