/** Browser-native identity decoding for the sleeve-owned writer liquidity lane. */
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { equalBytes, u64Le, walletError } from "./codec.js";
import { CURRENT_PROGRAM_ID, deriveWriterPda } from "./manifest.js";
import { requireCurrentProgramData, WalletWriterAccountReader } from "./writer-accounts.js";
import type { WriterDlmmPolicyAccountV1, WriterDlmmPositionAccountV1 } from "../protocol/writer-dlmm-native-internal.js";

type Accounts = ReadonlyMap<string, AccountInfo<Uint8Array> | null>;
const TEXT = new TextEncoder();
function invalid(message: string): never { walletError("CURRENT_WALLET_ACCOUNT_INVALID", message); }
function start(address: PublicKey, accounts: Accounts, size: number, discriminator: string) {
  const reader = new WalletWriterAccountReader(requireCurrentProgramData(accounts, address, size, discriminator));
  if (!reader.bool()) invalid("writer liquidity account is uninitialized");
  const bump = reader.u8();
  if (String.fromCharCode(...reader.bytes(3)) !== discriminator || reader.u8() !== 1) invalid("writer liquidity account version differs");
  return { reader, bump };
}
function pda(seed: string, keys: readonly PublicKey[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TEXT.encode("ameba-spread-v2"), TEXT.encode(seed), ...keys.map(key => key.toBytes())], CURRENT_PROGRAM_ID);
}
export const deriveWalletWriterDlmmPolicy = (sleeve: PublicKey): PublicKey => pda("writer-dlmm-policy", [sleeve])[0];
export const deriveWalletWriterDlmmPosition = (pool: PublicKey, sleeve: PublicKey): PublicKey => pda("writer-dlmm-position", [pool, sleeve])[0];

export function decodeWalletWriterDlmmPolicy(address: PublicKey, accounts: Accounts): WriterDlmmPolicyAccountV1 {
  const { reader, bump } = start(address, accounts, 1843, "WLP");
  const sleeve = reader.pubkey(), policySnapshot = reader.pubkey(), managementAuthority = reader.pubkey();
  const committingPolicyAuthority = reader.pubkey(), expectedPolicyHash = reader.bytes(32), rollingPolicyHash = reader.bytes(32);
  const monthlyBuybackCapAtoms = reader.u64(), transactionBuybackCapAtoms = reader.u64(), reserveReleaseSpendRatioPpm = reader.u64();
  const priceSeparationTicks = reader.u16(), seriesCount = reader.u8(), appendedSeriesCount = reader.u8();
  const sealed = reader.bool(), createdSlot = reader.u64(), sealedSlot = reader.u64();
  const spendingMonthStartTs = reader.u64(), monthlySpentAtoms = reader.u64();
  const totalPoolQuoteAtoms = reader.u64(), totalUncommittedQuoteAtoms = reader.u64();
  const allSeries = Array.from({ length: 32 }, () => Object.freeze({ conservativeClaimValueAtoms: reader.u64(),
    sellerFloorQuoteAtoms: reader.u64(), monthlyBuybackCapAtoms: reader.u64(), transactionBuybackCapAtoms: reader.u64() }));
  const allSpent = Array.from({ length: 32 }, () => reader.u64());
  const allInventory = Array.from({ length: 32 }, () => reader.u64());
  reader.zeroBytes(32); reader.finishZeroPadded();
  const [expected, expectedBump] = pda("writer-dlmm-policy", [sleeve]);
  if (!address.equals(expected) || bump !== expectedBump || seriesCount < 1 || seriesCount > 20 || appendedSeriesCount > seriesCount
    || managementAuthority.equals(PublicKey.default) || committingPolicyAuthority.equals(PublicKey.default)
    || !expectedPolicyHash.some(value => value !== 0) || reserveReleaseSpendRatioPpm > 1_000_000n || priceSeparationTicks === 0
    || totalUncommittedQuoteAtoms > totalPoolQuoteAtoms
    || (sealed && (appendedSeriesCount !== seriesCount || !equalBytes(expectedPolicyHash, rollingPolicyHash)))
    || allSeries.slice(appendedSeriesCount).some(entry => Object.values(entry).some(value => value !== 0n))
    || allSpent.slice(seriesCount).some(value => value !== 0n) || allInventory.slice(seriesCount).some(value => value !== 0n)
    || allSpent.reduce((sum, value) => sum + value, 0n) !== monthlySpentAtoms || monthlySpentAtoms > monthlyBuybackCapAtoms
    || allSpent.slice(0, appendedSeriesCount).some((value, index) => value > allSeries[index]!.monthlyBuybackCapAtoms)) {
    invalid("writer liquidity policy identity or native layout invariants differ");
  }
  return Object.freeze({ address, bump, sleeve, policySnapshot, managementAuthority, committingPolicyAuthority,
    expectedPolicyHash, rollingPolicyHash, monthlyBuybackCapAtoms, transactionBuybackCapAtoms, reserveReleaseSpendRatioPpm,
    priceSeparationTicks, seriesCount, appendedSeriesCount, sealed, createdSlot, sealedSlot, spendingMonthStartTs,
    monthlySpentAtoms, totalPoolQuoteAtoms, totalUncommittedQuoteAtoms, series: Object.freeze(allSeries.slice(0, appendedSeriesCount)),
    seriesMonthlySpentAtoms: Object.freeze(allSpent.slice(0, seriesCount)), seriesPoolInventoryAtoms: Object.freeze(allInventory.slice(0, seriesCount)) });
}

