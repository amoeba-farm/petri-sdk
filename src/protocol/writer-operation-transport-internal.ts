import preset from "./writer-operation-transport.v1.json" with { type: "json" };
import { sha256Canonical } from "../wallet/codec.js";

/** One source object shared with Rust include_str!, never caller policy. */
export const WRITER_OPERATION_TRANSPORT_V1 = Object.freeze({
  ...preset,
  instructionTags: Object.freeze([...preset.instructionTags]),
  setupInstructionDataBase64: Object.freeze([...preset.setupInstructionDataBase64]),
});
export const WRITER_OPERATION_TRANSPORT_SHA256_V1 = sha256Canonical(WRITER_OPERATION_TRANSPORT_V1);

export function isExactWriterOperationTransportV1(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(WRITER_OPERATION_TRANSPORT_V1);
  return Object.keys(record).length === entries.length && entries.every(([key, expected]) => {
    const actual = record[key];
    return Array.isArray(expected)
      ? Array.isArray(actual) && actual.length === expected.length
        && expected.every((item, index) => actual[index] === item)
      : actual === expected;
  });
}
