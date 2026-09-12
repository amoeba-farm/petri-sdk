import type { CapabilityDescriptor } from "./types.js";
/**
 * Stable functional capability inventory. Wallet signing, local
 * configuration, and terminal presentation remain available through the
 * explicit Petri adapter. Chain reads and transaction relay are exposed only
 * through Amoeba's read gateway and prepare-bound product routes.
 */
export declare const CAPABILITIES: Readonly<Record<string, CapabilityDescriptor>>;
export type TuiCapabilityMode = "native" | "petri" | "native-and-petri" | "presentation";
export interface TuiCapabilityDescriptor {
    readonly id: string;
    readonly mode: TuiCapabilityMode;
    readonly sdkMethods: readonly string[];
    readonly sourceEnums: Readonly<Record<string, readonly string[]>>;
}
/**
 * Functional and presentation mapping for the interactive Lab Bench. The
 * source-enum names are intentionally machine-checked against ameba_cli.
 */
export declare const TUI_CAPABILITIES: readonly TuiCapabilityDescriptor[];
export declare function capability(id: string): CapabilityDescriptor | undefined;
//# sourceMappingURL=capabilities.d.ts.map