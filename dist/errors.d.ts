import type { JsonValue } from "./types.js";
export interface AmebaErrorContext {
    readonly method?: string;
    readonly url?: string;
}
/** Render untrusted text without allowing terminal or bidi control injection. */
export declare function sanitizeDisplayText(value: string, maximumCharacters?: number): string;
/** Deterministic failures at the fresh-cutover protocol boundary. */
export declare const CURRENT_BOUNDARY_ERROR_CODES: readonly ["UNSUPPORTED_CLUSTER", "PROGRAM_ID_MISMATCH", "ACCOUNT_LAYOUT_MISMATCH", "ACCOUNT_NAMESPACE_MISMATCH", "MINT_OWNER_MISMATCH", "LIGHT_PROOF_UNAVAILABLE", "CURRENT_MARKET_UNAVAILABLE"];
export type CurrentBoundaryErrorCode = (typeof CURRENT_BOUNDARY_ERROR_CODES)[number];
export interface AmebaCurrentBoundaryErrorOptions {
    readonly cause?: unknown;
    readonly details?: JsonValue;
}
export declare class AmebaSdkError extends Error {
    readonly code: string;
    readonly details?: JsonValue;
    readonly retryable: boolean;
    readonly context: AmebaErrorContext;
    constructor(message: string, options?: {
        code?: string;
        cause?: unknown;
        details?: JsonValue;
        retryable?: boolean;
        context?: AmebaErrorContext;
    });
}
export declare class AmebaBackendError extends AmebaSdkError {
    readonly status: number;
    readonly requestId?: string;
    readonly retryAfterMs?: number;
    constructor(message: string, options: {
        status: number;
        code?: string;
        requestId?: string;
        retryAfterMs?: number;
        cause?: unknown;
        details?: JsonValue;
        context?: AmebaErrorContext;
    });
}
export declare const CURRENT_STATE_UNAVAILABLE_WAIT: Readonly<{
    readonly outcome: "wait";
    readonly action: "none";
    readonly code: "CURRENT_STATE_UNAVAILABLE";
    readonly reason: "current_state_unavailable";
    readonly maximumCallerRetries: 1;
    readonly requiresNewFinalizedSnapshot: true;
    readonly builderTarget: null;
}>;
export type CurrentStateUnavailableWait = typeof CURRENT_STATE_UNAVAILABLE_WAIT;
/**
 * Exact Lean 503 boundary. The SDK never retries it automatically; callers may
 * perform at most one reviewed retry after acquiring an entirely new finalized
 * snapshot, then retain the attached wait/no-action result.
 */
export declare class AmebaCurrentStateUnavailableError extends AmebaBackendError {
    readonly wait: CurrentStateUnavailableWait;
    constructor(options?: {
        requestId?: string;
        details?: JsonValue;
        context?: AmebaErrorContext;
    });
}
export declare class AmebaTransportError extends AmebaSdkError {
    constructor(message: string, options?: {
        cause?: unknown;
        context?: AmebaErrorContext;
    });
}
export declare class AmebaTimeoutError extends AmebaSdkError {
    readonly timeoutMs: number;
    constructor(timeoutMs: number, options?: {
        cause?: unknown;
        context?: AmebaErrorContext;
    });
}
export declare class AmebaAbortError extends AmebaSdkError {
    readonly reason: unknown;
    constructor(reason: unknown, options?: {
        cause?: unknown;
        context?: AmebaErrorContext;
    });
}
export declare class AmebaResponseValidationError extends AmebaSdkError {
    readonly responsePath: string;
    constructor(responsePath: string, message: string, options?: {
        cause?: unknown;
        details?: JsonValue;
        context?: AmebaErrorContext;
    });
}
export declare class AmebaUnsupportedCapabilityError extends AmebaSdkError {
    readonly capability: string;
    constructor(capability: string, reason: string);
}
/** A current on-chain protocol fact could not be accepted by the SDK. */
export declare class AmebaProtocolError extends AmebaSdkError {
    constructor(message: string, options?: {
        code?: string;
        cause?: unknown;
        details?: JsonValue;
    });
}
/** A fail-closed rejection at an exact current-protocol boundary. */
export declare class AmebaCurrentBoundaryError extends AmebaProtocolError {
    readonly code: CurrentBoundaryErrorCode;
    constructor(code: CurrentBoundaryErrorCode, message: string, options?: AmebaCurrentBoundaryErrorOptions);
}
export declare class AmebaUnsupportedClusterError extends AmebaCurrentBoundaryError {
    constructor(message: string, options?: AmebaCurrentBoundaryErrorOptions);
}
export declare class AmebaProgramIdMismatchError extends AmebaCurrentBoundaryError {
    constructor(message: string, options?: AmebaCurrentBoundaryErrorOptions);
}
export declare class AmebaAccountLayoutMismatchError extends AmebaCurrentBoundaryError {
    constructor(message: string, options?: AmebaCurrentBoundaryErrorOptions);
}
export declare class AmebaAccountNamespaceMismatchError extends AmebaCurrentBoundaryError {
    constructor(message: string, options?: AmebaCurrentBoundaryErrorOptions);
}
export declare class AmebaMintOwnerMismatchError extends AmebaCurrentBoundaryError {
    constructor(message: string, options?: AmebaCurrentBoundaryErrorOptions);
}
export declare class AmebaLightProofUnavailableError extends AmebaCurrentBoundaryError {
    constructor(message: string, options?: AmebaCurrentBoundaryErrorOptions);
}
export declare class AmebaCurrentMarketUnavailableError extends AmebaCurrentBoundaryError {
    constructor(message: string, options?: AmebaCurrentBoundaryErrorOptions);
}
export declare function createCurrentBoundaryError(code: CurrentBoundaryErrorCode, message: string, options?: AmebaCurrentBoundaryErrorOptions): AmebaCurrentBoundaryError;
export declare function isCurrentBoundaryErrorCode(value: unknown): value is CurrentBoundaryErrorCode;
/** Exact current account bytes, discriminator, version, and padding failed validation. */
export declare class AmebaProtocolLayoutError extends AmebaProtocolError {
    readonly accountKind: string;
    constructor(accountKind: string, reason: string, options?: {
        cause?: unknown;
        details?: JsonValue;
    });
}
/** A current account has a foreign owner or a noncanonical PDA identity. */
export declare class AmebaProtocolIdentityError extends AmebaProtocolError {
    constructor(message: string, options?: {
        cause?: unknown;
        details?: JsonValue;
    });
}
/** The caller supplied a cluster/release/program identity outside the cutover. */
export declare class AmebaProtocolDeploymentError extends AmebaProtocolError {
    constructor(message: string, options?: {
        cause?: unknown;
        details?: JsonValue;
    });
}
export declare class AmebaInputError extends AmebaSdkError {
    constructor(message: string, details?: JsonValue);
}
//# sourceMappingURL=errors.d.ts.map