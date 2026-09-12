import { AmebaProtocolError } from "../errors.js";

/** Exact receipt fields, never a caller-selected padding allowance. */
export interface DeploymentPayloadIdentityV1 {
  readonly artifactBytes: number;
  readonly artifactSha256: string;
  readonly programDataPayloadBytes: number;
  readonly programDataPayloadSha256: string;
  readonly mandatoryZeroPaddingBytes: number;
}

export async function assertExactDeploymentPayloadV1(
  payload: Uint8Array,
  identity: DeploymentPayloadIdentityV1,
): Promise<void> {
  const fail = (): never => { throw new AmebaProtocolError("ProgramData payload differs from the exact artifact, capacity, or mandatory zero padding", {code:"CURRENT_V3_DEPLOYMENT_INVALID"}); };
  if (!Number.isSafeInteger(identity.artifactBytes) || identity.artifactBytes <= 0
    || !Number.isSafeInteger(identity.mandatoryZeroPaddingBytes) || identity.mandatoryZeroPaddingBytes < 0
    || !Number.isSafeInteger(identity.programDataPayloadBytes)
    || identity.artifactBytes + identity.mandatoryZeroPaddingBytes !== identity.programDataPayloadBytes
    || payload.length !== identity.programDataPayloadBytes) fail();
  const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))))
    .map(byte => byte.toString(16).padStart(2,"0")).join("");
  if (payload.subarray(identity.artifactBytes).some(byte => byte !== 0)
    || await digest(payload.subarray(0,identity.artifactBytes)) !== identity.artifactSha256
    || await digest(payload) !== identity.programDataPayloadSha256) fail();
}
