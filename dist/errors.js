const DISPLAY_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
/** Render untrusted text without allowing terminal or bidi control injection. */
export function sanitizeDisplayText(value, maximumCharacters = 16_384) {
    const bounded = value.length > maximumCharacters
        ? `${value.slice(0, maximumCharacters)}...[truncated]`
        : value;
    return bounded.replace(DISPLAY_CONTROL_PATTERN, (character) => {
        switch (character) {
            case "\n": return "\\n";
            case "\r": return "\\r";
            case "\t": return "\\t";
            default: return `\\u{${character.codePointAt(0).toString(16).padStart(4, "0")}}`;
        }
    });
}
/** Deterministic failures at the fresh-cutover protocol boundary. */
export const CURRENT_BOUNDARY_ERROR_CODES = Object.freeze([
    "UNSUPPORTED_CLUSTER",
    "PROGRAM_ID_MISMATCH",
    "ACCOUNT_LAYOUT_MISMATCH",
    "ACCOUNT_NAMESPACE_MISMATCH",
    "MINT_OWNER_MISMATCH",
    "LIGHT_PROOF_UNAVAILABLE",
    "CURRENT_MARKET_UNAVAILABLE",
]);
export class AmebaSdkError extends Error {
    code;
    details;
    retryable;
    context;
    constructor(message, options = {}) {
        super(sanitizeDisplayText(message), { cause: options.cause });
        this.name = new.target.name;
        this.code = options.code ?? "AMEBA_SDK_ERROR";
        this.details = options.details;
        this.retryable = options.retryable ?? false;
        this.context = Object.freeze({ ...(options.context ?? {}) });
    }
}
export class AmebaBackendError extends AmebaSdkError {
    status;
    requestId;
    retryAfterMs;
    constructor(message, options) {
        super(message, {
            code: options.code ?? "AMEBA_BACKEND_ERROR",
            cause: options.cause,
            details: options.details,
            retryable: retryableStatus(options.status),
            context: options.context,
        });
        this.status = options.status;
        this.requestId = options.requestId;
        this.retryAfterMs = options.retryAfterMs;
    }
}
export const CURRENT_STATE_UNAVAILABLE_WAIT = Object.freeze({
    outcome: "wait",
    action: "none",
    code: "CURRENT_STATE_UNAVAILABLE",
    reason: "current_state_unavailable",
    maximumCallerRetries: 1,
    requiresNewFinalizedSnapshot: true,
    builderTarget: null,
});
/**
 * Exact Lean 503 boundary. The SDK never retries it automatically; callers may
 * perform at most one reviewed retry after acquiring an entirely new finalized
 * snapshot, then retain the attached wait/no-action result.
 */