export function decodeWalletWriterDlmmPosition(address: PublicKey, accounts: Accounts): WriterDlmmPositionAccountV1 {
  const { reader, bump } = start(address, accounts, 776, "WDP");
  const pool = reader.pubkey(), sleeve = reader.pubkey(), policy = reader.pubkey(), market = reader.pubkey();
  const seriesIndex = reader.u8(), binCount = reader.u8(), uncommittedQuoteAtoms = reader.u64();
  const optionInventoryAtoms = reader.u64(), allocatedQuoteAtoms = reader.u64(), lastUpdatedSlot = reader.u64();
  const allBins = Array.from({ length: 32 }, () => Object.freeze({ binId: reader.u16(), optionAtoms: reader.u64(), quoteAtoms: reader.u64() }));
  reader.zeroBytes(32); reader.finishZeroPadded();
  const [expected, expectedBump] = pda("writer-dlmm-position", [pool, sleeve]);
  const bins = allBins.slice(0, binCount);
  if (!address.equals(expected) || bump !== expectedBump || seriesIndex >= 20 || binCount > 32
    || !policy.equals(deriveWalletWriterDlmmPolicy(sleeve))
    || allBins.slice(binCount).some(bin => bin.binId !== 0 || bin.optionAtoms !== 0n || bin.quoteAtoms !== 0n)
    || bins.some((bin, index) => bin.binId === 0 || bin.binId > 2048 || (index > 0 && bin.binId <= bins[index - 1]!.binId)
      || (bin.optionAtoms === 0n && bin.quoteAtoms === 0n))
    || bins.reduce((sum, bin) => sum + bin.optionAtoms, 0n) !== optionInventoryAtoms
    || bins.reduce((sum, bin) => sum + bin.quoteAtoms, 0n) !== allocatedQuoteAtoms) invalid("writer position identity or native inventory differs");
  return Object.freeze({ address, bump, pool, sleeve, policy, market, seriesIndex, binCount,
    uncommittedQuoteAtoms, optionInventoryAtoms, allocatedQuoteAtoms, lastUpdatedSlot, bins: Object.freeze(bins) });
}

export function decodeWalletWriterPolicyRegistry(address: PublicKey, accounts: Accounts) {
  const { reader, bump } = start(address, accounts, 198, "WPR");
  const vaultConfig = reader.pubkey(), policyAuthority = reader.pubkey();
  reader.pubkey(); reader.pubkey(); for (let index = 0; index < 4; index += 1) reader.u64();
  reader.zeroBytes(32); reader.finishZeroPadded();
  const [expected, expectedBump] = pda("writer_policy_registry_v1", []);
  if (!expected.equals(address) || bump !== expectedBump || policyAuthority.equals(PublicKey.default)) invalid("writer policy registry identity differs");
  return Object.freeze({ address, vaultConfig, policyAuthority });
}

export function decodeWalletWriterPolicySnapshot(address: PublicKey, accounts: Accounts) {
  const { reader, bump } = start(address, accounts, 344, "WPS");
  const sleeve = reader.pubkey(), registry = reader.pubkey(), policyVersion = reader.u64();
  reader.u64(); const policyHash = reader.bytes(32); reader.bytes(64); const seriesFamilyHash = reader.bytes(32);
  const securityMode = reader.u8(); reader.zeroBytes(3); const maxSeries = reader.u8(); reader.zeroBytes(1);
  const primaryFeeBps = reader.u16(); reader.zeroBytes(2);
  for (let index = 0; index < 9; index += 1) reader.u64();
  const createdSlot = reader.u64(), sealedSlot = reader.u64();
  reader.zeroBytes(32); reader.finishZeroPadded();
  const expected = deriveWriterPda("writer_policy_snapshot_v1", [sleeve], [u64Le(policyVersion)]);
  const expectedWithBump = PublicKey.findProgramAddressSync([TEXT.encode("ameba-spread-v2"), TEXT.encode("writer_policy_snapshot_v1"), sleeve.toBytes(), u64Le(policyVersion)], CURRENT_PROGRAM_ID);
  if (!expected.equals(address) || bump !== expectedWithBump[1] || securityMode > 1 || maxSeries !== 20 || primaryFeeBps > 10_000) invalid("writer policy snapshot identity differs");
  return Object.freeze({ address, sleeve, registry, policyVersion, policyHash, seriesFamilyHash, createdSlot, sealedSlot });
}
