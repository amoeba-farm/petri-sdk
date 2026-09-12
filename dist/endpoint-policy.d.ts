export declare const AMOEBA_BACKEND_URL: "https://api.amoeba.farm";
/**
 * Validate an Amoeba application endpoint. Remote clients are pinned to the
 * hosted Amoeba API; loopback HTTP remains available for local integration
 * tests. Provider RPC hosts and credential-bearing URLs are never accepted as
 * application backends.
 */
export declare function normalizeAmoebaBackendUrl(raw?: string): URL;
/** The sole client-facing Solana read endpoint: Amoeba's admitted `/rpc`. */
export declare function amoebaReadGatewayUrl(backendUrl?: string): string;
/**
 * Validate that an injected read capability identifies exactly an Amoeba
 * `/rpc` gateway, never a Solana validator or third-party provider endpoint.
 */
export declare function normalizeAmoebaReadGatewayUrl(raw: string): string;
//# sourceMappingURL=endpoint-policy.d.ts.map