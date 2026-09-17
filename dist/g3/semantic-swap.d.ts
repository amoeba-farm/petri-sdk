import { Buffer } from "buffer";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
/** Resolve the original wallet intent. No client-supplied account metas or decoded state. */
export declare function resolveG3SemanticSwap(owner: PublicKey, request: Record<string, unknown>, programId: PublicKey, read: (address: PublicKey) => Promise<AccountInfo<Buffer>>): Promise<{
    pool: import("@amoeba/spread-release-tools/dlmm-accounts").AmoebaDlmmPoolAccount;
    orderRecords: PublicKey[];
    request: {
        kind: "swap";
        direction: "QuoteForOption" | "OptionForQuote";
        amountIn: bigint;
        minimumAmountOut: bigint;
        limitPriceAtoms: bigint;
        deadlineTs: bigint;
    };
    accounts: {
        trader: PublicKey;
        vaultConfig: PublicKey;
        market: PublicKey;
        oracleMonth: PublicKey;
        writerSleeve: PublicKey;
        writerSettlementGroup: PublicKey;
        writerSeriesBook: PublicKey;
        pool: PublicKey;
        authority: PublicKey;
        optionMint: PublicKey;
        quoteMint: PublicKey;
        optionVault: PublicKey;
        quoteVault: PublicKey;
        traderOptionAccount: PublicKey;
        traderQuoteAccount: PublicKey;
        writerPolicySnapshot: PublicKey;
        writerSleeveUsdcVault: PublicKey;
        writerMarketStaging: PublicKey;
        writerRetirementCustody: PublicKey;
        writerPolicyRegistry: PublicKey;
        lightTokenProgram: PublicKey;
        lightCpiAuthority: PublicKey;
        optionInterface: PublicKey;
        quoteInterface: PublicKey;
        splTokenProgram: PublicKey;
        reservePages: PublicKey[];
    };
}>;
//# sourceMappingURL=semantic-swap.d.ts.map