import { AmebaInputError } from "./errors.js";
export const AMOEBA_BACKEND_URL = "https://api.amoeba.farm";
const AMOEBA_BACKEND_HOST = "api.amoeba.farm";
function normalizedHostname(url) {
    return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/u, "").toLowerCase();
}
function isLoopbackHostname(hostname) {
    return hostname === "localhost"
        || hostname === "::1"
        || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
}
/**
 * Validate an Amoeba application endpoint. Remote clients are pinned to the
 * hosted Amoeba API; loopback HTTP remains available for local integration
 * tests. Provider RPC hosts and credential-bearing URLs are never accepted as
 * application backends.
 */
export function normalizeAmoebaBackendUrl(raw = AMOEBA_BACKEND_URL) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new AmebaInputError("backendUrl must be an absolute Amoeba URL");
    }
    const hostname = normalizedHostname(url);
    const loopback = isLoopbackHostname(hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        throw new AmebaInputError("backendUrl must use https (http is allowed only for loopback Amoeba development)");
    }
    if (!loopback && hostname !== AMOEBA_BACKEND_HOST) {
        throw new AmebaInputError("backendUrl must target the hosted Amoeba API (or a loopback development server)");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new AmebaInputError("backendUrl must not contain credentials, a query string, or a fragment");
    }
    if (url.pathname !== "/" && url.pathname !== "") {
        throw new AmebaInputError("backendUrl must be the Amoeba API origin, without a path");
    }
    url.hostname = hostname;
    url.pathname = "/";
    return url;
}
/** The sole client-facing Solana read endpoint: Amoeba's admitted `/rpc`. */
export function amoebaReadGatewayUrl(backendUrl = AMOEBA_BACKEND_URL) {
    return new URL("rpc", normalizeAmoebaBackendUrl(backendUrl)).toString();
}
/**
 * Validate that an injected read capability identifies exactly an Amoeba
 * `/rpc` gateway, never a Solana validator or third-party provider endpoint.
 */
export function normalizeAmoebaReadGatewayUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new AmebaInputError("RPC endpoint must be the absolute Amoeba /rpc URL");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new AmebaInputError("RPC endpoint must not contain credentials, a query string, or a fragment");
    }
    if (url.pathname !== "/rpc") {
        throw new AmebaInputError("RPC endpoint must target Amoeba's exact /rpc read gateway");
    }
    const backend = new URL(url.toString());
    backend.pathname = "/";
    const expected = amoebaReadGatewayUrl(backend.toString());
    if (url.toString() !== expected) {
        throw new AmebaInputError("RPC endpoint is not the canonical Amoeba /rpc read gateway");
    }
    return expected;
}
//# sourceMappingURL=endpoint-policy.js.map