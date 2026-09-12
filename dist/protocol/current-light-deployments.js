const deployment = (value) => Object.freeze(value);
/**
 * Finalized devnet Light deployments reviewed for the rc.44 boundary.
 *
 * Any linked-program upgrade intentionally fails chain identity until these
 * code identities are reviewed and repinned.
 */
export const CURRENT_LIGHT_PROGRAM_DEPLOYMENTS = Object.freeze({
    tokenProgram: deployment({
        programId: "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m",
        programDataAddress: "GZ569jyYVcXnC6CLhA1ahfgNVZfSLtcMzrbcpjR438fy",
        programDataBytes: 1_260_773,
        upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1",
        deployedSlot: 447_569_186,
        payloadBytes: 1_260_728,
        payloadSha256: "b553fa05658057b18e44e8b563b12c718f64a0dc778e3c384e4e1b80860c66fc",
    }),
    systemProgram: deployment({
        programId: "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
        programDataAddress: "Hohi6858RKfUZaS3BGTgKyX2Qt2wEDNey2aPZTXUChQz",
        programDataBytes: 763_317,
        upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1",
        deployedSlot: 447_569_142,
        payloadBytes: 763_272,
        payloadSha256: "320360deb66a48c4a7a214d75e9032cb835b46b7535b9433117f460b412bb9bb",
    }),
    accountCompressionProgram: deployment({
        programId: "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq",
        programDataAddress: "CyXYH8FjQgDnW32c5FiJrKsP5gwoqpaEPL6nHt5GGMMz",
        programDataBytes: 891_845,
        upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1",
        deployedSlot: 448_021_881,
        payloadBytes: 891_800,
        payloadSha256: "10d40538964e25288c4134853bb09d396d80d07200e29a0f482707569336a821",
    }),
    compressibleConfigProgram: deployment({
        programId: "Lighton6oQpVkeewmo2mcPTQQp7kYHr4fWpAgJyEmDX",
        programDataAddress: "5GtYC3PY8YDoVvySNJez66Jpd1T3jsQwJX82A1GsudgR",
        programDataBytes: 960_037,
        upgradeAuthority: "87k7P4H8dJPSEZ1mdA8gQDtiLWXRF6SiZzUMXsYJY7T1",
        deployedSlot: 449_230_205,
        payloadBytes: 959_992,
        payloadSha256: "eec9e26044dbfecfadccf7b881d76d6463293572154b290768bda6ebb3682595",
    }),
});
export const CURRENT_LIGHT_PROGRAM_DEPLOYMENT_ORDER = Object.freeze([
    CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.tokenProgram,
    CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.systemProgram,
    CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.accountCompressionProgram,
    CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.compressibleConfigProgram,
]);
//# sourceMappingURL=current-light-deployments.js.map