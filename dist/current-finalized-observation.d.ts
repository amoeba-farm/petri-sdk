export declare const CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION: 1;
export declare const CURRENT_FINALIZED_OBSERVATION_SOURCE: "current_finalized_rpc";
export declare const CURRENT_FINALIZED_OBSERVATION_COMMITMENT: "finalized";
export declare const CURRENT_FINALIZED_OBSERVATION_DIGEST_DOMAIN: "ameba_lean:current_finalized_observation:v1";
export declare const CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export interface CurrentStateProviderIdentity {
    readonly kind: "solana_json_rpc";
    readonly origin: string;
    readonly originSha256: string;
    readonly genesisHash: typeof CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH;
}
export interface CurrentFinalizedObservedAccount {
    readonly address: string;
    readonly owner: string | null;
    readonly executable: boolean | null;
    readonly dataLength: string | null;
    readonly dataSha256: string | null;
}
export interface CurrentFinalizedObservation {
    readonly schemaVersion: typeof CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION;
    readonly observationSource: typeof CURRENT_FINALIZED_OBSERVATION_SOURCE;
    readonly commitment: typeof CURRENT_FINALIZED_OBSERVATION_COMMITMENT;
    readonly observedAtSlot: string;
    readonly currentFinalizedSlot: string;
    /** Null has a canonical digest encoding, but the v1 validator rejects it. */
    readonly observedBlockTimeUnixSeconds: string | null;
    readonly stateProvider: CurrentStateProviderIdentity;
    readonly orderedAccounts: readonly CurrentFinalizedObservedAccount[];
    readonly currentObservationDigest: string;
}
export type CurrentFinalizedObservationDigestInput = Omit<CurrentFinalizedObservation, "currentObservationDigest"> & {
    readonly currentObservationDigest?: string;
};
export declare class CurrentFinalizedObservationValidationError extends Error {
    readonly code: "CURRENT_FINALIZED_OBSERVATION_INVALID";
    constructor(message: string);
}
/**
 * Return Lean's exact v1 digest preimage. Object key order is irrelevant;
 * account order is authoritative and is never sorted.
 */
export declare function currentFinalizedObservationPreimage(input: CurrentFinalizedObservationDigestInput): Uint8Array;
/** Compute Lean's lowercase SHA-256 observation commitment. */
export declare function computeCurrentFinalizedObservationDigest(input: CurrentFinalizedObservationDigestInput): string;
/**
 * Strictly validate the complete admitted v1 observation and return an
 * immutable canonical projection. Missing/extra keys and partial-null account
 * states are rejected, as are unavailable block times and stale slots.
 */
export declare function validateCurrentFinalizedObservation(value: unknown): CurrentFinalizedObservation;
//# sourceMappingURL=current-finalized-observation.d.ts.map