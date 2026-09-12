/** Browser-native canonical codecs used by the fail-closed wallet boundary. */
export declare class CurrentWalletError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function walletError(code: string, message: string): never;
export declare function exactObject(value: unknown, required: readonly string[], optional?: readonly string[], label?: string): Readonly<Record<string, unknown>>;
export declare function exactArray(value: unknown, label: string, minimum: number, maximum: number): readonly unknown[];
export declare function canonicalPublicKeyString(value: unknown, label: string, parse: (value: string) => string): string;
export declare function canonicalDigest(value: unknown, label: string): string;
export declare function canonicalU64(value: unknown, label: string, positive?: boolean): string;
export declare function canonicalIndex(value: unknown, label: string, maximum: number): number;
export declare function decodeBase64(value: unknown, label: string, maximumBytes?: number): Uint8Array;
export declare function encodeBase64(bytes: Uint8Array): string;
export declare function equalBytes(left: Uint8Array, right: Uint8Array): boolean;
export declare function readU16Le(bytes: Uint8Array, offset: number): number;
export declare function readU32Le(bytes: Uint8Array, offset: number): number;
export declare function readU64Le(bytes: Uint8Array, offset: number): bigint;
export declare function u64Le(value: bigint): Uint8Array;
export declare function canonicalJson(value: unknown): string;
export declare function sha256Canonical(value: unknown): string;
export interface CanonicalJsonSnapshot<Value> {
    readonly value: Value;
    readonly canonicalJson: string;
    readonly sha256: string;
}
/** Copy caller-owned JSON into a deeply frozen canonical graph before async work. */
export declare function snapshotCanonicalJson<Value = unknown>(value: unknown, label: string, maximumCharacters?: number): CanonicalJsonSnapshot<Value>;
/** Small synchronous SHA-256 implementation shared by browser validation and observation hashing. */
export declare function sha256Hex(bytes: Uint8Array): string;
//# sourceMappingURL=codec.d.ts.map