export class AmebaCurrentStateUnavailableError extends AmebaBackendError {
    wait = CURRENT_STATE_UNAVAILABLE_WAIT;
    constructor(options = {}) {
        super("current Market discovery is not authoritative", {
            status: 503,
            code: "CURRENT_STATE_UNAVAILABLE",
            requestId: options.requestId,
            details: options.details,
            context: options.context,
        });
    }
}
export class AmebaTransportError extends AmebaSdkError {
    constructor(message, options = {}) {
        super(message, {
            code: "HTTP_TRANSPORT_ERROR",
            cause: options.cause,
            retryable: true,
            context: options.context,
        });
    }
}
export class AmebaTimeoutError extends AmebaSdkError {
    timeoutMs;
    constructor(timeoutMs, options = {}) {
        super(`Ameba backend request timed out after ${timeoutMs}ms`, {
            code: "REQUEST_TIMEOUT",
            cause: options.cause,
            retryable: true,
            context: options.context,
            details: { timeoutMs },
        });
        this.timeoutMs = timeoutMs;
    }
}
export class AmebaAbortError extends AmebaSdkError {
    reason;
    constructor(reason, options = {}) {
        super("Ameba backend request was aborted by the caller", {
            code: "REQUEST_ABORTED",
            cause: options.cause,
            retryable: false,
            context: options.context,
        });
        this.reason = reason;
    }
}
export class AmebaResponseValidationError extends AmebaSdkError {
    responsePath;
    constructor(responsePath, message, options = {}) {
        super(`Invalid Amoeba response at ${responsePath}: ${message}`, {
            code: "INVALID_BACKEND_RESPONSE",
            cause: options.cause,
            details: options.details,
            context: options.context,
        });
        this.responsePath = responsePath;
    }
}
export class AmebaUnsupportedCapabilityError extends AmebaSdkError {
    capability;
    constructor(capability, reason) {
        super(`${capability} is not available: ${reason}`, {
            code: "UNSUPPORTED_CAPABILITY",
            details: { capability, reason },
        });
        this.capability = capability;
    }
}
/** A current on-chain protocol fact could not be accepted by the SDK. */
export class AmebaProtocolError extends AmebaSdkError {
    constructor(message, options = {}) {
        super(message, {
            code: options.code ?? "AMEBA_PROTOCOL_ERROR",
            cause: options.cause,
            details: options.details,
            retryable: false,
        });
    }
}
/** A fail-closed rejection at an exact current-protocol boundary. */
export class AmebaCurrentBoundaryError extends AmebaProtocolError {
    code;
    constructor(code, message, options = {}) {
        if (!isCurrentBoundaryErrorCode(code)) {
            throw new TypeError(`Unknown current boundary error code: ${String(code)}`);
        }
        super(message, {
            code,
            cause: options.cause,
            details: options.details,
        });
        this.code = code;
    }
}
export class AmebaUnsupportedClusterError extends AmebaCurrentBoundaryError {
    constructor(message, options = {}) {
        super("UNSUPPORTED_CLUSTER", message, options);
    }
}
export class AmebaProgramIdMismatchError extends AmebaCurrentBoundaryError {
    constructor(message, options = {}) {
        super("PROGRAM_ID_MISMATCH", message, options);
    }
}
export class AmebaAccountLayoutMismatchError extends AmebaCurrentBoundaryError {
    constructor(message, options = {}) {
        super("ACCOUNT_LAYOUT_MISMATCH", message, options);
    }
}
export class AmebaAccountNamespaceMismatchError extends AmebaCurrentBoundaryError {
    constructor(message, options = {}) {
        super("ACCOUNT_NAMESPACE_MISMATCH", message, options);
    }
}
export class AmebaMintOwnerMismatchError extends AmebaCurrentBoundaryError {
    constructor(message, options = {}) {
        super("MINT_OWNER_MISMATCH", message, options);
    }
}
export class AmebaLightProofUnavailableError extends AmebaCurrentBoundaryError {
    constructor(message, options = {}) {
        super("LIGHT_PROOF_UNAVAILABLE", message, options);
    }
}
export class AmebaCurrentMarketUnavailableError extends AmebaCurrentBoundaryError {
    constructor(message, options = {}) {
        super("CURRENT_MARKET_UNAVAILABLE", message, options);
    }
}
export function createCurrentBoundaryError(code, message, options = {}) {
    return new AmebaCurrentBoundaryError(code, message, options);
}
export function isCurrentBoundaryErrorCode(value) {
    return (typeof value === "string" &&
        CURRENT_BOUNDARY_ERROR_CODES.includes(value));
}
/** Exact current account bytes, discriminator, version, and padding failed validation. */
export class AmebaProtocolLayoutError extends AmebaProtocolError {
    accountKind;
    constructor(accountKind, reason, options = {}) {
        super(`${accountKind} is not the exact current layout: ${reason}`, {
            code: "ACCOUNT_LAYOUT_MISMATCH",
            cause: options.cause,
            details: options.details,
        });
        this.accountKind = accountKind;
    }
}
/** A current account has a foreign owner or a noncanonical PDA identity. */
export class AmebaProtocolIdentityError extends AmebaProtocolError {
    constructor(message, options = {}) {
        super(message, {
            code: "PROGRAM_ID_MISMATCH",
            cause: options.cause,
            details: options.details,
        });
    }
}
/** The caller supplied a cluster/release/program identity outside the cutover. */
export class AmebaProtocolDeploymentError extends AmebaProtocolError {
    constructor(message, options = {}) {
        super(message, {
            code: "UNSUPPORTED_CLUSTER",
            cause: options.cause,
            details: options.details,
        });
    }
}
export class AmebaInputError extends AmebaSdkError {
    constructor(message, details) {
        super(message, { code: "INVALID_INPUT", details });
    }
}
function retryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}
//# sourceMappingURL=errors.js.map