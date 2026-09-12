import { type ChildProcess, type StdioOptions } from "node:child_process";
import { AmebaSdkError } from "../errors.js";
import type { JsonValue } from "../types.js";
import { type PetriOperationDefinition } from "./operations.js";
export type CliScalar = string | number | bigint;
export type CliFlagValue = CliScalar | boolean | readonly CliScalar[] | null | undefined;
export interface PetriGlobalOptions {
    backendUrl?: string;
    solanaConfig?: string;
    cluster?: string;
    commitment?: string;
    keypair?: string;
    allowInsecureKeypair?: boolean;
    quiet?: boolean;
    yes?: boolean;
    noColor?: boolean;
}
export interface PetriCommandInput {
    /** Positional values appended after the operation's command path. */
    positionals?: CliScalar | readonly CliScalar[];
    /** Flag names may be camelCase, snake_case, kebab-case, or include the leading `--`. */
    flags?: Readonly<Record<string, CliFlagValue>>;
    /** Per-call overrides for connection, wallet, and display globals. */
    global?: PetriGlobalOptions;
    /** Per-call environment additions. */
    env?: Readonly<Record<string, string | undefined>>;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBufferBytes?: number;
    cwd?: string;
}
export type PetriInput = PetriCommandInput | CliScalar | readonly CliScalar[] | undefined;
export interface PetriAdapterOptions extends PetriGlobalOptions {
    /** Petri binary used for public commands. Defaults to AMEBA_PETRI_BIN or `petri`. */
    petriPath?: string;
    /** Binary compiled with `--features developer-ops`. Defaults to petriPath. */
    developerOpsPetriPath?: string;
    cwd?: string;
    env?: Readonly<Record<string, string | undefined>>;
    timeoutMs?: number;
    maxBufferBytes?: number;
    interactiveStdio?: StdioOptions;
}
export interface PetriCommandTrace {
    binary: string;
    args: readonly string[];
    cwd?: string;
}
export declare class PetriCommandError extends AmebaSdkError {
    readonly trace: PetriCommandTrace;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    constructor(message: string, options: {
        trace: PetriCommandTrace;
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        stdout?: string;
        stderr?: string;
        cause?: unknown;
        code?: string;
    });
}
export declare class PetriInteractiveSession {
    readonly child: ChildProcess;
    readonly trace: PetriCommandTrace;
    readonly completed: Promise<{
        exitCode: number | null;
        signal: NodeJS.Signals | null;
    }>;
    constructor(child: ChildProcess, trace: PetriCommandTrace, abortSignal?: AbortSignal);
    get pid(): number | undefined;
    kill(signal?: NodeJS.Signals): boolean;
}
export interface PetriRuntimeConfig {
    publicBinary: string;
    developerBinary: string;
    global: PetriGlobalOptions;
    cwd?: string;
    env: Readonly<Record<string, string | undefined>>;
    timeoutMs: number;
    maxBufferBytes: number;
    interactiveStdio: StdioOptions;
}
export declare function runtimeConfig(options: PetriAdapterOptions): PetriRuntimeConfig;
export declare function buildInvocation(config: PetriRuntimeConfig, operation: PetriOperationDefinition, rawInput: PetriInput): {
    binary: string;
    args: string[];
    input: PetriCommandInput;
    trace: PetriCommandTrace;
};
export declare function executeBuffered(config: PetriRuntimeConfig, operation: PetriOperationDefinition, rawInput: PetriInput): Promise<JsonValue | string>;
export declare function spawnInteractive(config: PetriRuntimeConfig, operation: PetriOperationDefinition, rawInput: PetriInput): PetriInteractiveSession;
//# sourceMappingURL=process.d.ts.map