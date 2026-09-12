/** Browser-safe canonical identity for the finalized V3 Devnet protocol. */
export const AMOEBA_SPREAD_PROGRAM_ID = "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw" as const;
export const CURRENT_NAMESPACE = "ameba-spread-v2" as const;

/**
 * Historical RC44 deployment-receipt field. This value is retained solely for
 * byte-for-byte plan/receipt correspondence and must never be used to create a
 * runtime connection. It is intentionally absent from public package barrels.
 */
export const CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_RPC_URL =
  "https://api.devnet.solana.com" as const;
