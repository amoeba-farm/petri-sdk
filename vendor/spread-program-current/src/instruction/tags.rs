#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum VaultInstructionTag {
    Initialize = 0,
    UpdateConfig = 2,
    DepositUsdc = 3,
    InitUserCollateral = 9,
    DepositCollateral = 10,
    WithdrawCollateral = 11,
    OracleCarryForwardV1 = 30,
    CloseOracleMonth = 59,
    FinalizeOracleMonth = 75,
    FinalizeOracleOpeningPhase = 80,
    ExpireOracleOpeningSource = 81,
    AccumulateOracleRecipeBucketV2 = 84,
    FinalizeOracleRecipeWeightsV2 = 86,
    InitMarketV2 = 87,
    CreateMarketContractMintV3 = 203,
    SetMarketPaused = 89,
    InitializeSettlementSignerRegistry = 90,
    ProposeSettlementSignerRotation = 91,
    ActivateSettlementSignerRotation = 92,
    CancelSettlementSignerRotation = 93,
    ProposeEmergencySettlementSignerRecovery = 94,
    UpsertMarketPageV2 = 96,
    RotateVaultAuthoritiesV2 = 109,
    ConfigureOracleEconomicsTemplateV2 = 110,
    AccumulateOracleSettlementSourceBucket = 113,
    UpsertSettlementV3 = 116,
    BeginOracleActiveWeights = 121,
    AccumulateOracleActiveWeightGroup = 122,
    FinalizeOracleActiveWeights = 124,
    BootstrapVaultGovernanceV2 = 128,
    ActivateVaultV2 = 129,
    AdminAssistedWithdrawCollateral = 140,
    InitializeOracleUsdcRewardVault = 154,
    DepositOracleUsdcRewards = 155,
    BeginOracleUsdcRewardSchedule = 156,
    AddOracleUsdcSkuBudget = 157,
    FinalizeOracleUsdcRewardSchedule = 158,
    ManageWriterDlmmV1 = 159,
    ManageWriterParticipationV2 = 160,
    ChallengeOracleSourceV2 = 161,
    SubmitOracleOpeningClaimV2 = 162,
    ChallengeOracleOpeningClaimV2 = 163,
    ResolveOracleOpeningClaimChallengeV2 = 164,
    FinalizeOracleOpeningClaimV2 = 165,
    CommitOracleUpdateClaimV3 = 166,
    SettleExpiredOracleUpdateCommitmentV3 = 167,
    ChallengeOracleUpdateClaimV2 = 168,
    SettleOracleUsdcEscrow = 169,
    RegisterOracleUsdcRewardSource = 170,
    RegisterOracleUsdcRewardUpdate = 171,
    FinalizeOracleUsdcRewardEntitlements = 173,
    ClaimOracleUsdcReward = 174,
    InitializeOracleMonthV5 = 181,
    ProposeOracleSourceV3 = 182,
    SupportOracleSourceV3 = 183,
    FinalizeOracleSkuCoverage = 184,
    ResolveOracleSourceChallengeV2 = 185,
    ReopenOracleSkuCoverage = 186,
    BeginOracleRecipeWeightsV3 = 187,
    ManageDlmmOrdersV1 = 188,
    ConfigureOracleProductSkuManifest = 190,
    ExpireUnlistableOracleSourceV2 = 191,
    CancelStaleOracleSourceChallengeV2 = 192,
    SettleFailedOracleMonthEscrowV2 = 194,
    AbortOracleUsdcRewardScheduleV2 = 195,
    TimeoutUnsupportedOracleSourceV2 = 196,
    RecomputeOracleBucketMedianV1 = 197,
    RevealOracleUpdateClaimV3 = 198,
    FinalizeOracleUpdateClaimV2 = 199,
    IndexOracleRecipeSourceV1 = 200,
    CancelStaleOracleUpdateClaimV2 = 201,
    ExecuteCompressedStateV1 = 205,
    InitializeWriterPolicyRegistryV1 = 220,
    ManageWriterPolicyAuthorityV1 = 221,
    InitializeWriterSettlementGroupV1 = 222,
    InitializeWriterSleeveV1 = 223,
    RegisterWriterSeriesV1 = 224,
    SealWriterPolicyV1 = 225,
    OpenWriterFundingV1 = 226,
    ActivateWriterSleeveV1 = 229,
    SetCollectiveMarketPausedV1 = 230,
    ReconcileWriterSupplyV1 = 231,
    CleanupWriterCustodyV1 = 232,
    PublishWriterGroupSettlementV1 = 244,
    FinalizeWriterSleeveSettlementV1 = 245,
    ClaimCollectiveLongV1 = 246,
    CloseWriterSleeveV1 = 248,
    ScopedCollectiveSettlementV1 = 250,
    ScopedPositionSettlementV1 = 251,
}

impl VaultInstructionTag {
    pub fn from_byte(tag: u8) -> Option<Self> {
        const VALID_TAGS: [u64; 4] = [
            0x800000040000e0d,
            0x161260017ed30800,
            0xdfe06ffffc001003,
            0xd7001e7f0002bfd,
        ];
        let bit = 1u64 << (tag & 63);
        if VALID_TAGS[usize::from(tag >> 6)] & bit == 0 {
            None
        } else {
            // SAFETY: the bitmap contains exactly the declared repr(u8) discriminants above.
            Some(unsafe { core::mem::transmute::<u8, Self>(tag) })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::VaultInstructionTag;
    use crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag;

    #[test]
    fn vault_and_dlmm_tag_spaces_are_globally_disjoint() {
        for byte in 0u8..=u8::MAX {
            assert!(
                VaultInstructionTag::from_byte(byte).is_none()
                    || AmoebaDlmmInstructionTag::from_byte(byte).is_none(),
                "instruction byte {byte} is claimed twice"
            );
        }
    }

    #[test]
    fn collective_writer_ranges_and_reserved_holes_are_exact() {
        for byte in 220u8..=251 {
            assert_eq!(
                VaultInstructionTag::from_byte(byte).is_some(),
                ![227, 228, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 247, 249]
                    .contains(&byte)
            );
        }
        for byte in 250u8..=251 {
            assert!(VaultInstructionTag::from_byte(byte).is_some());
            assert!(AmoebaDlmmInstructionTag::from_byte(byte).is_none());
        }
        for byte in 252u8..=255 {
            assert!(AmoebaDlmmInstructionTag::from_byte(byte).is_some());
        }
    }

    #[test]
    fn unknown_bytes_remain_unassigned_in_both_instruction_spaces() {
        for byte in [29u8, 31, 34, 35, 69, 97, 189, 204, 206, 211, 212, 214] {
            assert!(VaultInstructionTag::from_byte(byte).is_none());
            assert!(AmoebaDlmmInstructionTag::from_byte(byte).is_none());
        }
    }
}
