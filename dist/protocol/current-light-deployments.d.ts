export interface CurrentLightProgramDeployment {
    readonly programId: string;
    readonly programDataAddress: string;
    readonly programDataBytes: number;
    readonly upgradeAuthority: string;
    readonly deployedSlot: number;
    readonly payloadBytes: number;
    readonly payloadSha256: string;
}
/**
 * Finalized devnet Light deployments reviewed for the rc.44 boundary.
 *
 * Any linked-program upgrade intentionally fails chain identity until these
 * code identities are reviewed and repinned.
 */
export declare const CURRENT_LIGHT_PROGRAM_DEPLOYMENTS: Readonly<{
    tokenProgram: Readonly<{
        readonly programId: "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m";
        readonly programDataAddress: "GZ569jyYVcXnC6CLhA1ahfgNVZfSLtcMzrbcpjR438fy";
        readonly programDataBytes: 1260773;
        readonly upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1";
        readonly deployedSlot: 447569186;
        readonly payloadBytes: 1260728;
        readonly payloadSha256: "b553fa05658057b18e44e8b563b12c718f64a0dc778e3c384e4e1b80860c66fc";
    }>;
    systemProgram: Readonly<{
        readonly programId: "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7";
        readonly programDataAddress: "Hohi6858RKfUZaS3BGTgKyX2Qt2wEDNey2aPZTXUChQz";
        readonly programDataBytes: 763317;
        readonly upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1";
        readonly deployedSlot: 447569142;
        readonly payloadBytes: 763272;
        readonly payloadSha256: "320360deb66a48c4a7a214d75e9032cb835b46b7535b9433117f460b412bb9bb";
    }>;
    accountCompressionProgram: Readonly<{
        readonly programId: "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq";
        readonly programDataAddress: "CyXYH8FjQgDnW32c5FiJrKsP5gwoqpaEPL6nHt5GGMMz";
        readonly programDataBytes: 891845;
        readonly upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1";
        readonly deployedSlot: 448021881;
        readonly payloadBytes: 891800;
        readonly payloadSha256: "10d40538964e25288c4134853bb09d396d80d07200e29a0f482707569336a821";
    }>;
    compressibleConfigProgram: Readonly<{
        readonly programId: "Lighton6oQpVkeewmo2mcPTQQp7kYHr4fWpAgJyEmDX";
        readonly programDataAddress: "5GtYC3PY8YDoVvySNJez66Jpd1T3jsQwJX82A1GsudgR";
        readonly programDataBytes: 960037;
        readonly upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1";
        readonly deployedSlot: 449230205;
        readonly payloadBytes: 959992;
        readonly payloadSha256: "eec9e26044dbfecfadccf7b881d76d6463293572154b290768bda6ebb3682595";
    }>;
}>;
export declare const CURRENT_LIGHT_PROGRAM_DEPLOYMENT_ORDER: readonly [Readonly<{
    readonly programId: "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m";
    readonly programDataAddress: "GZ569jyYVcXnC6CLhA1ahfgNVZfSLtcMzrbcpjR438fy";
    readonly programDataBytes: 1260773;
    readonly upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1";
    readonly deployedSlot: 447569186;
    readonly payloadBytes: 1260728;
    readonly payloadSha256: "b553fa05658057b18e44e8b563b12c718f64a0dc778e3c384e4e1b80860c66fc";
}>, Readonly<{
    readonly programId: "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7";
    readonly programDataAddress: "Hohi6858RKfUZaS3BGTgKyX2Qt2wEDNey2aPZTXUChQz";
    readonly programDataBytes: 763317;
    readonly upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1";
    readonly deployedSlot: 447569142;
    readonly payloadBytes: 763272;
    readonly payloadSha256: "320360deb66a48c4a7a214d75e9032cb835b46b7535b9433117f460b412bb9bb";
}>, Readonly<{
    readonly programId: "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq";
    readonly programDataAddress: "CyXYH8FjQgDnW32c5FiJrKsP5gwoqpaEPL6nHt5GGMMz";
    readonly programDataBytes: 891845;
    readonly upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1";
    readonly deployedSlot: 448021881;
    readonly payloadBytes: 891800;
    readonly payloadSha256: "10d40538964e25288c4134853bb09d396d80d07200e29a0f482707569336a821";
}>, Readonly<{
    readonly programId: "Lighton6oQpVkeewmo2mcPTQQp7kYHr4fWpAgJyEmDX";
    readonly programDataAddress: "5GtYC3PY8YDoVvySNJez66Jpd1T3jsQwJX82A1GsudgR";
    readonly programDataBytes: 960037;
    readonly upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1";
    readonly deployedSlot: 449230205;
    readonly payloadBytes: 959992;
    readonly payloadSha256: "eec9e26044dbfecfadccf7b881d76d6463293572154b290768bda6ebb3682595";
}>];
//# sourceMappingURL=current-light-deployments.d.ts.map