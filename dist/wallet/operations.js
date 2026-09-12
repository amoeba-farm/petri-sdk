import { deriveCollectiveSettlementDelegatePda } from "../protocol/writer-sleeve.js";
import { Buffer } from "buffer";
import { isCurrentWriterDlmmOperation } from "../protocol/writer-dlmm-public.js";
import { requireWriterDlmmWireBindingV1 } from "../protocol/writer-dlmm-wire.js";
import { currentWriterDlmmComputeInstructions, CURRENT_WRITER_DLMM_TRANSPORT_V1 } from "../protocol/writer-dlmm-transport.js";
import { decodeWalletWriterDlmmPolicy, decodeWalletWriterDlmmPosition, deriveWalletWriterDlmmPolicy, deriveWalletWriterDlmmPosition, decodeWalletWriterPolicyRegistry, decodeWalletWriterPolicySnapshot } from "./writer-dlmm-accounts.js";
import { inspectGovernedInstructionEnvelopeV1, inspectGovernedInstructionBatchV1 } from "../protocol/governance.js";
import { currentGovernedWriteReleaseV1 } from "../protocol/current-governed-release-internal.js";
/** Browser-native RC44 operation reconstruction from fresh finalized account bytes. */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { canonicalJson, decodeBase64, equalBytes, readU16Le, readU32Le, readU64Le, u64Le, walletError, } from "./codec.js";
import { COMPUTE_BUDGET_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, CURRENT_PROGRAM_ID, LIGHT_TOKEN_COMPRESSIBLE_CONFIG, LIGHT_TOKEN_CPI_AUTHORITY, LIGHT_TOKEN_PROGRAM_ID, LIGHT_TOKEN_RENT_SPONSOR, SPL_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, buildCreateLightAta, deriveClassicAta, deriveDlmmAuthority, deriveLightAta, deriveLightSplInterface, deriveWriterBid, deriveWriterPda, deriveWriterBidIndex, deriveWriterCloseFlatEscrow, deriveWriterCloseRequest, deriveWriterFlatMint, deriveWriterFlatBurnCustody, deriveWriterFlatStaging, deriveWriterRetirementCustody, deriveWriterSeriesBook, deriveWriterSleeveUsdcVault, manifestInstruction, pubkey, requireAddress, requireCanonicalComputeBudget, requireCanonicalSetupBatch, requireCanonicalSwapPdas, requireExactInstruction, requireFlags, } from "./manifest.js";
import { validateCurrentWalletLightTransfer2LoadSequence } from "./light-transfer2.js";
import { decodeCurrentWalletDlmmPage, decodeCurrentWalletDlmmPool } from "./swap-accounts.js";
import { CURRENT_WALLET_PROTOCOL_IDENTITY, } from "./observation.js";
import { decodeWalletWriterAuction, decodeWalletWriterBidIndex, decodeWalletWriterBid, decodeWalletWriterCloseRequest, decodeWalletWriterSeriesBook, decodeWalletWriterSleeve, } from "./writer-accounts.js";
const R = [false, false];
const RS = [true, false];
const W0 = [false, true];
const W = [true, true];
const FLAGS = Object.freeze({
    deposit: Object.freeze([
        W, R, W0, R, W0, W0, R, W0, W0, W0, R, R, W0, R, R, R, W0, R,
    ]),
    bid: Object.freeze([W, R, W0, W0, W0, R, R, W0, W0, R, W0, R, R, R, R, R, R, R, W0]),
    withdrawPrincipal: Object.freeze([W, R, W0, W0, W0, R, W0, W0, W0, W0, R, R, R, R]),
    auctionRefund: Object.freeze([RS, R, W0, W0, W0, W0, W0, R, R]),
    closeBegin: Object.freeze([W, R, W0, R, R, R, W0, W0, W0, W0, W0, R, R, R, R]),
    closeBasket: Object.freeze([W, R, R, W0, R, R, W0, W0, W0, R, R, R, R]),
    closeCancelSeries: Object.freeze([W, W0, R, W0, R, R, W0, W0, W0, R, R, R, R]),
    closeCancelFlat: Object.freeze([W, W0, W0, R, W0, W0, W0, R, R, R, R]),
    claimFlat: Object.freeze([W, R, W0, W0, W0, W0, W0, W0, W0, R, W0, R, R, R, R, R, W0]),
    claimCollective: Object.freeze([W, R, W0, R, W0, W0, W0, W0, W0, W0, W0, W0, R, W0, R, R, R, R, R, W0]),
});
const WRITER_NAMES = Object.freeze({
    writer_liquidity_policy_begin: ["ManageWriterDlmmV1", 159],
    writer_liquidity_policy_append: ["ManageWriterDlmmV1", 159],
    writer_liquidity_policy_seal: ["ManageWriterDlmmV1", 159],
    writer_liquidity_initialize: ["ManageWriterDlmmV1", 159],
    writer_liquidity_add: ["ManageWriterDlmmV1", 159],
    writer_liquidity_remove: ["ManageWriterDlmmV1", 159],
    writer_liquidity_sweep: ["ManageWriterDlmmV1", 159],
    deposit: ["DepositWriterPrincipalV1", 227],
    bid: ["PlaceWriterBidV1", 234],
    withdraw_principal: ["WithdrawWriterPrincipalV1", 228],
    auction_refund: ["CancelOrRefundWriterBidV1", 235],
    close_begin: ["BeginWriterCloseV1", 240],
    close_basket: ["DepositWriterCloseBasketV1", 241],
    close_finalize: ["FinalizeWriterCloseV1", 242],
    close_cancel: ["ProcessWriterCloseCancellationV1", 243],
    settlement_claim_flat: ["ClaimWriterFlatResidualV1", 247],
    settlement_claim_collective: ["ClaimCollectiveLongV1", 246],
});
function validateAndMaterializeSemanticPlan(envelope, reobservation) {
    const plan = envelope.operationPlan;
    let batches;
    if (plan.operation === "transfer_flat") {
        batches = validateFlat(plan, reobservation);
    }
    else if (plan.operation === "collective_swap_exact_in") {
        batches = validateSwap(plan, reobservation);
    }
    else {
        batches = validateWriter(envelope, reobservation);
    }
    const owner = plan.operation === "collective_swap_exact_in"
        ? String(plan.semantic.trader) : String(plan.semantic.owner);
    for (const [batchIndex, batch] of batches.entries()) {
        const signerAddresses = new Set(batch.flatMap((instruction) => instruction.keys
            .filter((meta) => meta.isSigner).map((meta) => meta.pubkey.toBase58())));
        if (batch.length < 1 || batch.length > 32 || signerAddresses.size !== 1 || !signerAddresses.has(owner)) {
            walletError("CURRENT_WALLET_SIGNER_INVALID", `execution batch ${batchIndex} must require exactly the selected wallet owner`);
        }
    }
    return Object.freeze(batches.map((batch) => Object.freeze([...batch])));
}
function validateWriter(envelope, reobservation) {
    const plan = envelope.operationPlan;
    const manifest = plan.instructions[0];
    const expectedIdentity = WRITER_NAMES[plan.operation];
    if (expectedIdentity === undefined || manifest.instructionName !== expectedIdentity[0]
        || manifest.instructionTag !== expectedIdentity[1] || manifest.programId !== CURRENT_PROGRAM_ID.toBase58()) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer instruction name, tag, or program is not RC44");
    }
    const data = decodeBase64(manifest.dataBase64, "writer instruction data");
    switch (plan.operation) {
        case "writer_liquidity_policy_begin":
        case "writer_liquidity_policy_append":
        case "writer_liquidity_policy_seal":
        case "writer_liquidity_initialize":
        case "writer_liquidity_add":
        case "writer_liquidity_remove":
        case "writer_liquidity_sweep":
            validateWriterLiquidity(plan, manifest, reobservation);
            break;
        case "deposit":
            validateDeposit(plan, manifest, data, reobservation);
            break;
        case "bid":
            validateBid(plan, manifest, data, reobservation);
            break;
        case "withdraw_principal":
            validatePrincipalWithdrawal(plan, manifest, data, reobservation);
            break;
        case "auction_refund":
            validateAuctionRefund(plan, manifest, data, reobservation);
            break;
        case "close_begin":
            validateCloseBegin(envelope, manifest, data, reobservation);
            break;
        case "close_basket":
            validateCloseBasket(envelope, manifest, data, reobservation);
            break;
        case "close_finalize":
            validateCloseFinalize(envelope, manifest, data, reobservation);
            break;
        case "close_cancel":
            validateCloseCancel(envelope, manifest, data, reobservation);
            break;
        case "settlement_claim_flat":
            validateFlatClaim(plan, manifest, data, reobservation);
            break;
        case "settlement_claim_collective":
            validateCollectiveClaim(plan, manifest, data, reobservation);
            break;
        default: walletError("CURRENT_WALLET_OPERATION_UNSUPPORTED", "writer operation is not supported");
    }
    validateWriterSetup(envelope, manifest, reobservation);
    return instructionsFromBatches(plan.executionInstructionBatches);
}
function validateWriterLiquidity(plan, manifest, reobservation) {
    if (!isCurrentWriterDlmmOperation(plan.operation))
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer liquidity operation is unknown");
    const request = requireWriterDlmmWireBindingV1(plan.operation, plan.semantic, manifestInstruction(manifest));
    const accounts = reobservation.accountInfos;
    const actor = pubkey(request.owner, "writer liquidity actor");
    const sleeve = decodeWalletWriterSleeve(pubkey(request.sleeve, "writer liquidity sleeve"), accounts);
    requireSleeveChildren(sleeve);
    const book = decodeWalletWriterSeriesBook(sleeve.seriesBook, accounts);
    const snapshot = decodeWalletWriterPolicySnapshot(sleeve.policySnapshot, accounts);
    if (!book.sleeve.equals(sleeve.address) || !book.settlementGroup.equals(sleeve.settlementGroup)
        || book.seriesCount !== sleeve.seriesCount || !snapshot.sleeve.equals(sleeve.address)
        || [...snapshot.policyHash].map(byte => byte.toString(16).padStart(2, "0")).join("") !== sleeve.policyHash) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "writer liquidity policy context differs from canonical sleeve");
    }
    const policyAction = request.operation === "writer_liquidity_policy_begin" || request.operation === "writer_liquidity_policy_append" || request.operation === "writer_liquidity_policy_seal";
    const policyAddress = deriveWalletWriterDlmmPolicy(sleeve.address);
    const context = policyAction
        ? [actor, sleeve.vaultConfig, snapshot.registry, sleeve.address, sleeve.settlementGroup, sleeve.seriesBook, sleeve.policySnapshot, policyAddress, SYSTEM_PROGRAM_ID]
        : [actor, sleeve.vaultConfig, sleeve.address, sleeve.settlementGroup, sleeve.seriesBook, sleeve.policySnapshot, policyAddress];
    context.forEach((key, index) => requireAddress(manifest, index, key, "writer liquidity context"));
    if (policyAction) {
        const registry = decodeWalletWriterPolicyRegistry(snapshot.registry, accounts);
        if (!registry.vaultConfig.equals(sleeve.vaultConfig) || sleeve.status !== 1 || sleeve.writerPrincipalAtoms !== 0n
            || sleeve.flatParSupplyAtoms !== 0n || sleeve.accountedAssetAtoms !== 0n || sleeve.lockedPrimaryPremiumAtoms !== 0n
            || sleeve.activeAuction !== null || sleeve.activeCloseRequest !== null) {
            walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer liquidity policy requires canonical pre-capital context");
        }
        if (request.operation === "writer_liquidity_policy_begin") {
            if (!actor.equals(registry.policyAuthority))
                walletError("CURRENT_WALLET_SIGNER_INVALID", "policy begin requires registry authority");
            requireWriterCreateOnlyTarget(accounts, policyAddress, "writer liquidity policy");
            return;
        }
        const policy = decodeWalletWriterDlmmPolicy(policyAddress, accounts);
        if (!policy.policySnapshot.equals(snapshot.address) || policy.seriesCount !== book.seriesCount || policy.sealed) {
            walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer liquidity policy append/seal requires matching incomplete commitment");
        }
        if (request.operation === "writer_liquidity_policy_append") {
            if (!actor.equals(policy.committingPolicyAuthority) || request.startIndex !== policy.appendedSeriesCount
                || request.startIndex + request.entries.length > book.seriesCount)
                walletError("CURRENT_WALLET_PLAN_MISMATCH", "policy append authority or next series differs");
        }
        else if (policy.appendedSeriesCount !== policy.seriesCount || !equalBytes(policy.expectedPolicyHash, policy.rollingPolicyHash)) {
            walletError("CURRENT_WALLET_PLAN_MISMATCH", "policy seal requires the complete expected commitment");
        }
        return;
    }
    if (!("seriesIndex" in request))
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer liquidity series is missing");
    const policy = decodeWalletWriterDlmmPolicy(policyAddress, accounts);
    if (!policy.sealed || !policy.policySnapshot.equals(snapshot.address) || policy.seriesCount !== book.seriesCount) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer liquidity requires its sealed canonical policy");
    }
    const record = book.records[request.seriesIndex];
    if (!record?.active)
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "writer liquidity series is not active in its canonical book");
    const initialize = request.operation === "writer_liquidity_initialize";
    const poolAddress = pubkey(manifest.accounts[initialize ? 7 : 9].address, "writer liquidity pool");
    const pool = decodeCurrentWalletDlmmPool(poolAddress, accounts);
    const positionAddress = deriveWalletWriterDlmmPosition(poolAddress, sleeve.address);
    if (!pool.market.equals(record.market) || !pool.optionMint.equals(record.contractMint)
        || !pool.quoteMint.equals(sleeve.settlementMint) || pool.expiryTs !== sleeve.expiryTs) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "writer liquidity pool differs from selected series");
    }
    const closing = sleeve.activeCloseRequest !== null || [4, 5, 6].includes(sleeve.status);
    const permissionless = request.operation === "writer_liquidity_sweep" || (request.operation === "writer_liquidity_remove" && closing);
    if (!permissionless && !actor.equals(policy.managementAuthority))
        walletError("CURRENT_WALLET_SIGNER_INVALID", "writer liquidity actor is not the frozen manager");
    if (initialize) {
        [poolAddress, positionAddress, record.market, pool.oracleMonth, SYSTEM_PROGRAM_ID].forEach((key, index) => requireAddress(manifest, index + 7, key, "writer position initialization"));
        if ([5, 6, 7].includes(sleeve.status) || [3, 4].includes(pool.status))
            walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer position cannot initialize after terminal lifecycle");
        requireWriterCreateOnlyTarget(accounts, positionAddress, "writer liquidity position");
        return;
    }
    const position = decodeWalletWriterDlmmPosition(positionAddress, accounts);
    if (!position.pool.equals(poolAddress) || !position.sleeve.equals(sleeve.address) || !position.market.equals(record.market)
        || position.seriesIndex !== request.seriesIndex || policy.seriesPoolInventoryAtoms[request.seriesIndex] !== position.optionInventoryAtoms) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "writer liquidity position differs from selected series");
    }
    const poolAuthority = deriveDlmmAuthority(poolAddress);
    const staging = deriveWriterPda("contract_mint_staging_v1", [record.market]);
    const retirement = deriveWriterRetirementCustody(sleeve.address, record.market);
    const expected = [record.market, pool.oracleMonth, poolAddress, poolAuthority, positionAddress, record.contractMint,
        sleeve.settlementMint, pool.optionVault, pool.quoteVault, sleeve.usdcVault, staging, retirement,
        LIGHT_TOKEN_PROGRAM_ID, LIGHT_TOKEN_CPI_AUTHORITY, deriveLightSplInterface(record.contractMint),
        deriveLightSplInterface(sleeve.settlementMint), SPL_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, LIGHT_TOKEN_COMPRESSIBLE_CONFIG, LIGHT_TOKEN_RENT_SPONSOR];
    expected.forEach((key, index) => requireAddress(manifest, index + 7, key, "writer liquidity custody"));
    if (!pool.optionVault.equals(deriveWriterPda("ameba-dlmm-vault-v1", [poolAddress, record.contractMint]))
        || !pool.quoteVault.equals(deriveWriterPda("ameba-dlmm-vault-v1", [poolAddress, sleeve.settlementMint]))) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "writer pool vaults are not canonical Light custody");
    }
    if (sleeve.activeAuction !== null || sleeve.status === 7 || pool.status === 4
        || (request.operation === "writer_liquidity_add" && (closing || sleeve.status !== 3 || pool.status === 3))) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer liquidity action conflicts with current lifecycle");
    }
    requireLightCustody(accounts, pool.optionVault, record.contractMint, poolAuthority, position.optionInventoryAtoms, "writer pool option custody");
    requireLightCustody(accounts, pool.quoteVault, sleeve.settlementMint, poolAuthority, position.allocatedQuoteAtoms + position.uncommittedQuoteAtoms, "writer pool quote custody");
    requireClassicCustody(accounts, sleeve.usdcVault, sleeve.settlementMint, sleeve.address, 0n, "writer sleeve cash");
    requireOptionalWriterClassicCustody(accounts, staging, record.contractMint, record.market, "writer market staging");
    requireOptionalWriterClassicCustody(accounts, retirement, record.contractMint, sleeve.address, "writer retirement custody");
}
function requireWriterCreateOnlyTarget(accounts, address, label) {
    if (!accounts.has(address.toBase58()))
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} was not observed`);
    const info = accounts.get(address.toBase58());
    if (info && (info.executable || !info.owner.equals(SYSTEM_PROGRAM_ID) || info.data.length !== 0)) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} is not an absent or system-owned empty creation target`);
    }
}
function requireOptionalWriterClassicCustody(accounts, address, mint, owner, label) {
    const info = accounts.get(address.toBase58());
    if (!info || info.owner.equals(SYSTEM_PROGRAM_ID))
        requireWriterCreateOnlyTarget(accounts, address, label);
    else
        requireClassicCustody(accounts, address, mint, owner, 0n, label);
}
function validatePrincipalWithdrawal(plan, manifest, data, reobservation) {
    requireFlags(manifest, FLAGS.withdrawPrincipal, "principal withdrawal");
    const amount = BigInt(plan.semantic.amountAtoms);
    requirePayload(data, concat(Uint8Array.of(228), u64Le(amount)), "principal withdrawal");
    const owner = pubkey(plan.semantic.owner, "semantic.owner");
    const sleeve = decodeWalletWriterSleeve(pubkey(plan.semantic.sleeve, "semantic.sleeve"), reobservation.accountInfos);
    requireSleeveChildren(sleeve);
    if (sleeve.status !== 2 || sleeve.activeAuction !== null || sleeve.activeCloseRequest !== null
        || sleeve.lockedPrimaryPremiumAtoms !== 0n || sleeve.exactReserveAtoms !== 0n || sleeve.securityExposureAtoms !== 0n
        || amount <= 0n || amount > sleeve.writerPrincipalAtoms || amount > sleeve.flatParSupplyAtoms || amount > sleeve.accountedAssetAtoms) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "principal withdrawal exceeds unencumbered Funding principal");
    }
    const destination = deriveClassicAta(sleeve.settlementMint, owner);
    const source = deriveLightAta(sleeve.flatMint, owner);
    const expected = [owner, sleeve.vaultConfig, sleeve.address, sleeve.usdcVault, destination, sleeve.settlementMint,
        sleeve.flatMint, source, sleeve.flatBurnCustody, sleeve.flatSplInterface, LIGHT_TOKEN_PROGRAM_ID,
        LIGHT_TOKEN_CPI_AUTHORITY, SPL_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID];
    expected.forEach((key, index) => requireAddress(manifest, index, key, "principal withdrawal account"));
    requireClassicCustody(reobservation.accountInfos, sleeve.usdcVault, sleeve.settlementMint, sleeve.address, amount, "withdrawal custody");
    requireClassicOutput(plan, reobservation, destination, sleeve.settlementMint, owner);
    if (plan.setupMode !== "cold_load")
        requireLightCustody(reobservation.accountInfos, source, sleeve.flatMint, owner, amount, "withdrawal Flat source");
}
function validateAuctionRefund(plan, manifest, data, reobservation) {
    requireFlags(manifest, FLAGS.auctionRefund, "auction refund");
    requirePayload(data, Uint8Array.of(235), "auction refund");
    const actor = pubkey(plan.semantic.owner, "semantic.owner");
    const auction = decodeWalletWriterAuction(pubkey(plan.semantic.auction, "semantic.auction"), reobservation.accountInfos);
    const sleeve = decodeWalletWriterSleeve(auction.sleeve, reobservation.accountInfos);
    const bid = decodeWalletWriterBid(pubkey(plan.semantic.bid, "semantic.bid"), reobservation.accountInfos);
    const index = decodeWalletWriterBidIndex(auction.bidIndex, reobservation.accountInfos);
    const summary = index.records.find(row => row.occupied && row.bid.equals(bid.address));
    if (!bid.auction.equals(auction.address) || !index.auction.equals(auction.address) || !summary
        || !summary.bidder.equals(bid.bidder) || summary.orderId !== bid.orderId || auction.auctionNonce > sleeve.auctionNonce
        || bid.refundableAtoms <= 0n || !auction.escrow.equals(deriveWriterPda("writer_auction_escrow_v1", [auction.address]))) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "refund identity or refundable balance is invalid");
    }
    const early = summary.status === 1 && auction.status === 1 && reobservation.observedBlockTimeUnixSeconds <= auction.bidDeadlineTs;
    if (early ? (!actor.equals(bid.bidder) || !sleeve.activeAuction?.equals(auction.address))
        : (![2, 5].includes(summary.status) && ![5, 6].includes(auction.status)))
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "auction refund phase/actor does not permit this refund");
    const expected = [actor, sleeve.address, auction.address, index.address, bid.address, auction.escrow,
        bid.refundTokenAccount, sleeve.settlementMint, SPL_TOKEN_PROGRAM_ID];
    expected.forEach((key, offset) => requireAddress(manifest, offset, key, "auction refund account"));
    requireClassicCustody(reobservation.accountInfos, auction.escrow, sleeve.settlementMint, auction.address, bid.refundableAtoms, "refund escrow");
    requireClassicOutput(plan, reobservation, bid.refundTokenAccount, sleeve.settlementMint, bid.bidder);
}
function requireClassicOutput(plan, reobservation, address, mint, owner) {
    const facts = plan.classicOutputFacts;
    if (!facts) {
        const info = reobservation.accountInfos.get(address.toBase58());
        if (!info || info.executable || !info.owner.equals(SPL_TOKEN_PROGRAM_ID) || info.data.length !== 165
            || info.data[108] !== 1 || readU32Le(info.data, 109) !== 0
            || !new PublicKey(info.data.subarray(0, 32)).equals(mint) || !new PublicKey(info.data.subarray(32, 64)).equals(owner)) {
            walletError("CURRENT_WALLET_ACCOUNT_INVALID", "classic output identity/state is invalid");
        }
        return;
    }
    if (facts.ata !== address.toBase58() || facts.owner !== owner.toBase58() || facts.mint !== mint.toBase58()
        || facts.payer !== plan.semantic.owner || !deriveClassicAta(mint, owner).equals(address))
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "classic output creation changes the native destination");
    const info = reobservation.accountInfos.get(address.toBase58());
    if (info === undefined || (info !== null && (info.executable || !info.owner.equals(SYSTEM_PROGRAM_ID) || info.data.length !== 0))) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "classic output prerequisite is no longer absent/system-empty");
    }
}
function validateDeposit(plan, manifest, data, reobservation) {
    requireFlags(manifest, FLAGS.deposit, "writer deposit");
    requirePayload(data, concat(Uint8Array.of(227), u64Le(BigInt(plan.semantic.principalAtoms))), "writer deposit");
    const owner = pubkey(plan.semantic.owner, "semantic.owner");
    const sleeveAddress = pubkey(plan.semantic.sleeve, "semantic.sleeve");
    const sleeve = decodeWalletWriterSleeve(sleeveAddress, reobservation.accountInfos);
    requireSleeveChildren(sleeve);
    requireAddress(manifest, 0, owner, "deposit owner");
    requireAddress(manifest, 1, sleeve.vaultConfig, "deposit VaultConfig");
    requireAddress(manifest, 2, sleeveAddress, "deposit sleeve");
    requireAddress(manifest, 3, sleeve.policySnapshot, "deposit policy");
    requireAddress(manifest, 4, sleeve.usdcVault, "deposit sleeve vault");
    const source = deriveClassicAta(sleeve.settlementMint, owner);
    requireAddress(manifest, 5, source, "deposit USDC source");
    requireClassicCustody(reobservation.accountInfos, source, sleeve.settlementMint, owner, BigInt(plan.semantic.principalAtoms), "deposit USDC source");
    requireAddress(manifest, 6, sleeve.settlementMint, "deposit settlement mint");
    requireAddress(manifest, 7, deriveWriterFlatMint(sleeveAddress), "deposit Flat mint");
    requireAddress(manifest, 8, sleeve.flatStaging, "deposit Flat staging");
    requireAddress(manifest, 9, deriveLightAta(sleeve.flatMint, owner), "deposit Flat destination");
    requireWriterLightConstants(manifest, 10, 11, 12, 13, 14, 15, 16, sleeve.flatSplInterface);
    const policyAddress = deriveWalletWriterDlmmPolicy(sleeveAddress);
    requireAddress(manifest, 17, policyAddress, "deposit writer liquidity policy");
    const policy = decodeWalletWriterDlmmPolicy(policyAddress, reobservation.accountInfos);
    if (!policy.sealed || !policy.policySnapshot.equals(sleeve.policySnapshot)
        || policy.totalPoolQuoteAtoms !== 0n || policy.totalUncommittedQuoteAtoms !== 0n
        || policy.seriesPoolInventoryAtoms.some(amount => amount !== 0n)) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "deposit requires its sealed policy before any writer pool custody");
    }
}
function validateBid(plan, manifest, data, reobservation) {
    requireFlags(manifest, FLAGS.bid, "writer bid");
    if (data.length !== 27 || data[0] !== 234 || data[10] !== 0
        || data[9] !== plan.semantic.seriesIndex
        || readU64Le(data, 11).toString() !== plan.semantic.pricePerContractAtoms
        || readU64Le(data, 19).toString() !== plan.semantic.quantityAtoms) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer bid bytes differ from displayed semantics");
    }
    const owner = pubkey(plan.semantic.owner, "semantic.owner");
    const auctionAddress = pubkey(plan.semantic.auction, "semantic.auction");
    const auction = decodeWalletWriterAuction(auctionAddress, reobservation.accountInfos);
    const sleeve = decodeWalletWriterSleeve(auction.sleeve, reobservation.accountInfos);
    requireSleeveChildren(sleeve);
    const book = decodeWalletWriterSeriesBook(auction.seriesBook, reobservation.accountInfos);
    const bidIndex = decodeWalletWriterBidIndex(auction.bidIndex, reobservation.accountInfos);
    const seriesIndex = plan.semantic.seriesIndex;
    const record = requireSeries(book, seriesIndex);
    const orderId = readU64Le(data, 1);
    if (!book.sleeve.equals(sleeve.address) || !book.settlementGroup.equals(sleeve.settlementGroup)
        || book.seriesCount !== sleeve.seriesCount || !bidIndex.auction.equals(auction.address)
        || orderId !== BigInt(bidIndex.bidCount) + 1n) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer bid parent identities or order id differ from finalized state");
    }
    requireAddress(manifest, 0, owner, "bid owner");
    requireAddress(manifest, 1, sleeve.address, "bid sleeve");
    requireAddress(manifest, 2, auctionAddress, "bid auction");
    requireAddress(manifest, 3, bidIndex.address, "bid index");
    requireAddress(manifest, 4, deriveWriterBid(auctionAddress, owner, orderId), "bid PDA");
    requireAddress(manifest, 5, book.address, "bid series book");
    requireAddress(manifest, 6, auction.policySnapshot, "bid policy");
    const source = deriveClassicAta(sleeve.settlementMint, owner);
    requireAddress(manifest, 7, source, "bid USDC source");
    requireClassicCustody(reobservation.accountInfos, source, sleeve.settlementMint, owner, 0n, "bid USDC source");
    requireAddress(manifest, 8, auction.escrow, "bid escrow");
    requireAddress(manifest, 9, sleeve.settlementMint, "bid settlement mint");
    requireAddress(manifest, 10, deriveLightAta(record.contractMint, owner), "bid claim destination");
    requireAddress(manifest, 11, SPL_TOKEN_PROGRAM_ID, "bid token program");
    requireAddress(manifest, 12, SYSTEM_PROGRAM_ID, "bid system program");
    requireAddress(manifest, 13, record.market, "bid market");
    requireAddress(manifest, 14, record.contractMint, "bid contract mint");
    requireAddress(manifest, 15, deriveCollectiveSettlementDelegatePda(owner, record.contractMint, CURRENT_PROGRAM_ID)[0], "bid settlement authority");
    requireAddress(manifest, 16, LIGHT_TOKEN_PROGRAM_ID, "bid Light program");
    requireAddress(manifest, 17, LIGHT_TOKEN_COMPRESSIBLE_CONFIG, "bid Light config");
    requireAddress(manifest, 18, LIGHT_TOKEN_RENT_SPONSOR, "bid rent sponsor");
}
function validateCloseBegin(envelope, manifest, data, reobservation) {
    const plan = envelope.operationPlan;
    requireFlags(manifest, FLAGS.closeBegin, "writer close begin");
    const expectedDeadline = BigInt(plan.currentObservation.observedBlockTimeUnixSeconds) + 120n;
    requirePayload(data, concat(Uint8Array.of(240), u64Le(BigInt(plan.semantic.flatParAtoms)), u64Le(BigInt(plan.semantic.minimumWithdrawalAtoms)), u64Le(expectedDeadline)), "writer close begin");
    const owner = pubkey(plan.semantic.owner, "semantic.owner");
    const sleeveAddress = pubkey(plan.semantic.sleeve, "semantic.sleeve");
    const sleeve = decodeWalletWriterSleeve(sleeveAddress, reobservation.accountInfos);
    requireSleeveChildren(sleeve);
    const book = decodeWalletWriterSeriesBook(sleeve.seriesBook, reobservation.accountInfos);
    const closeRequest = deriveWriterCloseRequest(sleeveAddress, sleeve.closeNonce + 1n);
    if (!book.sleeve.equals(sleeve.address) || !book.settlementGroup.equals(sleeve.settlementGroup)
        || book.seriesCount !== sleeve.seriesCount
        || sleeve.status !== 3 || sleeve.activeAuction !== null || sleeve.activeCloseRequest !== null
        || envelope.closeRequest !== closeRequest.toBase58() || expectedDeadline >= sleeve.expiryTs) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "close request or deadline differs from finalized sleeve state");
    }
    requireCloseBeginAdmission(envelope, sleeve, book);
    requireAddress(manifest, 0, owner, "close owner");
    requireAddress(manifest, 1, sleeve.vaultConfig, "close VaultConfig");
    requireAddress(manifest, 2, sleeveAddress, "close sleeve");
    requireAddress(manifest, 3, sleeve.settlementGroup, "close group");
    requireAddress(manifest, 4, sleeve.seriesBook, "close book");
    requireAddress(manifest, 5, sleeve.policySnapshot, "close policy");
    requireAddress(manifest, 6, closeRequest, "close request");
    requireAddress(manifest, 7, sleeve.flatMint, "close Flat mint");
    requireAddress(manifest, 8, deriveLightAta(sleeve.flatMint, owner), "close Flat source");
    requireAddress(manifest, 9, deriveWriterCloseFlatEscrow(closeRequest), "close Flat escrow");
    requireAddress(manifest, 10, sleeve.flatSplInterface, "close Flat interface");
    requireAddress(manifest, 11, LIGHT_TOKEN_PROGRAM_ID, "close Light program");
    requireAddress(manifest, 12, LIGHT_TOKEN_CPI_AUTHORITY, "close Light authority");
    requireAddress(manifest, 13, SPL_TOKEN_PROGRAM_ID, "close token program");
    requireAddress(manifest, 14, SYSTEM_PROGRAM_ID, "close system program");
    if (plan.setupMode === "none") {
        requireLightCustody(reobservation.accountInfos, deriveLightAta(sleeve.flatMint, owner), sleeve.flatMint, owner, BigInt(plan.semantic.flatParAtoms), "close Flat source");
    }
}
function validateCloseBasket(envelope, manifest, data, reobservation) {
    requireFlags(manifest, FLAGS.closeBasket, "writer close basket");
    const stageIndex = requireStage(envelope, "deposit_basket");
    requirePayload(data, Uint8Array.of(241, stageIndex), "writer close basket");
    const actor = pubkey(envelope.operationPlan.semantic.owner, "semantic.owner");
    const requestAddress = pubkey(envelope.operationPlan.semantic.closeRequest, "semantic.closeRequest");
    const request = decodeWalletWriterCloseRequest(requestAddress, reobservation.accountInfos);
    if (!actor.equals(request.owner)) {
        walletError("CURRENT_WALLET_SIGNER_INVALID", "forward close basket actor must be the request owner");
    }
    const sleeve = decodeWalletWriterSleeve(request.sleeve, reobservation.accountInfos);
    const book = decodeWalletWriterSeriesBook(sleeve.seriesBook, reobservation.accountInfos);
    requireCloseAdmissionState(envelope, request, sleeve, book, reobservation);
    const record = requireSeries(book, stageIndex);
    requireAddress(manifest, 0, actor, "close basket owner");
    requireAddress(manifest, 1, sleeve.address, "close basket sleeve");
    requireAddress(manifest, 2, book.address, "close basket book");
    requireAddress(manifest, 3, requestAddress, "close basket request");
    requireAddress(manifest, 4, record.market, "close basket market");
    requireAddress(manifest, 5, record.contractMint, "close basket mint");
    requireAddress(manifest, 6, deriveLightAta(record.contractMint, request.owner), "close basket source");
    requireAddress(manifest, 7, deriveWriterRetirementCustody(sleeve.address, record.market), "close basket custody");
    requireAddress(manifest, 8, deriveLightSplInterface(record.contractMint), "close basket interface");
    requireAddress(manifest, 9, LIGHT_TOKEN_PROGRAM_ID, "close basket Light program");
    requireAddress(manifest, 10, LIGHT_TOKEN_CPI_AUTHORITY, "close basket Light authority");
    requireAddress(manifest, 11, SPL_TOKEN_PROGRAM_ID, "close basket token program");
    requireAddress(manifest, 12, SYSTEM_PROGRAM_ID, "close basket system program");
    if (envelope.operationPlan.setupMode === "none") {
        requireLightCustody(reobservation.accountInfos, deriveLightAta(record.contractMint, request.owner), record.contractMint, request.owner, request.requiredClaimAtoms[stageIndex], "close basket source");
    }
}
function validateCloseFinalize(envelope, manifest, data, reobservation) {
    requireStage(envelope, "finalize");
    const actor = pubkey(envelope.operationPlan.semantic.owner, "semantic.owner");
    const requestAddress = pubkey(envelope.operationPlan.semantic.closeRequest, "semantic.closeRequest");
    const request = decodeWalletWriterCloseRequest(requestAddress, reobservation.accountInfos);
    if (!actor.equals(request.owner)) {
        walletError("CURRENT_WALLET_SIGNER_INVALID", "forward close finalize actor must be the request owner");
    }
    const sleeve = decodeWalletWriterSleeve(request.sleeve, reobservation.accountInfos);
    const book = decodeWalletWriterSeriesBook(sleeve.seriesBook, reobservation.accountInfos);
    requireCloseAdmissionState(envelope, request, sleeve, book, reobservation);
    const flags = [RS, R, W0, R, W0, R, W0, W0, W0, R, W0, W0, R, R,
        ...book.records.flatMap(() => [W0, W0, W0])];
    requireFlags(manifest, flags, "writer close finalize");
    requirePayload(data, Uint8Array.of(242), "writer close finalize");
    requireAddress(manifest, 0, actor, "close finalize owner");
    requireAddress(manifest, 1, sleeve.vaultConfig, "close finalize VaultConfig");
    requireAddress(manifest, 2, sleeve.address, "close finalize sleeve");
    requireAddress(manifest, 3, sleeve.settlementGroup, "close finalize group");
    requireAddress(manifest, 4, book.address, "close finalize book");
    requireAddress(manifest, 5, sleeve.policySnapshot, "close finalize policy");
    requireAddress(manifest, 6, requestAddress, "close finalize request");
    requireAddress(manifest, 7, sleeve.usdcVault, "close finalize vault");
    requireAddress(manifest, 8, deriveClassicAta(sleeve.settlementMint, request.owner), "close finalize destination");
    requireAddress(manifest, 9, sleeve.settlementMint, "close finalize mint");
    requireAddress(manifest, 10, sleeve.flatMint, "close finalize Flat mint");
    requireAddress(manifest, 11, request.flatEscrow, "close finalize escrow");
    requireAddress(manifest, 12, SPL_TOKEN_PROGRAM_ID, "close finalize token program");
    const lpPolicyAddress = deriveWalletWriterDlmmPolicy(sleeve.address);
    requireAddress(manifest, 13, lpPolicyAddress, "close finalize writer liquidity policy");
    const lpPolicyInfo = reobservation.accountInfos.get(lpPolicyAddress.toBase58());
    if (!lpPolicyInfo || lpPolicyInfo.owner.equals(SYSTEM_PROGRAM_ID))
        requireWriterCreateOnlyTarget(reobservation.accountInfos, lpPolicyAddress, "historical writer policy");
    else {
        const policy = decodeWalletWriterDlmmPolicy(lpPolicyAddress, reobservation.accountInfos);
        if (!policy.sealed || !policy.policySnapshot.equals(sleeve.policySnapshot) || policy.totalPoolQuoteAtoms !== 0n
            || policy.seriesPoolInventoryAtoms.some(amount => amount !== 0n))
            walletError("CURRENT_WALLET_ACCOUNT_INVALID", "close finalize requires writer pool custody to be unwound");
    }
    requireClassicOutput(envelope.operationPlan, reobservation, deriveClassicAta(sleeve.settlementMint, request.owner), sleeve.settlementMint, request.owner);
    book.records.forEach((_record, index) => {
        const record = requireSeries(book, index);
        requireAddress(manifest, 14 + index * 3, record.market, `close finalize market ${index}`);
        requireAddress(manifest, 15 + index * 3, record.contractMint, `close finalize mint ${index}`);
        requireAddress(manifest, 16 + index * 3, record.retirementCustody, `close finalize retirement custody ${index}`);
    });
}
function validateCloseCancel(envelope, manifest, data, reobservation) {
    const actor = pubkey(envelope.operationPlan.semantic.owner, "semantic.owner");
    const requestAddress = pubkey(envelope.operationPlan.semantic.closeRequest, "semantic.closeRequest");
    const request = decodeWalletWriterCloseRequest(requestAddress, reobservation.accountInfos);
    const sleeve = decodeWalletWriterSleeve(request.sleeve, reobservation.accountInfos);
    const book = decodeWalletWriterSeriesBook(sleeve.seriesBook, reobservation.accountInfos);
    requireCloseAdmissionState(envelope, request, sleeve, book, reobservation);
    const stageOperation = envelope.stage?.operation;
    if (stageOperation === "cancel_series") {
        const seriesIndex = requireStage(envelope, "cancel_series");
        requireFlags(manifest, FLAGS.closeCancelSeries, "writer series cancellation");
        requirePayload(data, Uint8Array.of(243, seriesIndex), "writer series cancellation");
        const record = requireSeries(book, seriesIndex);
        requireAddress(manifest, 0, actor, "cancel actor");
        requireAddress(manifest, 1, sleeve.address, "cancel sleeve");
        requireAddress(manifest, 2, book.address, "cancel book");
        requireAddress(manifest, 3, requestAddress, "cancel request");
        requireAddress(manifest, 4, record.market, "cancel market");
        requireAddress(manifest, 5, record.contractMint, "cancel mint");
        requireAddress(manifest, 6, record.retirementCustody, "cancel custody");
        requireAddress(manifest, 7, deriveLightAta(record.contractMint, request.owner), "cancel destination");
        requireAddress(manifest, 8, deriveLightSplInterface(record.contractMint), "cancel interface");
        requireAddress(manifest, 9, LIGHT_TOKEN_PROGRAM_ID, "cancel Light program");
        requireAddress(manifest, 10, LIGHT_TOKEN_CPI_AUTHORITY, "cancel Light authority");
        requireAddress(manifest, 11, SPL_TOKEN_PROGRAM_ID, "cancel token program");
        requireAddress(manifest, 12, SYSTEM_PROGRAM_ID, "cancel system program");
    }
    else {
        requireStage(envelope, "cancel_flat");
        requireFlags(manifest, FLAGS.closeCancelFlat, "writer Flat cancellation");
        requirePayload(data, Uint8Array.of(243, 255), "writer Flat cancellation");
        requireAddress(manifest, 0, actor, "cancel actor");
        requireAddress(manifest, 1, sleeve.address, "cancel sleeve");
        requireAddress(manifest, 2, requestAddress, "cancel request");
        requireAddress(manifest, 3, sleeve.flatMint, "cancel Flat mint");
        requireAddress(manifest, 4, request.flatEscrow, "cancel Flat escrow");
        requireAddress(manifest, 5, deriveLightAta(sleeve.flatMint, request.owner), "cancel Flat destination");
        requireAddress(manifest, 6, sleeve.flatSplInterface, "cancel Flat interface");
        requireAddress(manifest, 7, LIGHT_TOKEN_PROGRAM_ID, "cancel Light program");
        requireAddress(manifest, 8, LIGHT_TOKEN_CPI_AUTHORITY, "cancel Light authority");
        requireAddress(manifest, 9, SPL_TOKEN_PROGRAM_ID, "cancel token program");
        requireAddress(manifest, 10, SYSTEM_PROGRAM_ID, "cancel system program");
    }
}
function validateCollectiveClaim(plan, manifest, data, reobservation) {
    requireFlags(manifest, FLAGS.claimCollective, "collective claim");
    requirePayload(data, concat(Uint8Array.of(246), u64Le(BigInt(plan.semantic.amountAtoms))), "collective claim");
    const owner = pubkey(plan.semantic.owner, "semantic.owner");
    const sleeve = decodeWalletWriterSleeve(pubkey(plan.semantic.sleeve, "semantic.sleeve"), reobservation.accountInfos);
    requireSleeveChildren(sleeve);
    const book = decodeWalletWriterSeriesBook(sleeve.seriesBook, reobservation.accountInfos);
    const witness = decodeBase64(plan.raw.collectiveClaimSeriesBookBase64, "series-book witness", 8_312);
    const fresh = reobservation.accountInfos.get(sleeve.seriesBook.toBase58());
    const record = requireSeries(book, plan.semantic.seriesIndex);
    if (fresh == null || !equalBytes(witness, fresh.data) || !book.sleeve.equals(sleeve.address)
        || !book.settlementGroup.equals(sleeve.settlementGroup)
        || book.records.filter((entry) => entry.market.equals(record.market)).length !== 1) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "collective claim witness or selector differs from fresh book");
    }
    const expected = [owner, sleeve.vaultConfig, sleeve.address, sleeve.settlementGroup, sleeve.seriesBook,
        record.market, record.contractMint, deriveLightAta(record.contractMint, owner), record.retirementCustody,
        deriveLightSplInterface(record.contractMint), sleeve.usdcVault, deriveLightAta(sleeve.settlementMint, owner),
        sleeve.settlementMint, deriveLightSplInterface(sleeve.settlementMint), LIGHT_TOKEN_PROGRAM_ID,
        LIGHT_TOKEN_CPI_AUTHORITY, SPL_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
        LIGHT_TOKEN_RENT_SPONSOR];
    expected.forEach((address, index) => requireAddress(manifest, index, address, "collective claim account"));
    if (plan.setupMode !== "cold_load")
        requireLightCustody(reobservation.accountInfos, expected[7], record.contractMint, owner, BigInt(plan.semantic.amountAtoms), "collective claim source");
    requireNativeCreatedLightOutput(reobservation, expected[11], sleeve.settlementMint, owner);
}
function validateFlatClaim(plan, manifest, data, reobservation) {
    requireFlags(manifest, FLAGS.claimFlat, "Flat residual claim");
    requirePayload(data, concat(Uint8Array.of(247), u64Le(BigInt(plan.semantic.amountAtoms))), "Flat residual claim");
    const owner = pubkey(plan.semantic.owner, "semantic.owner");
    const sleeve = decodeWalletWriterSleeve(pubkey(plan.semantic.sleeve, "semantic.sleeve"), reobservation.accountInfos);
    requireSleeveChildren(sleeve);
    requireAddress(manifest, 0, owner, "Flat claim owner");
    requireAddress(manifest, 1, sleeve.vaultConfig, "Flat claim VaultConfig");
    requireAddress(manifest, 2, sleeve.address, "Flat claim sleeve");
    requireAddress(manifest, 3, sleeve.flatMint, "Flat claim mint");
    requireAddress(manifest, 4, deriveLightAta(sleeve.flatMint, owner), "Flat claim source");
    requireAddress(manifest, 5, sleeve.flatBurnCustody, "Flat claim burn custody");
    requireAddress(manifest, 6, sleeve.flatSplInterface, "Flat claim interface");
    requireAddress(manifest, 7, sleeve.usdcVault, "Flat claim vault");
    requireAddress(manifest, 8, deriveLightAta(sleeve.settlementMint, owner), "Flat claim USDC destination");
    requireAddress(manifest, 9, sleeve.settlementMint, "Flat claim settlement mint");
    requireAddress(manifest, 10, deriveLightSplInterface(sleeve.settlementMint), "Flat claim USDC interface");
    requireAddress(manifest, 11, LIGHT_TOKEN_PROGRAM_ID, "Flat claim Light program");
    requireAddress(manifest, 12, LIGHT_TOKEN_CPI_AUTHORITY, "Flat claim Light authority");
    requireAddress(manifest, 13, SPL_TOKEN_PROGRAM_ID, "Flat claim token program");
    requireAddress(manifest, 14, SYSTEM_PROGRAM_ID, "Flat claim system program");
    requireAddress(manifest, 15, LIGHT_TOKEN_COMPRESSIBLE_CONFIG, "Flat claim Light config");
    requireAddress(manifest, 16, LIGHT_TOKEN_RENT_SPONSOR, "Flat claim rent sponsor");
    if (plan.setupMode !== "cold_load")
        requireLightCustody(reobservation.accountInfos, deriveLightAta(sleeve.flatMint, owner), sleeve.flatMint, owner, BigInt(plan.semantic.amountAtoms), "Flat claim source");
    requireNativeCreatedLightOutput(reobservation, deriveLightAta(sleeve.settlementMint, owner), sleeve.settlementMint, owner);
}
function requireNativeCreatedLightOutput(reobservation, address, mint, owner) {
    if (!deriveLightAta(mint, owner).equals(address) || !reobservation.accountInfos.has(address.toBase58())) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "native Light output identity or observation missing");
    }
    const info = reobservation.accountInfos.get(address.toBase58());
    if (info === null || (info !== undefined && info.owner.equals(SYSTEM_PROGRAM_ID) && !info.executable && info.data.length === 0))
        return;
    requireLightCustody(reobservation.accountInfos, address, mint, owner, 0n, "native Light settlement destination");
}
function validateWriterSetup(envelope, actionManifest, reobservation) {
    const plan = envelope.operationPlan;
    if (plan.setupMode === "none")
        return;
    const owner = pubkey(plan.semantic.owner, "semantic.owner");
    let setupBatches = plan.executionInstructionBatches.map((batch, index) => index === plan.actionBatchIndex ? batch.slice(0, batch.length - 1) : batch);
    if (plan.setupMode === "writer_liquidity_compute") {
        if (!isCurrentWriterDlmmOperation(plan.operation) || setupBatches.length !== 1 || setupBatches[0].length !== 2
            || plan.setupSignerRoles.length !== 0 || plan.actionBatchIndex !== 0 || plan.coldProofFacts !== null
            || plan.canonicalOutputFacts !== null || plan.classicOutputFacts)
            walletError("CURRENT_WALLET_PLAN_INVALID", "writer liquidity compute grouping differs");
        const expected = currentWriterDlmmComputeInstructions();
        setupBatches[0].forEach((manifest, index) => {
            if (manifest.instructionName !== CURRENT_WRITER_DLMM_TRANSPORT_V1.setupInstructionNames[index])
                walletError("CURRENT_WALLET_PLAN_INVALID", "writer liquidity compute name differs");
            requireExactInstruction(manifestInstruction(manifest), expected[index], "writer liquidity candidate compute");
        });
        return;
    }
    if (plan.classicOutputFacts) {
        const facts = plan.classicOutputFacts;
        const payer = pubkey(facts.payer, "classic output payer");
        const outputOwner = pubkey(facts.owner, "classic output owner");
        const mint = pubkey(facts.mint, "classic output mint");
        const ata = pubkey(facts.ata, "classic output ATA");
        if (!payer.equals(owner) || !deriveClassicAta(mint, outputOwner).equals(ata))
            walletError("CURRENT_WALLET_PLAN_INVALID", "classic output facts are noncanonical");
        const expected = new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, data: Buffer.from([1]), keys: [
                { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true },
                { pubkey: outputOwner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
                { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false }, { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ] });
        const finalBatch = setupBatches[setupBatches.length - 1];
        if (finalBatch.length < 2)
            walletError("CURRENT_WALLET_PLAN_INVALID", "classic output setup is missing");
        requireExactInstruction(manifestInstruction(finalBatch[finalBatch.length - 1]), expected, "classic ATA output creation");
        setupBatches = setupBatches.map((batch, index) => index === setupBatches.length - 1 ? batch.slice(0, -1) : batch);
        if (plan.setupMode === "classic_output_create") {
            if (setupBatches.length !== 1 || setupBatches[0].length !== 1)
                walletError("CURRENT_WALLET_PLAN_INVALID", "classic output setup has extra instructions");
            const compute = manifestInstruction(setupBatches[0][0]);
            requireCanonicalComputeBudget(compute);
            if (readU32Le(compute.data, 1) !== 600_000)
                walletError("CURRENT_WALLET_PLAN_INVALID", "classic output compute bound mismatch");
            return;
        }
    }
    if (plan.setupMode === "cold_load") {
        const facts = plan.coldProofFacts;
        const target = pubkey(facts.ata, "coldAccountProofFacts.ata");
        const proofOwner = pubkey(facts.owner, "coldAccountProofFacts.owner");
        const mint = pubkey(facts.mint, "coldAccountProofFacts.mint");
        const payer = pubkey(facts.payer, "coldAccountProofFacts.payer");
        if (!payer.equals(owner) || !deriveLightAta(mint, proofOwner).equals(target)
            || BigInt(facts.amountAtoms) < BigInt(facts.minimumAmountAtoms)) {
            walletError("CURRENT_WALLET_PLAN_INVALID", "writer cold proof facts do not bind owner, mint, payer, and amount");
        }
        const expectedTargetIndex = ["withdraw_principal", "settlement_claim_collective"].includes(plan.operation) ? 7 : plan.operation === "settlement_claim_flat" ? 4 : plan.operation === "close_begin" ? 8 : plan.operation === "close_basket" ? 6 : -1;
        const expectedMintIndex = ["withdraw_principal", "settlement_claim_collective"].includes(plan.operation) ? 6 : plan.operation === "settlement_claim_flat" ? 3 : plan.operation === "close_begin" ? 7 : plan.operation === "close_basket" ? 5 : -1;
        if (expectedTargetIndex < 0
            || actionManifest.accounts[expectedTargetIndex]?.address !== target.toBase58()
            || actionManifest.accounts[expectedMintIndex]?.address !== mint.toBase58()) {
            walletError("CURRENT_WALLET_PLAN_INVALID", "writer cold proof does not bind the action input");
        }
        const exactMinimum = ["withdraw_principal", "settlement_claim_collective", "settlement_claim_flat"].includes(plan.operation) ? BigInt(plan.semantic.amountAtoms) : plan.operation === "close_begin"
            ? BigInt(plan.semantic.flatParAtoms)
            : (() => {
                const request = decodeWalletWriterCloseRequest(pubkey(plan.semantic.closeRequest, "semantic.closeRequest"), reobservation.accountInfos);
                const seriesIndex = requireStage(envelope, "deposit_basket");
                return request.requiredClaimAtoms[seriesIndex] ?? -1n;
            })();
        if (BigInt(facts.minimumAmountAtoms) !== exactMinimum) {
            walletError("CURRENT_WALLET_PLAN_INVALID", "writer cold minimum differs from finalized close semantics");
        }
        const nativeSetupBatches = setupBatches.map((batch) => batch.map(manifestInstruction));
        nativeSetupBatches.forEach((batch) => requireCanonicalSetupBatch({
            batch, payer, owner: proofOwner, mint, target, requireCreate: true,
        }));
        validateCurrentWalletLightTransfer2LoadSequence(nativeSetupBatches.map((batch) => batch[2]), { payer, owner: proofOwner, mint, destination: target, amountAtoms: BigInt(facts.amountAtoms) });
        return;
    }
    const facts = plan.canonicalOutputFacts;
    const target = pubkey(facts.ata, "canonicalOutputSetupFacts.ata");
    const outputOwner = pubkey(facts.owner, "canonicalOutputSetupFacts.owner");
    const mint = pubkey(facts.mint, "canonicalOutputSetupFacts.mint");
    const payer = pubkey(facts.payer, "canonicalOutputSetupFacts.payer");
    if (!payer.equals(owner) || !deriveLightAta(mint, outputOwner).equals(target)
        || setupBatches.length !== 1 || setupBatches[0].length !== 2) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "canonical output setup facts or grouping is invalid");
    }
    const request = decodeWalletWriterCloseRequest(pubkey(plan.semantic.closeRequest, "semantic.closeRequest"), reobservation.accountInfos);
    const targetIndex = envelope.stage?.operation === "cancel_series" ? 7 : 5;
    const mintIndex = envelope.stage?.operation === "cancel_series" ? 5 : 3;
    if (!outputOwner.equals(request.owner)
        || actionManifest.accounts[targetIndex]?.address !== target.toBase58()
        || actionManifest.accounts[mintIndex]?.address !== mint.toBase58()) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "canonical output facts do not bind the close-request owner and action");
    }
    const instructions = setupBatches[0].map(manifestInstruction);
    requireCanonicalComputeBudget(instructions[0]);
    if (readU32Le(instructions[0].data, 1) !== 600_000) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "canonical output setup requires exactly 600000 compute units");
    }
    requireExactInstruction(instructions[1], buildCreateLightAta(payer, outputOwner, mint), "canonical output create");
}
function validateFlat(plan, reobservation) {
    const owner = pubkey(plan.semantic.owner, "semantic.owner");
    const destinationOwner = pubkey(plan.semantic.destinationOwner, "semantic.destinationOwner");
    const sleeve = pubkey(plan.semantic.sleeve, "semantic.sleeve");
    const mint = deriveWriterFlatMint(sleeve);
    const source = deriveLightAta(mint, owner);
    const destination = deriveLightAta(mint, destinationOwner);
    const observed = plan.observedBytes;
    const mintData = decodeBase64(observed.mintDataBase64, "observedBytes.mintDataBase64", 82);
    requireAccountBytes(reobservation.accountInfos, mint, SPL_TOKEN_PROGRAM_ID, mintData, "Flat mint");
    const decimals = decodeMintDecimals(mintData);
    const sourceData = observed.sourceLightDataBase64 === null ? null
        : decodeBase64(observed.sourceLightDataBase64, "observedBytes.sourceLightDataBase64", 272);
    const destinationData = observed.destinationLightDataBase64 === null ? null
        : decodeBase64(observed.destinationLightDataBase64, "observedBytes.destinationLightDataBase64", 272);
    if (plan.sourceState === "hot") {
        if (sourceData === null)
            walletError("CURRENT_WALLET_PLAN_INVALID", "hot Flat source bytes are absent");
        requireAccountBytes(reobservation.accountInfos, source, LIGHT_TOKEN_PROGRAM_ID, sourceData, "Flat source");
        const state = decodeLightToken(sourceData, "Flat source");
        if (!state.mint.equals(mint) || !state.owner.equals(owner)
            || state.amount < BigInt(plan.semantic.amountAtoms)) {
            walletError("CURRENT_WALLET_PLAN_INVALID", "Flat source identity or balance differs from semantics");
        }
    }
    else if (sourceData !== null || reobservation.accountInfos.get(source.toBase58()) !== null) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "cold Flat source is not absent from hot finalized state");
    }
    if (plan.destinationState === "hot") {
        if (destinationData === null)
            walletError("CURRENT_WALLET_PLAN_INVALID", "hot Flat destination bytes are absent");
        requireAccountBytes(reobservation.accountInfos, destination, LIGHT_TOKEN_PROGRAM_ID, destinationData, "Flat destination");
        const state = decodeLightToken(destinationData, "Flat destination");
        if (!state.mint.equals(mint) || !state.owner.equals(destinationOwner)) {
            walletError("CURRENT_WALLET_PLAN_INVALID", "Flat destination identity differs from semantics");
        }
    }
    else if (destinationData !== null || reobservation.accountInfos.get(destination.toBase58()) !== null) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "non-hot Flat destination is not absent from finalized state");
    }
    const expectedAction = [];
    if (plan.destinationState === "absent")
        expectedAction.push(buildCreateLightAta(owner, destinationOwner, mint));
    expectedAction.push(buildLightTransfer(source, mint, destination, owner, BigInt(plan.semantic.amountAtoms), decimals));
    if (plan.instructions.length !== expectedAction.length) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "Flat action instruction count differs from native reconstruction");
    }
    plan.instructions.forEach((manifest, index) => requireExactInstruction(manifestInstruction(manifest), expectedAction[index], `Flat action ${index}`));
    if (plan.setupMode === "cold_load") {
        const facts = plan.coldProofFacts;
        const target = pubkey(facts.ata, "Flat cold ata");
        const proofOwner = pubkey(facts.owner, "Flat cold owner");
        const proofMint = pubkey(facts.mint, "Flat cold mint");
        const payer = pubkey(facts.payer, "Flat cold payer");
        const expectedTarget = plan.sourceState === "cold" ? source : destination;
        const expectedOwner = plan.sourceState === "cold" ? owner : destinationOwner;
        const minimum = plan.sourceState === "cold" ? BigInt(plan.semantic.amountAtoms) : 0n;
        if (!payer.equals(owner) || !target.equals(expectedTarget) || !proofOwner.equals(expectedOwner)
            || !proofMint.equals(mint) || BigInt(facts.amountAtoms) < minimum) {
            walletError("CURRENT_WALLET_PLAN_INVALID", "Flat cold proof facts do not bind exact custody semantics");
        }
        const setupBatches = plan.executionInstructionBatches.map((batch, index) => index === plan.actionBatchIndex ? batch.slice(0, batch.length - plan.instructions.length) : batch);
        const nativeSetupBatches = setupBatches.map((batch) => batch.map(manifestInstruction));
        nativeSetupBatches.forEach((batch) => requireCanonicalSetupBatch({
            batch, payer, owner: proofOwner, mint, target, requireCreate: true,
        }));
        validateCurrentWalletLightTransfer2LoadSequence(nativeSetupBatches.map((batch) => batch[2]), { payer, owner: proofOwner, mint, destination: target, amountAtoms: BigInt(facts.amountAtoms) });
    }
    return instructionsFromBatches(plan.executionInstructionBatches);
}
function validateSwap(plan, reobservation) {
    const manifest = plan.instructions[plan.raw.computeUnitLimit === undefined ? 0 : 1];
    if (manifest.programId !== CURRENT_PROGRAM_ID.toBase58()
        || manifest.instructionName !== "SwapCollectiveDlmmExactInV1" || manifest.instructionTag !== 254) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "collective swap instruction identity is invalid");
    }
    const semantic = plan.semantic;
    const reservePages = semantic.reservePageIndices;
    const expectedFlags = [
        W, R, W0, R, W0, R, W0, W0, R, W0, R, W0, W0, W0, W0, R, R, W0, W0, R, R, R, W0, R,
        W0, R, W0, W0, W0, W0, R, W0,
        ...reservePages.map(() => W0),
    ];
    requireFlags(manifest, expectedFlags, "collective swap");
    const data = decodeBase64(manifest.dataBase64, "collective swap data");
    const direction = semantic.direction === "QuoteForOption" ? 0 : 1;
    const expected = concat(Uint8Array.of(254, direction), u64Le(BigInt(semantic.amountIn)), u64Le(BigInt(semantic.minimumAmountOut)), u16Le(semantic.limitBinId), u64Le(BigInt(semantic.deadlineTs)));
    requirePayload(data, expected, "collective swap");
    const trader = pubkey(semantic.trader, "semantic.trader");
    const market = pubkey(semantic.market, "semantic.market");
    const group = pubkey(semantic.writerSettlementGroup, "semantic.writerSettlementGroup");
    const sleeve = pubkey(semantic.writerSleeve, "semantic.writerSleeve");
    const book = pubkey(semantic.writerSeriesBook, "semantic.writerSeriesBook");
    const pool = pubkey(semantic.pool, "semantic.pool");
    const optionMint = pubkey(semantic.optionMint, "semantic.optionMint");
    const quoteMint = pubkey(semantic.quoteMint, "semantic.quoteMint");
    requireAddress(manifest, 0, trader, "swap trader");
    requireAddress(manifest, 2, market, "swap market");
    requireAddress(manifest, 3, String(semantic.oracleMonth), "swap OracleMonth");
    requireAddress(manifest, 4, sleeve, "swap sleeve");
    requireAddress(manifest, 5, group, "swap group");
    requireAddress(manifest, 6, book, "swap book");
    requireAddress(manifest, 7, pool, "swap pool");
    requireAddress(manifest, 8, deriveDlmmAuthority(pool), "swap authority");
    requireAddress(manifest, 9, optionMint, "swap option mint");
    requireAddress(manifest, 10, quoteMint, "swap quote mint");
    requireAddress(manifest, 13, deriveLightAta(optionMint, trader), "swap trader option account");
    requireAddress(manifest, 14, deriveLightAta(quoteMint, trader), "swap trader quote account");
    requireAddress(manifest, 15, LIGHT_TOKEN_PROGRAM_ID, "swap Light program");
    requireAddress(manifest, 16, LIGHT_TOKEN_CPI_AUTHORITY, "swap Light authority");
    requireAddress(manifest, 17, deriveLightSplInterface(optionMint), "swap option interface");
    requireAddress(manifest, 18, deriveLightSplInterface(quoteMint), "swap quote interface");
    requireAddress(manifest, 19, SPL_TOKEN_PROGRAM_ID, "swap token program");
    requireAddress(manifest, 20, SYSTEM_PROGRAM_ID, "swap system program");
    requireAddress(manifest, 21, LIGHT_TOKEN_COMPRESSIBLE_CONFIG, "swap Light config");
    requireAddress(manifest, 22, LIGHT_TOKEN_RENT_SPONSOR, "swap rent sponsor");
    requireAddress(manifest, 23, deriveCollectiveSettlementDelegatePda(trader, optionMint, CURRENT_PROGRAM_ID)[0], "swap settlement authority");
    requireCanonicalSwapPdas({
        group, sleeve, book, market, pool, authority: deriveDlmmAuthority(pool),
        pageIndices: reservePages, pages: manifest.accounts.slice(32).map((meta) => meta.address),
    });
    const sleeveState = decodeWalletWriterSleeve(sleeve, reobservation.accountInfos);
    requireSleeveChildren(sleeveState);
    const bookState = decodeWalletWriterSeriesBook(book, reobservation.accountInfos);
    const poolState = decodeCurrentWalletDlmmPool(pool, reobservation.accountInfos);
    const matchingSeries = bookState.records.filter((record) => record.active
        && record.market.equals(market) && record.contractMint.equals(optionMint));
    if (sleeveState.settlementGroup.toBase58() !== group.toBase58()
        || sleeveState.seriesBook.toBase58() !== book.toBase58()
        || sleeveState.settlementMint.toBase58() !== quoteMint.toBase58()
        || bookState.sleeve.toBase58() !== sleeve.toBase58()
        || bookState.settlementGroup.toBase58() !== group.toBase58()
        || matchingSeries.length !== 1
        || manifest.accounts[1]?.address !== sleeveState.vaultConfig.toBase58()
        || !poolState.market.equals(market) || !poolState.oracleMonth.equals(new PublicKey(String(semantic.oracleMonth)))
        || !poolState.optionMint.equals(optionMint) || !poolState.quoteMint.equals(quoteMint)
        || manifest.accounts[11]?.address !== poolState.optionVault.toBase58()
        || manifest.accounts[12]?.address !== poolState.quoteVault.toBase58()
        || poolState.status !== 1
        || (semantic.limitBinId !== 0 && semantic.limitBinId > poolState.maximumBinId)) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "swap writer/pool state does not bind the exact portable semantics");
    }
    const policyAddress = deriveWalletWriterDlmmPolicy(sleeve), positionAddress = deriveWalletWriterDlmmPosition(pool, sleeve);
    const registryAddress = deriveWriterPda("writer_policy_registry_v1", []);
    const feeVault = deriveWriterPda("writer_fee_vault_v1", [registryAddress]);
    const staging = deriveWriterPda("contract_mint_staging_v1", [market]);
    const retirement = deriveWriterRetirementCustody(sleeve, market);
    [policyAddress, sleeveState.policySnapshot, positionAddress, sleeveState.usdcVault, staging, retirement, registryAddress, feeVault]
        .forEach((key, index) => requireAddress(manifest, 24 + index, key, "swap writer custody"));
    const snapshot = decodeWalletWriterPolicySnapshot(sleeveState.policySnapshot, reobservation.accountInfos);
    const registry = decodeWalletWriterPolicyRegistry(registryAddress, reobservation.accountInfos);
    if (!snapshot.sleeve.equals(sleeve) || !snapshot.registry.equals(registryAddress)
        || !registry.vaultConfig.equals(sleeveState.vaultConfig))
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "swap policy identity differs");
    const policyInfo = reobservation.accountInfos.get(policyAddress.toBase58());
    const positionInfo = reobservation.accountInfos.get(positionAddress.toBase58());
    if (!policyInfo || policyInfo.owner.equals(SYSTEM_PROGRAM_ID)) {
        requireWriterCreateOnlyTarget(reobservation.accountInfos, policyAddress, "historical writer policy");
        requireWriterCreateOnlyTarget(reobservation.accountInfos, positionAddress, "historical writer position");
    }
    else {
        const policy = decodeWalletWriterDlmmPolicy(policyAddress, reobservation.accountInfos);
        if (!policy.sealed || !policy.policySnapshot.equals(snapshot.address) || policy.seriesCount !== bookState.seriesCount) {
            walletError("CURRENT_WALLET_ACCOUNT_INVALID", "swap writer policy is not sealed against this sleeve");
        }
        if (!positionInfo || positionInfo.owner.equals(SYSTEM_PROGRAM_ID))
            requireWriterCreateOnlyTarget(reobservation.accountInfos, positionAddress, "uninitialized writer position");
        else {
            const position = decodeWalletWriterDlmmPosition(positionAddress, reobservation.accountInfos);
            if (!position.policy.equals(policyAddress) || !position.pool.equals(pool) || !position.sleeve.equals(sleeve)
                || !position.market.equals(market) || bookState.records[position.seriesIndex]?.market.toBase58() !== market.toBase58()
                || policy.seriesPoolInventoryAtoms[position.seriesIndex] !== position.optionInventoryAtoms) {
                walletError("CURRENT_WALLET_ACCOUNT_INVALID", "swap writer position differs from the selected series");
            }
        }
    }
    requireClassicCustody(reobservation.accountInfos, sleeveState.usdcVault, quoteMint, sleeve, 0n, "swap sleeve cash");
    requireClassicCustody(reobservation.accountInfos, feeVault, quoteMint, registryAddress, 0n, "swap writer fee vault");
    requireOptionalWriterClassicCustody(reobservation.accountInfos, staging, optionMint, market, "swap market staging");
    requireOptionalWriterClassicCustody(reobservation.accountInfos, retirement, optionMint, sleeve, "swap retirement custody");
    const routePages = manifest.accounts.slice(32).map((meta, index) => {
        const page = decodeCurrentWalletDlmmPage(new PublicKey(meta.address), reobservation.accountInfos);
        if (!page.pool.equals(pool) || page.pageIndex !== reservePages[index]
            || !poolState.initializedPages.includes(page.pageIndex)) {
            walletError("CURRENT_WALLET_ACCOUNT_INVALID", `swap page ${index} is not an initialized pool page`);
        }
        return page;
    });
    const liquidityPages = semantic.direction === "QuoteForOption" ? poolState.askPages : poolState.bidPages;
    if (routePages.some((page) => !liquidityPages.includes(page.pageIndex))) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "swap route includes a page without directional finalized liquidity");
    }
    const optionAccount = deriveLightAta(optionMint, trader);
    const quoteAccount = deriveLightAta(quoteMint, trader);
    requireLightCustody(reobservation.accountInfos, optionAccount, optionMint, trader, semantic.direction === "OptionForQuote" ? BigInt(semantic.amountIn) : 0n, "swap trader option account");
    requireLightCustody(reobservation.accountInfos, quoteAccount, quoteMint, trader, semantic.direction === "QuoteForOption" ? BigInt(semantic.amountIn) : 0n, "swap trader quote account");
    return instructionsFromBatches(plan.executionInstructionBatches);
}
function requireCloseAdmissionState(envelope, request, sleeve, book, reobservation) {
    const factsValue = envelope.leanAdmission.facts;
    if (factsValue === null || typeof factsValue !== "object" || Array.isArray(factsValue)) {
        walletError("CURRENT_WALLET_ADMISSION_INVALID", "writer close admission facts are missing");
    }
    const facts = factsValue;
    const statuses = ["collecting", "complete", "finalized", "cancelling", "cancelled"];
    const sleeveStatuses = [
        "draft", "policy_frozen", "funding", "active", "close_staging",
        "expired", "settlement_finalized", "closed",
    ];
    const required = request.requiredClaimAtoms.map((amount) => amount.toString());
    const deposited = request.depositedClaimAtoms.map((amount) => amount.toString());
    const preparedTime = envelope.operationPlan.currentObservation.observedBlockTimeUnixSeconds;
    if (!request.sleeve.equals(sleeve.address)
        || !request.flatMint.equals(sleeve.flatMint)
        || !request.flatEscrow.equals(deriveWriterCloseFlatEscrow(request.address))
        || request.requestNonce !== sleeve.closeNonce
        || !book.sleeve.equals(sleeve.address) || !book.settlementGroup.equals(sleeve.settlementGroup)
        || book.seriesCount !== sleeve.seriesCount || request.seriesCount !== sleeve.seriesCount
        || request.deadlineTs >= sleeve.expiryTs || sleeve.status !== 4
        || sleeve.activeCloseRequest?.toBase58() !== request.address.toBase58()
        || facts.requestSleeve !== request.sleeve.toBase58()
        || facts.requestOwner !== request.owner.toBase58()
        || facts.requestStatus !== statuses[request.status]
        || facts.requestDeadlineUnixSeconds !== request.deadlineTs.toString()
        || facts.seriesCount !== request.seriesCount.toString()
        || facts.nextDepositIndex !== request.nextDepositIndex.toString()
        || facts.nextCancelIndex !== request.nextCancelIndex.toString()
        || canonicalJson(facts.requiredClaimAtoms) !== canonicalJson(required)
        || canonicalJson(facts.depositedClaimAtoms) !== canonicalJson(deposited)
        || facts.sleeve !== sleeve.address.toBase58()
        || facts.sleeveStatus !== sleeveStatuses[sleeve.status]
        || facts.sleeveActiveCloseRequest !== request.address.toBase58()
        || facts.sleeveExpiryUnixSeconds !== sleeve.expiryTs.toString()
        || facts.bookSeriesCount !== book.seriesCount.toString()
        || facts.observedBlockTimeUnixSeconds !== preparedTime) {
        walletError("CURRENT_WALLET_ADMISSION_INVALID", "writer close admission facts differ from the exact finalized request, sleeve, or book state");
    }
    const stage = envelope.stage;
    const actor = pubkey(envelope.operationPlan.semantic.owner, "semantic.owner");
    const observedTime = reobservation.observedBlockTimeUnixSeconds;
    if (facts.intent === "forward") {
        const depositReady = request.status === 0
            && request.nextDepositIndex < request.seriesCount
            && request.requiredClaimAtoms[request.nextDepositIndex] > 0n
            && request.depositedClaimAtoms[request.nextDepositIndex] === 0n;
        const finalizeReady = request.status === 1
            && request.nextDepositIndex === request.seriesCount
            && canonicalJson(required) === canonicalJson(deposited);
        const exactStage = depositReady
            ? stage.operation === "deposit_basket" && stage.seriesIndex === request.nextDepositIndex
            : finalizeReady && stage.operation === "finalize";
        if (!actor.equals(request.owner) || observedTime > request.deadlineTs || !exactStage) {
            walletError("CURRENT_WALLET_ADMISSION_INVALID", "writer close forward stage is not exact finalized state");
        }
        return;
    }
    const firstDeposited = request.depositedClaimAtoms.findIndex((amount, index) => index >= request.nextCancelIndex && amount > 0n);
    const exactStage = firstDeposited >= 0
        ? stage.operation === "cancel_series" && stage.seriesIndex === firstDeposited
        : request.depositedClaimAtoms.every((amount) => amount === 0n) && stage.operation === "cancel_flat";
    if (facts.intent !== "cancel" || ![0, 1, 3].includes(request.status)
        || (!actor.equals(request.owner) && observedTime <= request.deadlineTs) || !exactStage) {
        walletError("CURRENT_WALLET_ADMISSION_INVALID", "writer close cancellation stage is not exact finalized state");
    }
}
function requireCloseBeginAdmission(envelope, sleeve, book) {
    const commitmentsValue = envelope.leanAdmission.commitments;
    if (commitmentsValue === null || typeof commitmentsValue !== "object"
        || Array.isArray(commitmentsValue)) {
        walletError("CURRENT_WALLET_ADMISSION_INVALID", "close preview commitments are missing");
    }
    const commitments = commitmentsValue;
    const keys = Object.keys(commitments).sort();
    if (canonicalJson(keys) !== canonicalJson(["book", "deployment", "group", "policy"])) {
        walletError("CURRENT_WALLET_ADMISSION_INVALID", "close preview commitments have a widened shape");
    }
    const groupObservation = envelope.operationPlan.currentObservation.orderedAccounts.find((account) => account.address === sleeve.settlementGroup.toBase58());
    if (commitments.group !== groupObservation?.dataSha256
        || commitments.book !== book.bookDigest
        || commitments.policy !== sleeve.policyHash
        || commitments.deployment !== CURRENT_WALLET_PROTOCOL_IDENTITY.programDataCapacitySha256) {
        walletError("CURRENT_WALLET_ADMISSION_INVALID", "close preview state commitments are not exact");
    }
}
function requireSleeveChildren(sleeve) {
    if (!sleeve.seriesBook.equals(deriveWriterSeriesBook(sleeve.address))
        || !sleeve.usdcVault.equals(deriveWriterSleeveUsdcVault(sleeve.address))
        || !sleeve.flatMint.equals(deriveWriterFlatMint(sleeve.address))
        || !sleeve.flatStaging.equals(deriveWriterFlatStaging(sleeve.address))
        || !sleeve.flatBurnCustody.equals(deriveWriterFlatBurnCustody(sleeve.address))
        || !sleeve.flatSplInterface.equals(deriveLightSplInterface(sleeve.flatMint))) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "writer sleeve child identities are not canonical");
    }
}
function requireStage(envelope, operation) {
    const stage = envelope.stage;
    if (stage?.operation !== operation) {
        walletError("CURRENT_WALLET_ADMISSION_INVALID", `Lean did not admit ${operation}`);
    }
    if (operation === "deposit_basket" || operation === "cancel_series") {
        if (!Number.isInteger(stage.seriesIndex) || stage.seriesIndex < 0 || stage.seriesIndex > 19
            || Object.keys(stage).length !== 2) {
            walletError("CURRENT_WALLET_ADMISSION_INVALID", "Lean stage series index is invalid");
        }
        return stage.seriesIndex;
    }
    if (Object.keys(stage).length !== 1) {
        walletError("CURRENT_WALLET_ADMISSION_INVALID", "Lean non-series stage contains extra fields");
    }
    return 255;
}
function requireSeries(book, index) {
    const record = book.records[index];
    if (record === undefined || !record.active
        || !record.retirementCustody.equals(deriveWriterRetirementCustody(book.sleeve, record.market))) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "selected writer series is not active in finalized state");
    }
    return record;
}
function requireWriterLightConstants(manifest, lightIndex, authorityIndex, interfaceIndex, tokenIndex, systemIndex, configIndex, sponsorIndex, expectedInterface) {
    requireAddress(manifest, lightIndex, LIGHT_TOKEN_PROGRAM_ID, "writer Light program");
    requireAddress(manifest, authorityIndex, LIGHT_TOKEN_CPI_AUTHORITY, "writer Light authority");
    requireAddress(manifest, interfaceIndex, expectedInterface, "writer Light interface");
    requireAddress(manifest, tokenIndex, SPL_TOKEN_PROGRAM_ID, "writer token program");
    requireAddress(manifest, systemIndex, SYSTEM_PROGRAM_ID, "writer system program");
    requireAddress(manifest, configIndex, LIGHT_TOKEN_COMPRESSIBLE_CONFIG, "writer Light config");
    requireAddress(manifest, sponsorIndex, LIGHT_TOKEN_RENT_SPONSOR, "writer rent sponsor");
}
function instructionsFromBatches(batches) {
    return Object.freeze(batches.map((batch) => Object.freeze(batch.map(manifestInstruction))));
}
function buildLightTransfer(source, mint, destination, owner, amount, decimals) {
    return new TransactionInstruction({
        programId: LIGHT_TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: destination, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: PublicKey.default, isSigner: false, isWritable: false },
            { pubkey: owner, isSigner: true, isWritable: true },
        ],
        data: concat(Uint8Array.of(12), u64Le(amount), Uint8Array.of(decimals)),
    });
}
function decodeMintDecimals(data) {
    if (data.length !== 82 || readU32Le(data, 0) > 1 || data[45] !== 1 || readU32Le(data, 46) > 1) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", "Flat mint is not an initialized classic SPL mint");
    }
    return data[44];
}
function decodeLightToken(data, label, scoped = false) {
    const delegateOkay = data.length === 272 && ((readU32Le(data, 72) === 0 && readU64Le(data, 121) === 0n)
        || (scoped && readU32Le(data, 72) === 1 && new PublicKey(data.subarray(76, 108)).equals(deriveCollectiveSettlementDelegatePda(new PublicKey(data.subarray(32, 64)), new PublicKey(data.subarray(0, 32)), CURRENT_PROGRAM_ID)[0])));
    if (data.length !== 272 || data[108] !== 1 || !delegateOkay
        || readU32Le(data, 109) !== 0 || readU32Le(data, 129) !== 0
        || data[165] !== 2 || data[166] !== 1 || readU32Le(data, 167) !== 1 || data[171] !== 32) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} is not canonical transferable Light custody`);
    }
    return Object.freeze({
        mint: new PublicKey(data.subarray(0, 32)),
        owner: new PublicKey(data.subarray(32, 64)),
        amount: readU64Le(data, 64),
    });
}
function requireLightCustody(accounts, address, mint, owner, minimumAmount, label) {
    const info = accounts.get(address.toBase58());
    if (info === null || info === undefined || info.executable || !info.owner.equals(LIGHT_TOKEN_PROGRAM_ID)) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} is not a finalized Light token account`);
    }
    const custody = decodeLightToken(info.data, label, address.equals(deriveLightAta(mint, owner)));
    if (!custody.mint.equals(mint) || !custody.owner.equals(owner) || custody.amount < minimumAmount) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} identity or balance differs from required custody`);
    }
}
function requireClassicCustody(accounts, address, mint, owner, minimumAmount, label) {
    const info = accounts.get(address.toBase58());
    if (info === null || info === undefined || info.executable || !info.owner.equals(SPL_TOKEN_PROGRAM_ID)) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} is not a finalized classic SPL token account`);
    }
    const data = info.data;
    // SPL None clears only the COption tag; retained body bytes carry no authority.
    if (data.length !== 165
        || readU32Le(data, 72) !== 0
        || data[108] !== 1
        || readU32Le(data, 109) !== 0
        || readU64Le(data, 121) !== 0n
        || readU32Le(data, 129) !== 0) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} is not canonical transferable SPL custody`);
    }
    const custodyMint = new PublicKey(data.subarray(0, 32));
    const custodyOwner = new PublicKey(data.subarray(32, 64));
    if (!custodyMint.equals(mint) || !custodyOwner.equals(owner) || readU64Le(data, 64) < minimumAmount) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} identity or balance differs from required custody`);
    }
}
function requireAccountBytes(accounts, address, owner, expected, label) {
    const info = accounts.get(address.toBase58());
    if (info === null || info === undefined || info.executable || !info.owner.equals(owner)
        || !equalBytes(info.data, expected)) {
        walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} bytes do not match finalized re-observation`);
    }
}
function requirePayload(actual, expected, label) {
    if (!equalBytes(actual, expected)) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", `${label} bytes differ from displayed/admitted semantics`);
    }
}
function concat(...parts) {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}
function u16Le(value) {
    const output = new Uint8Array(2);
    new DataView(output.buffer).setUint16(0, value, true);
    return output;
}
/** Validate original signed governance bytes, reconstruct the business view, then return only the original bytes. */
export function validateAndMaterializeCollectivePlan(envelope, reobservation) {
    const release = currentGovernedWriteReleaseV1();
    const strip = (manifest) => {
        if (manifest.programId !== reobservation.governance.targetProgram.toBase58())
            return manifest;
        const instruction = manifestInstruction(manifest);
        const checked = inspectGovernedInstructionEnvelopeV1({ instruction, context: reobservation.governance, recognizedInstructionTags: release.assignedInstructionTags });
        return { ...manifest, dataBase64: Buffer.from(checked.legacyData).toString("base64"), accounts: manifest.accounts.slice(0, -1) };
    };
    const plan = envelope.operationPlan;
    const semantic = { ...envelope, operationPlan: { ...plan, instructions: plan.instructions.map(strip), executionInstructionBatches: plan.executionInstructionBatches.map(batch => batch.map(strip)) } };
    const rebuilt = validateAndMaterializeSemanticPlan(semantic, reobservation);
    return Object.freeze(rebuilt.map((batch, index) => {
        const original = plan.executionInstructionBatches[index].map(manifestInstruction);
        if (batch.length !== original.length)
            walletError("CURRENT_WALLET_GOVERNED_BATCH_INVALID", "reconstructed batch length changed");
        batch.forEach((instruction, i) => requireExactInstruction(instruction, manifestInstruction(strip(plan.executionInstructionBatches[index][i])), "governed business reconstruction"));
        for (const instruction of original)
            for (const meta of instruction.keys) {
                if (meta.pubkey.equals(reobservation.governance.gateAddress) && (meta.isSigner || meta.isWritable))
                    walletError("CURRENT_WALLET_GATE_PRIVILEGES", "transaction elevates the governance gate");
            }
        const governed = original.filter(instruction => instruction.programId.equals(reobservation.governance.targetProgram));
        if (governed.length)
            inspectGovernedInstructionBatchV1({ instructions: governed, context: reobservation.governance, recognizedInstructionTags: release.assignedInstructionTags });
        return Object.freeze(original);
    }));
}
//# sourceMappingURL=operations.js.map