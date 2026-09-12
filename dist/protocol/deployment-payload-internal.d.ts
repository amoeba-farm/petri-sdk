/** Exact receipt fields, never a caller-selected padding allowance. */
export interface DeploymentPayloadIdentityV1 {
    readonly artifactBytes: number;
    readonly artifactSha256: string;
    readonly programDataPayloadBytes: number;
    readonly programDataPayloadSha256: string;
    readonly mandatoryZeroPaddingBytes: number;
}
export declare function assertExactDeploymentPayloadV1(payload: Uint8Array, identity: DeploymentPayloadIdentityV1): Promise<void>;
//# sourceMappingURL=deployment-payload-internal.d.ts.map