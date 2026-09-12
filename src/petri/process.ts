import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { isAbsolute } from "node:path";
import process from "node:process";

import { normalizeAmoebaBackendUrl } from "../endpoint-policy.js";
import { AmebaInputError, AmebaSdkError, sanitizeDisplayText } from "../errors.js";
import type { JsonValue } from "../types.js";
import { OPERATIONS, type PetriOperationDefinition } from "./operations.js";

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

export class PetriCommandError extends AmebaSdkError {
  readonly trace: PetriCommandTrace;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    message: string,
    options: {
      trace: PetriCommandTrace;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout?: string;
      stderr?: string;
      cause?: unknown;
      code?: string;
    },
  ) {
    super(message, { code: options.code ?? "PETRI_COMMAND_ERROR", cause: options.cause });
    this.trace = options.trace;
    this.exitCode = options.exitCode;
    this.signal = options.signal;
    this.stdout = sanitizeDisplayText(options.stdout ?? "", 65_536);
    this.stderr = sanitizeDisplayText(options.stderr ?? "", 65_536);
  }
}

export class PetriInteractiveSession {
  readonly child: ChildProcess;
  readonly trace: PetriCommandTrace;
  readonly completed: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;

  constructor(
    child: ChildProcess,
    trace: PetriCommandTrace,
    abortSignal?: AbortSignal,
  ) {
    this.child = child;
    this.trace = trace;
    this.completed = new Promise((resolve, reject) => {
      child.once("error", (cause) => {
        const aborted = abortSignal?.aborted || isAbortError(cause);
        reject(
          new PetriCommandError(
            aborted
              ? "Interactive Petri was aborted by the caller"
              : `Could not start Petri: ${errorMessage(cause)}`,
            {
              trace,
              exitCode: null,
              signal: null,
              cause,
              code: aborted
                ? "PETRI_ABORTED"
                : isEnoent(cause)
                  ? "PETRI_NOT_FOUND"
                  : "PETRI_SPAWN_ERROR",
            },
          ),
        );
      });
      child.once("close", (exitCode, signal) => {
        if (exitCode !== 0) {
          reject(
            new PetriCommandError(`Interactive Petri exited with status ${String(exitCode)}`, {
              trace,
              exitCode,
              signal,
            }),
          );
          return;
        }
        resolve({ exitCode, signal });
      });
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    return this.child.kill(signal);
  }
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

export function runtimeConfig(options: PetriAdapterOptions): PetriRuntimeConfig {
  const publicBinary = nonempty(
    options.petriPath ?? process.env.AMEBA_PETRI_BIN ?? "petri",
    "petriPath",
  );
  return {
    publicBinary,
    developerBinary: nonempty(options.developerOpsPetriPath ?? publicBinary, "developerOpsPetriPath"),
    global: pickGlobalOptions(options),
    cwd: options.cwd,
    env: Object.freeze({ ...(options.env ?? {}) }),
    timeoutMs: positiveInteger(options.timeoutMs ?? 120_000, "timeoutMs"),
    maxBufferBytes: positiveInteger(options.maxBufferBytes ?? 16 * 1024 * 1024, "maxBufferBytes"),
    interactiveStdio: options.interactiveStdio ?? "inherit",
  };
}

export function buildInvocation(
  config: PetriRuntimeConfig,
  operation: PetriOperationDefinition,
  rawInput: PetriInput,
): {
  binary: string;
  args: string[];
  input: PetriCommandInput;
  trace: PetriCommandTrace;
} {
  const input = normalizeInput(rawInput);
  const global = { ...config.global, ...(input.global ?? {}) };
  const configuredBinary =
    operation.availability === "developer-ops"
      ? config.developerBinary
      : config.publicBinary;
  if (operation.effect !== "read" && !isAbsolute(configuredBinary)) {
    throw new AmebaInputError(
      `${operation.id} requires an absolute Petri binary path because it is not read-only`,
    );
  }
  const positionals = positionalArgs(input.positionals);
  if (positionals.length > 0 && isCommandPrefix(operation)) {
    throw new AmebaInputError(
      `${operation.id} does not accept positional arguments because they could select another Petri command`,
    );
  }
  const commandArgs = [
    ...globalArgs(global),
    ...(operation.output === "json" ? ["--json", ...(global.quiet ? [] : ["--quiet"])] : []),
    ...operation.command,
    ...positionals,
    ...flagArgs(input.flags ?? {}),
  ];
  const { binary, args } = executableInvocation(configuredBinary, commandArgs);
  const trace = Object.freeze({
    binary: sanitizeDisplayText(binary),
    args: Object.freeze(redactTraceArgs(args)),
    cwd: input.cwd === undefined && config.cwd === undefined
      ? undefined
      : sanitizeDisplayText(input.cwd ?? config.cwd!),
  });
  return { binary, args, input, trace };
}

export async function executeBuffered(
  config: PetriRuntimeConfig,
  operation: PetriOperationDefinition,
  rawInput: PetriInput,
): Promise<JsonValue | string> {
  const invocation = buildInvocation(config, operation, rawInput);
  const timeoutMs = positiveInteger(invocation.input.timeoutMs ?? config.timeoutMs, "timeoutMs");
  const maxBufferBytes = positiveInteger(
    invocation.input.maxBufferBytes ?? config.maxBufferBytes,
    "maxBufferBytes",
  );
  const result = await bufferedProcess(invocation.binary, invocation.args, {
    trace: invocation.trace,
    cwd: invocation.input.cwd ?? config.cwd,
    env: mergeEnvironment(config.env, invocation.input.env),
    signal: invocation.input.signal,
    timeoutMs,
    maxBufferBytes,
  });
  if (result.exitCode !== 0) {
    throw new PetriCommandError(
      result.stderr.trim() || `Petri exited with status ${String(result.exitCode)}`,
      {
        trace: invocation.trace,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    );
  }
  if (operation.output === "json") return parsePetriJson(result.stdout, invocation.trace);
  return result.stdout.replace(/\s+$/, "");
}

export function spawnInteractive(
  config: PetriRuntimeConfig,
  operation: PetriOperationDefinition,
  rawInput: PetriInput,
): PetriInteractiveSession {
  const invocation = buildInvocation(config, operation, rawInput);
  const child = spawn(invocation.binary, invocation.args, {
    cwd: invocation.input.cwd ?? config.cwd,
    env: mergeEnvironment(config.env, invocation.input.env),
    shell: false,
    stdio: config.interactiveStdio,
    signal: invocation.input.signal,
  });
  return new PetriInteractiveSession(
    child,
    invocation.trace,
    invocation.input.signal,
  );
}

function normalizeInput(raw: PetriInput): PetriCommandInput {
  if (raw === undefined) return {};
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "bigint") {
    return { positionals: [raw] };
  }
  if (Array.isArray(raw)) return { positionals: raw };
  if (typeof raw === "object" && raw !== null) return raw as PetriCommandInput;
  throw new AmebaInputError("Petri operation input must be a scalar, scalar array, or command input object");
}

function globalArgs(global: PetriGlobalOptions): string[] {
  const args: string[] = [];
  addOption(
    args,
    "backend-url",
    global.backendUrl === undefined
      ? undefined
      : normalizeAmoebaBackendUrl(global.backendUrl).toString(),
  );
  addOption(args, "solana-config", global.solanaConfig);
  addOption(args, "cluster", global.cluster);
  addOption(args, "commitment", global.commitment);
  addOption(args, "keypair", global.keypair);
  if (global.allowInsecureKeypair) args.push("--allow-insecure-keypair");
  if (global.quiet) args.push("--quiet");
  if (global.yes) args.push("--yes");
  if (global.noColor) args.push("--no-color");
  return args;
}

function flagArgs(flags: Readonly<Record<string, CliFlagValue>>): string[] {
  const args: string[] = [];
  for (const [rawName, value] of Object.entries(flags)) {
    const name = normalizedFlagName(rawName);
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      args.push(name);
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) args.push(name, scalar(item, `flag ${name}`));
  }
  return args;
}

function positionalArgs(positionals: PetriCommandInput["positionals"]): string[] {
  if (positionals === undefined) return [];
  const values = Array.isArray(positionals) ? positionals : [positionals];
  return values.map((value, index) => scalar(value, `positional ${index + 1}`));
}

function normalizedFlagName(raw: string): string {
  const trimmed = raw.trim().replace(/^--/, "");
  if (!trimmed || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed)) {
    throw new AmebaInputError(`Invalid Petri flag name: ${raw}`);
  }
  const kebab = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  return `--${kebab}`;
}

function scalar(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  throw new AmebaInputError(`${label} must be a string, finite number, or bigint`);
}

function addOption(args: string[], name: string, value: string | undefined): void {
  if (value !== undefined) args.push(`--${name}`, nonempty(value, name));
}

function pickGlobalOptions(options: PetriAdapterOptions): PetriGlobalOptions {
  return {
    backendUrl: options.backendUrl,
    solanaConfig: options.solanaConfig,
    cluster: options.cluster,
    commitment: options.commitment,
    keypair: options.keypair,
    allowInsecureKeypair: options.allowInsecureKeypair,
    quiet: options.quiet,
    yes: options.yes,
    noColor: options.noColor,
  };
}

function executableInvocation(
  configuredBinary: string,
  args: string[],
): { binary: string; args: string[] } {
  if (/\.(?:c?js|mjs)$/i.test(configuredBinary)) {
    return { binary: process.execPath, args: [configuredBinary, ...args] };
  }
  return { binary: configuredBinary, args };
}

function mergeEnvironment(
  base: Readonly<Record<string, string | undefined>>,
  call: Readonly<Record<string, string | undefined>> | undefined,
): NodeJS.ProcessEnv {
  const result = safeInheritedEnvironment();
  for (const source of [base, call ?? {}]) {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) delete result[key];
      else result[key] = value;
    }
  }
  for (const name of [
    "SOLANA_RPC_URL",
    "HELIUS_RPC_URL",
    "HELIUS_API_KEY",
    "HELIUS_NETWORK",
    "PHOTON_RPC_URL",
    "PHOTON_PROVIDER_ORIGIN_SHA256",
    "LIGHT_PROVIDER_URL",
    "NEXT_PUBLIC_SOLANA_RPC_URL",
    "NEXT_PUBLIC_HELIUS_RPC_URL",
    "NEXT_PUBLIC_PHOTON_RPC_URL",
    "NEXT_PUBLIC_LIGHT_PROVIDER_URL",
  ]) delete result[name];
  return result;
}

function safeInheritedEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const allowed = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_[A-Z0-9_]+|TERM|COLORTERM|NO_COLOR|FORCE_COLOR)$/i;
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.test(key)) result[key] = value;
  }
  return result;
}

function isCommandPrefix(operation: PetriOperationDefinition): boolean {
  return OPERATIONS.some((candidate) =>
    candidate.id !== operation.id
    && candidate.availability === operation.availability
    && candidate.command.length > operation.command.length
    && operation.command.every((segment, index) => candidate.command[index] === segment));
}

const SECRET_FLAGS = new Set([
  "--salt",
  "--secret-salt",
  "--secret-salt-hex",
  "--token",
  "--password",
  "--secret",
  "--api-key",
  "--authorization",
  "--keypair",
]);

function redactTraceArgs(args: readonly string[]): string[] {
  const redacted: string[] = [];
  let hideNext = false;
  for (const raw of args) {
    const value = sanitizeDisplayText(raw);
    if (hideNext) {
      redacted.push("[REDACTED]");
      hideNext = false;
      continue;
    }
    const equals = value.indexOf("=");
    const flag = (equals === -1 ? value : value.slice(0, equals)).toLowerCase();
    if (SECRET_FLAGS.has(flag)) {
      redacted.push(equals === -1 ? value : `${value.slice(0, equals + 1)}[REDACTED]`);
      hideNext = equals === -1;
      continue;
    }
    redacted.push(redactUrlQuery(value));
  }
  return redacted;
}

