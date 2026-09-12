import { CURRENT_LIVE_DEPLOYMENT } from "./release-train.js";
import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  unpackAccount,
  unpackMint,
} from "./current-token-primitives.js";
import {
  accountCompressionProgram,
  batchAddressTree,
  batchCpiContext1,
  batchCpiContext2,
  batchCpiContext3,
  batchCpiContext4,
  batchCpiContext5,
  batchMerkleTree1,
  batchMerkleTree2,
  batchMerkleTree3,
  batchMerkleTree4,
  batchMerkleTree5,
  batchQueue1,
  batchQueue2,
  batchQueue3,
  batchQueue4,
  batchQueue5,
  lightSystemProgram,
} from "@lightprotocol/stateless.js";
import {
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";

import {
  CURRENT_PROTOCOL_CLUSTER,
  CURRENT_PROTOCOL_DEPLOYMENT,
  CURRENT_PROTOCOL_DEVNET_GENESIS_HASH,
  CURRENT_PROTOCOL_RELEASE,
  CURRENT_PROTOCOL_SOURCE_COMMIT,
  CURRENT_VAULT_CONFIG_ACCOUNT_SIZE,
  decodeCurrentVaultConfigAccount,
} from "./current.js";
import {
  CurrentSdkOperationError,
  readCurrentDeploymentFacts,
  type CurrentDeploymentFacts,
  type ReadCurrentDeploymentFactsInput,
} from "./current-adapter.js";
import {
  CURRENT_LIGHT_PROGRAM_DEPLOYMENT_ORDER,
  type CurrentLightProgramDeployment,
} from "./current-light-deployments.js";
import {
  DEFAULT_AMEBA_SPREAD_PROGRAM_ID,
  LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
  LIGHT_TOKEN_CPI_AUTHORITY,
  LIGHT_TOKEN_PROGRAM_ID,
  LIGHT_TOKEN_RENT_SPONSOR,
  SPL_TOKEN_PROGRAM_ID,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import { deriveVaultConfigPda } from "@amoeba/spread-release-tools/oracle-dlmm";

const CURRENT_NAMESPACE_VALUE = "ameba-spread-v2" as const;
const CURRENT_COMMITMENT = "finalized" as const;
const CURRENT_PROGRAM_ID = new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID);
const BPF_UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const LIGHT_COMPRESSIBLE_CONFIG_PROGRAM_ID = new PublicKey("Lighton6oQpVkeewmo2mcPTQQp7kYHr4fWpAgJyEmDX");
const LIGHT_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey(accountCompressionProgram);
const LIGHT_SYSTEM_PROGRAM_ID = new PublicKey(lightSystemProgram);
const LIGHT_ADDRESS_TREE_ID = new PublicKey(batchAddressTree);

const LIGHT_COMPRESSIBLE_CONFIG_SIZE = 310;
const LIGHT_ADDRESS_TREE_V2_SIZE = 586_360;
const LIGHT_STATE_TREE_V2_SIZE = 584_440;
const LIGHT_OUTPUT_QUEUE_V2_SIZE = 962_536;
const LIGHT_CPI_CONTEXT_V2_SIZE = 20_488;
const LIGHT_TREE_DISCRIMINATOR = Buffer.from("BatchMta", "ascii");
const LIGHT_QUEUE_DISCRIMINATOR = Buffer.from("queueacc", "ascii");
const LIGHT_CPI_CONTEXT_DISCRIMINATOR = Buffer.from("22b8b70e6450b77c", "hex");
const LIGHT_COMPRESSIBLE_CONFIG_DISCRIMINATOR = Buffer.from("b404e71adc9037a8", "hex");

interface CanonicalLightStateTreeContext {
  readonly stateTree: PublicKey;
  readonly queue: PublicKey;
  readonly cpiContext: PublicKey;
}

const CURRENT_LIGHT_STATE_TREE_CONTEXTS: readonly CanonicalLightStateTreeContext[] = Object.freeze([
  Object.freeze({ stateTree: new PublicKey(batchMerkleTree1), queue: new PublicKey(batchQueue1), cpiContext: new PublicKey(batchCpiContext1) }),
  Object.freeze({ stateTree: new PublicKey(batchMerkleTree2), queue: new PublicKey(batchQueue2), cpiContext: new PublicKey(batchCpiContext2) }),
  Object.freeze({ stateTree: new PublicKey(batchMerkleTree3), queue: new PublicKey(batchQueue3), cpiContext: new PublicKey(batchCpiContext3) }),
  Object.freeze({ stateTree: new PublicKey(batchMerkleTree4), queue: new PublicKey(batchQueue4), cpiContext: new PublicKey(batchCpiContext4) }),
  Object.freeze({ stateTree: new PublicKey(batchMerkleTree5), queue: new PublicKey(batchQueue5), cpiContext: new PublicKey(batchCpiContext5) }),
]);

export interface ReadCurrentChainIdentityInput {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly namespace: typeof CURRENT_NAMESPACE_VALUE;
  readonly commitment: typeof CURRENT_COMMITMENT;
}

export interface CurrentLinkedProgramIdentityDto {
  readonly programId: string;
  readonly programDataAddress: string;
  readonly programDataBytes: number;
  readonly upgradeAuthority: string;
  readonly executable: true;
  readonly deployedSlot: string;
  readonly payloadBytes: number;
  readonly payloadSha256: string;
}

export interface CurrentLightStateTreeIdentityDto {
  readonly stateTree: string;
  readonly queue: string;
  readonly cpiContext: string;
}

export interface CurrentChainIdentityDto {
  readonly stateNamespace: typeof CURRENT_NAMESPACE_VALUE;
  readonly cluster: typeof CURRENT_PROTOCOL_CLUSTER;
  readonly genesisHash: typeof CURRENT_PROTOCOL_DEVNET_GENESIS_HASH;
  readonly releaseTag: typeof CURRENT_PROTOCOL_RELEASE;
  readonly releaseCommit: typeof CURRENT_PROTOCOL_SOURCE_COMMIT;
  readonly observedSlot: string;
  readonly program: {
    readonly programId: string;
    readonly programDataAddress: string;
    readonly programDataBytes: typeof CURRENT_PROTOCOL_PROGRAMDATA_BYTES;
    readonly upgradeAuthority: typeof CURRENT_PROTOCOL_UPGRADE_AUTHORITY;
    readonly executable: true;
    readonly deployedSlot: string;
    readonly payloadBytes: typeof CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES;
    readonly payloadSha256: typeof CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256;
  };
  readonly collateral: {
    readonly vaultConfigAddress: string;
    readonly mintAddress: string;
    readonly custodyAddress: string;
    readonly tokenProgram: string;
    readonly decimals: 6;
    readonly custodyAuthority: string;
    readonly custodyAmountAtomic: string;
  };
  readonly light: {
    readonly tokenProgram: CurrentLinkedProgramIdentityDto;
    readonly systemProgram: CurrentLinkedProgramIdentityDto;
    readonly accountCompressionProgram: CurrentLinkedProgramIdentityDto;
    readonly compressibleConfigProgram: CurrentLinkedProgramIdentityDto;
    readonly cpiAuthority: string;
    readonly compressibleConfig: string;
    readonly rentSponsor: string;
    readonly addressTree: string;
    readonly addressQueue: string;
    readonly stateTrees: readonly CurrentLightStateTreeIdentityDto[];
  };
}

interface CurrentChainIdentityDependencies {
  readonly readDeploymentFacts: (
    input: ReadCurrentDeploymentFactsInput,
  ) => Promise<CurrentDeploymentFacts>;
  readonly linkedProgramDeployments?: readonly CurrentLightProgramDeployment[];
  readonly hashProgramPayload?: (payload: Uint8Array) => string;
}

const DEFAULT_DEPENDENCIES: CurrentChainIdentityDependencies = Object.freeze({
  readDeploymentFacts: readCurrentDeploymentFacts,
  linkedProgramDeployments: CURRENT_LIGHT_PROGRAM_DEPLOYMENT_ORDER,
  hashProgramPayload: (payload: Uint8Array): string =>
    createHash("sha256").update(payload).digest("hex"),
});

type ChainErrorDetails = Record<string, string | number | boolean | null>;

function fail(code: string, message: string, details?: ChainErrorDetails): never {
  throw new CurrentSdkOperationError(code, message, details);
}

function causeText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function assertInput(input: ReadCurrentChainIdentityInput): void {
  if (!input.programId.equals(CURRENT_PROGRAM_ID)) {
    fail("CURRENT_CHAIN_PROGRAM_ID_MISMATCH", "chain identity requires the pinned rc.44 program id", {
      programId: input.programId.toBase58(),
      expected: CURRENT_PROGRAM_ID.toBase58(),
    });
  }
  if (input.namespace !== CURRENT_NAMESPACE_VALUE) {
    fail("CURRENT_CHAIN_NAMESPACE_MISMATCH", "chain identity requires the current state namespace", {
      namespace: input.namespace,
    });
  }
  if (input.commitment !== CURRENT_COMMITMENT) {
    fail("CURRENT_CHAIN_COMMITMENT_INVALID", "chain identity reads require finalized commitment");
  }
}

function assertSafeSlot(slot: number, minimum: number | null, label: string): void {
  if (!Number.isSafeInteger(slot) || slot < 0 || (minimum !== null && slot < minimum)) {
    fail("CURRENT_CHAIN_RPC_CONTEXT_INVALID", `${label} did not return a monotonic finalized slot`, {
      slot,
      minimum,
    });
  }
}

function exactPrimitiveRecord(actual: unknown, expected: Readonly<Record<string, unknown>>): boolean {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
  const record = actual as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && expectedKeys.every((key) => record[key] === expected[key]);
}

function assertPinnedDeploymentFacts(
  facts: CurrentDeploymentFacts,
  input: ReadCurrentChainIdentityInput,
): void {
  if (
    facts.stateNamespace !== CURRENT_NAMESPACE_VALUE
    || !exactPrimitiveRecord(facts.deployment, CURRENT_PROTOCOL_DEPLOYMENT)
    || facts.genesisHash !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH
    || facts.programId !== input.programId.toBase58()
    || facts.programExists !== true
    || facts.programExecutable !== true
    || facts.programDataAddress !== CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS
    || facts.programDataExists !== true
    || facts.programDataBytes !== CURRENT_PROTOCOL_PROGRAMDATA_BYTES
    || facts.upgradeAuthority !== CURRENT_PROTOCOL_UPGRADE_AUTHORITY
    || facts.programDataSlot !== CURRENT_PROTOCOL_DEPLOYED_SLOT
    || facts.programPayloadBytes !== CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES
    || facts.programPayloadSha256 !== CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256
    || facts.verified !== true
  ) {
    fail(
      "CURRENT_CHAIN_DEPLOYMENT_INVALID",
      "deployment reader did not return the exact verified rc.44 Program and ProgramData identity",
    );
  }
}

function requireAccount(
  info: AccountInfo<Buffer> | null | undefined,
  code: string,
  label: string,
): AccountInfo<Buffer> {
  if (info === null || info === undefined) fail(code, `${label} is absent at finalized commitment`);
  return info;
}

function assertExactDataAccount(input: {
  readonly info: AccountInfo<Buffer>;
  readonly expectedOwner: PublicKey;
  readonly expectedSize: number;
  readonly code: string;
  readonly label: string;
}): void {
  if (
    input.info.executable
    || !input.info.owner.equals(input.expectedOwner)
    || input.info.data.byteLength !== input.expectedSize
  ) {
    fail(input.code, `${input.label} owner, executable flag, or exact layout size is invalid`, {
      owner: input.info.owner.toBase58(),
      executable: input.info.executable,
      bytes: input.info.data.byteLength,
    });
  }
}

function parseUpgradeableProgram(
  address: PublicKey,
  info: AccountInfo<Buffer>,
  expected: CurrentLightProgramDeployment,
): PublicKey {
  const bytes = Buffer.from(info.data);
  if (
    !info.owner.equals(BPF_UPGRADEABLE_LOADER_ID)
    || !info.executable
    || bytes.length !== 36
    || bytes.readUInt32LE(0) !== 2
  ) {
    fail("CURRENT_LIGHT_PROGRAM_INVALID", "Light program is not an upgradeable-loader Program account", {
      programId: address.toBase58(),
      owner: info.owner.toBase58(),
      executable: info.executable,
      bytes: bytes.length,
    });
  }
  const programData = new PublicKey(bytes.subarray(4, 36));
  if (
    address.toBase58() !== expected.programId
    || programData.toBase58() !== expected.programDataAddress
  ) {
    fail("CURRENT_LIGHT_PROGRAM_INVALID", "Light program has an unexpected ProgramData linkage", {
      programId: address.toBase58(),
      programDataAddress: programData.toBase58(),
    });
  }
  return programData;
}

function assertUpgradeableProgramData(
  programId: PublicKey,
  programDataAddress: PublicKey,
  info: AccountInfo<Buffer>,
  expected: CurrentLightProgramDeployment,
  hashProgramPayload: (payload: Uint8Array) => string,
): CurrentLinkedProgramIdentityDto {
  const bytes = Buffer.from(info.data);
  if (
    !info.owner.equals(BPF_UPGRADEABLE_LOADER_ID)
    || info.executable
    || bytes.length !== expected.programDataBytes
    || bytes.readUInt32LE(0) !== 3
    || bytes[12] !== 1
    || programId.toBase58() !== expected.programId
    || programDataAddress.toBase58() !== expected.programDataAddress
  ) {
    fail("CURRENT_LIGHT_PROGRAM_INVALID", "Light ProgramData linkage, allocation, or layout is invalid", {
      programId: programId.toBase58(),
      programDataAddress: programDataAddress.toBase58(),
      owner: info.owner.toBase58(),
      executable: info.executable,
      bytes: bytes.length,
    });
  }
  const deployedSlot = bytes.readBigUInt64LE(4);
  const upgradeAuthority = new PublicKey(bytes.subarray(13, 45)).toBase58();
  const payload = bytes.subarray(45);
  const payloadSha256 = hashProgramPayload(payload);
  if (
    deployedSlot !== BigInt(expected.deployedSlot)
    || upgradeAuthority !== expected.upgradeAuthority
    || payload.length !== expected.payloadBytes
    || payloadSha256 !== expected.payloadSha256
  ) {
    fail("CURRENT_LIGHT_PROGRAM_INVALID", "Light ProgramData code identity is not the reviewed deployment", {
      programId: programId.toBase58(),
      deployedSlot: deployedSlot.toString(),
      upgradeAuthority,
      payloadBytes: payload.length,
      payloadSha256,
    });
  }
  return Object.freeze({
    programId: expected.programId,
    programDataAddress: expected.programDataAddress,
    programDataBytes: expected.programDataBytes,
    upgradeAuthority: expected.upgradeAuthority,
    executable: true,
    deployedSlot: String(expected.deployedSlot),
    payloadBytes: expected.payloadBytes,
    payloadSha256: expected.payloadSha256,
  });
}

function assertSystemIdentityAccount(
  address: PublicKey,
  info: AccountInfo<Buffer>,
  label: string,
): void {
  if (info.executable || !info.owner.equals(SystemProgram.programId) || info.data.byteLength !== 0) {
    fail("CURRENT_LIGHT_SYSTEM_IDENTITY_INVALID", `${label} is not the exact system-owned identity account`, {
      address: address.toBase58(),
      owner: info.owner.toBase58(),
      executable: info.executable,
      bytes: info.data.byteLength,
    });
  }
}

function assertCompressibleConfig(info: AccountInfo<Buffer>): void {
  assertExactDataAccount({
    info,
    expectedOwner: LIGHT_COMPRESSIBLE_CONFIG_PROGRAM_ID,
    expectedSize: LIGHT_COMPRESSIBLE_CONFIG_SIZE,
    code: "CURRENT_LIGHT_CONFIG_INVALID",
    label: "Light compressible config",
  });
  const bytes = Buffer.from(info.data);
  if (
    !bytes.subarray(0, 8).equals(LIGHT_COMPRESSIBLE_CONFIG_DISCRIMINATOR)
    || bytes[8] !== 1
    || (bytes[9] !== 0 && bytes[9] !== 1)
    || !new PublicKey(bytes.subarray(76, 108)).equals(LIGHT_TOKEN_RENT_SPONSOR)
    || !new PublicKey(bytes.subarray(150, 182)).equals(LIGHT_ADDRESS_TREE_ID)
    || bytes.subarray(182).some((byte) => byte !== 0)
  ) {
    fail("CURRENT_LIGHT_CONFIG_INVALID", "Light compressible config discriminator, version, sponsor, address tree, or reserved bytes are invalid");
  }
}

function assertAddressTree(info: AccountInfo<Buffer>): void {
  assertExactDataAccount({
    info,
    expectedOwner: LIGHT_ACCOUNT_COMPRESSION_PROGRAM_ID,
    expectedSize: LIGHT_ADDRESS_TREE_V2_SIZE,
    code: "CURRENT_LIGHT_ADDRESS_TREE_INVALID",
    label: "Light AddressV2 tree",
  });
  const bytes = Buffer.from(info.data);
  if (!bytes.subarray(0, 8).equals(LIGHT_TREE_DISCRIMINATOR) || bytes.readBigUInt64LE(8) !== 4n) {
    fail("CURRENT_LIGHT_ADDRESS_TREE_INVALID", "Light address tree is not the exact AddressV2 layout");
  }
}

function assertStateTree(
  context: CanonicalLightStateTreeContext,
  info: AccountInfo<Buffer>,
): void {
  assertExactDataAccount({
    info,
    expectedOwner: LIGHT_ACCOUNT_COMPRESSION_PROGRAM_ID,
    expectedSize: LIGHT_STATE_TREE_V2_SIZE,
    code: "CURRENT_LIGHT_STATE_TREE_INVALID",
    label: "Light StateV2 tree",
  });
  const bytes = Buffer.from(info.data);
  if (
    !bytes.subarray(0, 8).equals(LIGHT_TREE_DISCRIMINATOR)
    || bytes.readBigUInt64LE(8) !== 3n
    || !new PublicKey(bytes.subarray(168, 200)).equals(context.queue)
  ) {
    fail("CURRENT_LIGHT_STATE_TREE_INVALID", "Light StateV2 tree type or output-queue linkage is invalid", {
      stateTree: context.stateTree.toBase58(),
    });
  }
}

function assertOutputQueue(
  context: CanonicalLightStateTreeContext,
  info: AccountInfo<Buffer>,
): void {
  assertExactDataAccount({
    info,
    expectedOwner: LIGHT_ACCOUNT_COMPRESSION_PROGRAM_ID,
    expectedSize: LIGHT_OUTPUT_QUEUE_V2_SIZE,
    code: "CURRENT_LIGHT_QUEUE_INVALID",
    label: "Light StateV2 output queue",
  });
  const bytes = Buffer.from(info.data);
  if (
    !bytes.subarray(0, 8).equals(LIGHT_QUEUE_DISCRIMINATOR)
    || !new PublicKey(bytes.subarray(160, 192)).equals(context.stateTree)
  ) {
    fail("CURRENT_LIGHT_QUEUE_INVALID", "Light output queue discriminator or StateV2-tree linkage is invalid", {
      queue: context.queue.toBase58(),
    });
  }
}

function assertCpiContext(
  context: CanonicalLightStateTreeContext,
  info: AccountInfo<Buffer>,
): void {
  assertExactDataAccount({
    info,
    expectedOwner: LIGHT_SYSTEM_PROGRAM_ID,
    expectedSize: LIGHT_CPI_CONTEXT_V2_SIZE,
    code: "CURRENT_LIGHT_CPI_CONTEXT_INVALID",
    label: "Light StateV2 CPI context",
  });
  const bytes = Buffer.from(info.data);
  if (
    !bytes.subarray(0, 8).equals(LIGHT_CPI_CONTEXT_DISCRIMINATOR)
    || bytes.subarray(8, 40).some((byte) => byte !== 0)
    || !new PublicKey(bytes.subarray(40, 72)).equals(context.stateTree)
  ) {
    fail("CURRENT_LIGHT_CPI_CONTEXT_INVALID", "Light CPI context discriminator or StateV2-tree linkage is invalid", {
      cpiContext: context.cpiContext.toBase58(),
    });
  }
}

export function readCurrentChainIdentity(
  input: ReadCurrentChainIdentityInput,
): Promise<CurrentChainIdentityDto>;
export async function readCurrentChainIdentity(
  input: ReadCurrentChainIdentityInput,
  dependencies: CurrentChainIdentityDependencies = DEFAULT_DEPENDENCIES,
): Promise<CurrentChainIdentityDto> {
  assertInput(input);
  const deployment = await dependencies.readDeploymentFacts({
    connection: input.connection,
    programId: input.programId,
    namespace: input.namespace,
    commitment: input.commitment,
  });
  assertPinnedDeploymentFacts(deployment, input);

  const vaultConfigAddress = deriveVaultConfigPda(input.programId);
  const vaultSnapshot = await input.connection.getAccountInfoAndContext(vaultConfigAddress, {
    commitment: CURRENT_COMMITMENT,
  });
  assertSafeSlot(vaultSnapshot.context.slot, null, "VaultConfig read");
  const vaultInfo = requireAccount(
    vaultSnapshot.value,
    "CURRENT_VAULT_IDENTITY_INVALID",
    "current VaultConfig",
  );
  let vaultConfig;
  try {
    vaultConfig = decodeCurrentVaultConfigAccount({
      address: vaultConfigAddress,
      data: vaultInfo.data,
      owner: vaultInfo.owner,
      executable: vaultInfo.executable,
      namespace: input.namespace,
      programId: input.programId,
    });
  } catch (cause) {
    fail("CURRENT_VAULT_IDENTITY_INVALID", "current VaultConfig failed its exact owner, PDA, bump, or layout checks", {
      cause: causeText(cause),
    });
  }

  const linkedPrograms = [
    LIGHT_TOKEN_PROGRAM_ID,
    LIGHT_SYSTEM_PROGRAM_ID,
    LIGHT_ACCOUNT_COMPRESSION_PROGRAM_ID,
    LIGHT_COMPRESSIBLE_CONFIG_PROGRAM_ID,
  ] as const;
  const linkedProgramDeployments = dependencies.linkedProgramDeployments
    ?? CURRENT_LIGHT_PROGRAM_DEPLOYMENT_ORDER;
  const hashProgramPayload = dependencies.hashProgramPayload
    ?? DEFAULT_DEPENDENCIES.hashProgramPayload!;
  if (
    linkedProgramDeployments.length !== linkedPrograms.length
    || linkedPrograms.some(
      (programId, index) => programId.toBase58() !== linkedProgramDeployments[index]?.programId,
    )
  ) {
    fail("CURRENT_LIGHT_PROGRAM_INVALID", "Light deployment policy does not match the canonical program set");
  }
  const coreAddresses = [
    vaultConfig.usdcMint,
    vaultConfig.vaultTokenAccount,
    ...linkedPrograms,
    LIGHT_TOKEN_CPI_AUTHORITY,
    LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
    LIGHT_TOKEN_RENT_SPONSOR,
    LIGHT_ADDRESS_TREE_ID,
    ...CURRENT_LIGHT_STATE_TREE_CONTEXTS.flatMap((context) => [context.stateTree, context.queue, context.cpiContext]),
  ];
  const uniqueCoreAddresses = new Set(coreAddresses.map((address) => address.toBase58()));
  if (uniqueCoreAddresses.size !== coreAddresses.length) {
    fail("CURRENT_CHAIN_IDENTITY_COLLISION", "canonical current chain identities unexpectedly collide");
  }
  const coreSnapshot = await input.connection.getMultipleAccountsInfoAndContext(coreAddresses, {
    commitment: CURRENT_COMMITMENT,
    minContextSlot: vaultSnapshot.context.slot,
  });
  assertSafeSlot(coreSnapshot.context.slot, vaultSnapshot.context.slot, "current chain identity read");
  if (coreSnapshot.value.length !== coreAddresses.length) {
    fail("CURRENT_CHAIN_RPC_CONTEXT_INVALID", "RPC returned the wrong number of current chain identity accounts");
  }
  const coreAccounts = new Map<string, AccountInfo<Buffer> | null>();
  coreAddresses.forEach((address, index) => coreAccounts.set(address.toBase58(), coreSnapshot.value[index] ?? null));
  const getCore = (address: PublicKey, code: string, label: string): AccountInfo<Buffer> => requireAccount(
    coreAccounts.get(address.toBase58()),
    code,
    label,
  );

  const collateralMintInfo = getCore(vaultConfig.usdcMint, "CURRENT_COLLATERAL_MINT_INVALID", "current collateral mint");
  assertExactDataAccount({
    info: collateralMintInfo,
    expectedOwner: SPL_TOKEN_PROGRAM_ID,
    expectedSize: MINT_SIZE,
    code: "CURRENT_COLLATERAL_MINT_INVALID",
    label: "current collateral mint",
  });
  let collateralMint;
  try {
    collateralMint = unpackMint(vaultConfig.usdcMint, collateralMintInfo, SPL_TOKEN_PROGRAM_ID);
  } catch (cause) {
    fail("CURRENT_COLLATERAL_MINT_INVALID", "current collateral mint is not a classic SPL mint", { cause: causeText(cause) });
  }
  if (
    vaultConfig.usdcMint.equals(PublicKey.default)
    || !collateralMint.isInitialized
    || collateralMint.decimals !== 6
    || collateralMint.tlvData.byteLength !== 0
  ) {
    fail("CURRENT_COLLATERAL_MINT_INVALID", "current collateral mint initialization, decimals, or classic SPL layout is invalid");
  }

  const custodyInfo = getCore(vaultConfig.vaultTokenAccount, "CURRENT_COLLATERAL_CUSTODY_INVALID", "current collateral custody");
  assertExactDataAccount({
    info: custodyInfo,
    expectedOwner: SPL_TOKEN_PROGRAM_ID,
    expectedSize: ACCOUNT_SIZE,
    code: "CURRENT_COLLATERAL_CUSTODY_INVALID",
    label: "current collateral custody",
  });
  let custody;
  try {
    custody = unpackAccount(vaultConfig.vaultTokenAccount, custodyInfo, SPL_TOKEN_PROGRAM_ID);
  } catch (cause) {
    fail("CURRENT_COLLATERAL_CUSTODY_INVALID", "current collateral custody is not a classic SPL token account", { cause: causeText(cause) });
  }
  if (
    vaultConfig.vaultTokenAccount.equals(PublicKey.default)
    || !custody.mint.equals(vaultConfig.usdcMint)
    || !custody.owner.equals(vaultConfigAddress)
    || !custody.isInitialized
    || custody.isFrozen
    || custody.delegate !== null
    || custody.delegatedAmount !== 0n
    || custody.isNative
    || custody.rentExemptReserve !== null
    || custody.closeAuthority !== null
    || custody.tlvData.byteLength !== 0
  ) {
    fail("CURRENT_COLLATERAL_CUSTODY_INVALID", "current collateral custody mint, authority, state, or classic SPL policy is invalid");
  }

  const programDataAddresses = linkedPrograms.map((programId, index) => parseUpgradeableProgram(
    programId,
    getCore(programId, "CURRENT_LIGHT_PROGRAM_INVALID", "canonical Light program"),
    linkedProgramDeployments[index]!,
  ));
  if (new Set(programDataAddresses.map((address) => address.toBase58())).size !== programDataAddresses.length) {
    fail("CURRENT_LIGHT_PROGRAM_INVALID", "canonical Light programs have colliding ProgramData links");
  }
  const programDataSnapshot = await input.connection.getMultipleAccountsInfoAndContext(programDataAddresses, {
    commitment: CURRENT_COMMITMENT,
    minContextSlot: coreSnapshot.context.slot,
  });
  assertSafeSlot(programDataSnapshot.context.slot, coreSnapshot.context.slot, "Light ProgramData read");
  if (programDataSnapshot.value.length !== programDataAddresses.length) {
    fail("CURRENT_CHAIN_RPC_CONTEXT_INVALID", "RPC returned the wrong number of Light ProgramData accounts");
  }
  const linkedProgramIdentities = Object.freeze(programDataAddresses.map((programDataAddress, index) => assertUpgradeableProgramData(
    linkedPrograms[index]!,
    programDataAddress,
    requireAccount(programDataSnapshot.value[index], "CURRENT_LIGHT_PROGRAM_INVALID", "Light ProgramData"),
    linkedProgramDeployments[index]!,
    hashProgramPayload,
  )));

  assertSystemIdentityAccount(
    LIGHT_TOKEN_CPI_AUTHORITY,
    getCore(LIGHT_TOKEN_CPI_AUTHORITY, "CURRENT_LIGHT_SYSTEM_IDENTITY_INVALID", "Light CPI authority"),
    "Light CPI authority",
  );
  assertSystemIdentityAccount(
    LIGHT_TOKEN_RENT_SPONSOR,
    getCore(LIGHT_TOKEN_RENT_SPONSOR, "CURRENT_LIGHT_SYSTEM_IDENTITY_INVALID", "Light rent sponsor"),
    "Light rent sponsor",
  );
  assertCompressibleConfig(getCore(
    LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
    "CURRENT_LIGHT_CONFIG_INVALID",
    "Light compressible config",
  ));
  assertAddressTree(getCore(
    LIGHT_ADDRESS_TREE_ID,
    "CURRENT_LIGHT_ADDRESS_TREE_INVALID",
    "Light AddressV2 tree",
  ));
  for (const context of CURRENT_LIGHT_STATE_TREE_CONTEXTS) {
    assertStateTree(context, getCore(context.stateTree, "CURRENT_LIGHT_STATE_TREE_INVALID", "Light StateV2 tree"));
    assertOutputQueue(context, getCore(context.queue, "CURRENT_LIGHT_QUEUE_INVALID", "Light StateV2 output queue"));
    assertCpiContext(context, getCore(context.cpiContext, "CURRENT_LIGHT_CPI_CONTEXT_INVALID", "Light StateV2 CPI context"));
  }

  const stateTrees = Object.freeze(CURRENT_LIGHT_STATE_TREE_CONTEXTS.map((context) => Object.freeze({
    stateTree: context.stateTree.toBase58(),
    queue: context.queue.toBase58(),
    cpiContext: context.cpiContext.toBase58(),
  })));
  return Object.freeze({
    stateNamespace: CURRENT_NAMESPACE_VALUE,
    cluster: CURRENT_PROTOCOL_CLUSTER,
    genesisHash: CURRENT_PROTOCOL_DEVNET_GENESIS_HASH,
    releaseTag: CURRENT_PROTOCOL_RELEASE,
    releaseCommit: CURRENT_PROTOCOL_SOURCE_COMMIT,
    observedSlot: String(programDataSnapshot.context.slot),
    program: Object.freeze({
      programId: input.programId.toBase58(),
      programDataAddress: CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS,
      programDataBytes: CURRENT_PROTOCOL_PROGRAMDATA_BYTES,
      upgradeAuthority: CURRENT_PROTOCOL_UPGRADE_AUTHORITY,
      executable: true,
      deployedSlot: String(CURRENT_PROTOCOL_DEPLOYED_SLOT),
      payloadBytes: CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES,
      payloadSha256: CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256,
    }),
    collateral: Object.freeze({
      vaultConfigAddress: vaultConfigAddress.toBase58(),
      mintAddress: vaultConfig.usdcMint.toBase58(),
      custodyAddress: vaultConfig.vaultTokenAccount.toBase58(),
      tokenProgram: SPL_TOKEN_PROGRAM_ID.toBase58(),
      decimals: 6,
      custodyAuthority: vaultConfigAddress.toBase58(),
      custodyAmountAtomic: custody.amount.toString(10),
    }),
    light: Object.freeze({
      tokenProgram: linkedProgramIdentities[0]!,
      systemProgram: linkedProgramIdentities[1]!,
      accountCompressionProgram: linkedProgramIdentities[2]!,
      compressibleConfigProgram: linkedProgramIdentities[3]!,
      cpiAuthority: LIGHT_TOKEN_CPI_AUTHORITY.toBase58(),
      compressibleConfig: LIGHT_TOKEN_COMPRESSIBLE_CONFIG.toBase58(),
      rentSponsor: LIGHT_TOKEN_RENT_SPONSOR.toBase58(),
      addressTree: LIGHT_ADDRESS_TREE_ID.toBase58(),
      addressQueue: LIGHT_ADDRESS_TREE_ID.toBase58(),
      stateTrees,
    }),
  });
}

const CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS = CURRENT_LIVE_DEPLOYMENT.programDataAddress;
const CURRENT_PROTOCOL_PROGRAMDATA_BYTES = CURRENT_LIVE_DEPLOYMENT.programDataAccountBytes;
const CURRENT_PROTOCOL_UPGRADE_AUTHORITY = CURRENT_LIVE_DEPLOYMENT.upgradeAuthority.address;
const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES = CURRENT_LIVE_DEPLOYMENT.programDataPayloadBytes;
const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256 = CURRENT_LIVE_DEPLOYMENT.programDataPayloadSha256;
const CURRENT_PROTOCOL_DEPLOYED_SLOT = CURRENT_LIVE_DEPLOYMENT.programDataSlot;
