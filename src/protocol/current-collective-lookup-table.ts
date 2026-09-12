import { Buffer } from "buffer";
import { AddressLookupTableAccount, AddressLookupTableProgram, PublicKey, type AccountInfo } from "@solana/web3.js";
import type { CurrentFinalizedObservation } from "../current-finalized-observation.js";
import { equalBytes, sha256Hex } from "../wallet/codec.js";
import { AmebaProtocolError } from "../errors.js";

/** One exact raw ALT account; its owner, length, hash and slot bind through the finalized frame. */
export interface CurrentCollectiveLookupTableWitnessV1 { readonly address: string; readonly dataBase64: string; }
function invalid(message: string): never { throw new AmebaProtocolError(message, { code: "CURRENT_COLLECTIVE_LOOKUP_TABLE_INVALID" }); }
export function decodeCurrentCollectiveLookupTableV1(value: unknown, observation: CurrentFinalizedObservation,
  fresh?: { readonly observedSlot: number; readonly accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null> },
): { readonly witness: CurrentCollectiveLookupTableWitnessV1; readonly account: AddressLookupTableAccount } {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "address,dataBase64") invalid("lookup witness fields are not exact");
  const input = value as Record<string, unknown>;
  if (typeof input.address !== "string" || typeof input.dataBase64 !== "string" || input.dataBase64.length > 11000) invalid("lookup witness encoding is invalid");
  const address = new PublicKey(input.address);
  if (address.toBase58() !== input.address || address.equals(PublicKey.default)) invalid("lookup address is noncanonical");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.toString("base64") !== input.dataBase64 || bytes.length < 88 || bytes.length > 8248
    || (bytes.length - 56) % 32 !== 0 || bytes.readUInt32LE(0) !== 1) invalid("lookup raw account layout is invalid");
  const observed = observation.orderedAccounts.find(account => account.address === input.address);
  if (!observed || observed.owner !== AddressLookupTableProgram.programId.toBase58() || observed.executable !== false
    || observed.dataLength !== String(bytes.length) || observed.dataSha256 !== sha256Hex(bytes)) invalid("lookup raw bytes differ from finalized observation");
  const deactivationSlot = bytes.readBigUInt64LE(4), lastExtendedSlot = bytes.readBigUInt64LE(12);
  const startIndex = bytes[20]!, authorityOption = bytes[21]!;
  if (deactivationSlot !== 18_446_744_073_709_551_615n || lastExtendedSlot >= BigInt(observation.observedAtSlot)
    || lastExtendedSlot > BigInt(Number.MAX_SAFE_INTEGER) || startIndex > (bytes.length - 56) / 32
    || authorityOption > 1 || bytes.subarray(authorityOption === 0 ? 22 : 54, 56).some(byte => byte !== 0)) {
    invalid("lookup table is inactive, not warmed, or has a noncanonical header");
  }
  if (fresh) {
    const account = fresh.accountInfos.get(input.address);
    if (!Number.isSafeInteger(fresh.observedSlot) || BigInt(fresh.observedSlot) < BigInt(observation.observedAtSlot)
      || !account || account.executable || !account.owner.equals(AddressLookupTableProgram.programId)
      || !equalBytes(account.data, bytes)) invalid("lookup table changed after preparation");
  }
  const state = AddressLookupTableAccount.deserialize(bytes);
  const witness = Object.freeze({ address: input.address, dataBase64: input.dataBase64 });
  return Object.freeze({ witness, account: new AddressLookupTableAccount({ key: address, state }) });
}