function redactUrlQuery(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    if (url.search) url.search = "?[REDACTED]";
    if (url.hash) url.hash = "#[REDACTED]";
    return url.toString();
  } catch {
    return value;
  }
}

async function bufferedProcess(
  binary: string,
  args: readonly string[],
  options: {
    trace: PetriCommandTrace;
    cwd?: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeoutMs: number;
    maxBufferBytes: number;
  },
): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(
      () => {
        timedOut = true;
        controller.abort(
          new Error(`Petri command timed out after ${options.timeoutMs}ms`),
        );
      },
      options.timeoutMs,
    );
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal: controller.signal,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    };
    const fail = (error: PetriCommandError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const capture = (target: Buffer[], chunk: Buffer, stream: "stdout" | "stderr") => {
      if (stream === "stdout") stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes > options.maxBufferBytes) {
        child.kill("SIGKILL");
        fail(
          new PetriCommandError(`Petri output exceeded ${options.maxBufferBytes} bytes`, {
            trace: options.trace,
            exitCode: null,
            signal: null,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            code: "PETRI_MAX_BUFFER",
          }),
        );
        return;
      }
      target.push(chunk);
    };
    child.stdout?.on("data", (chunk: Buffer) => capture(stdout, chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => capture(stderr, chunk, "stderr"));
    child.once("error", (cause) => {
      const callerAborted = options.signal?.aborted ?? false;
      const code = callerAborted
        ? "PETRI_ABORTED"
        : timedOut
          ? "PETRI_TIMEOUT"
          : isEnoent(cause)
            ? "PETRI_NOT_FOUND"
            : "PETRI_SPAWN_ERROR";
      const message = callerAborted
        ? "Petri command was aborted by the caller"
        : timedOut
          ? `Petri command timed out after ${options.timeoutMs}ms`
          : `Could not run Petri: ${errorMessage(cause)}`;
      fail(
        new PetriCommandError(message, {
          trace: options.trace,
          exitCode: null,
          signal: null,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          cause,
          code,
        }),
      );
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function parsePetriJson(stdout: string, trace: PetriCommandTrace): JsonValue {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch (cause) {
    throw new PetriCommandError("Petri did not return valid JSON", {
      trace,
      exitCode: 0,
      signal: null,
      stdout,
      cause,
      code: "PETRI_INVALID_JSON",
    });
  }
}

function nonempty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new AmebaInputError(`${label} must not be empty`);
  return trimmed;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AmebaInputError(`${label} must be a positive safe integer`);
  }
  return value;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
