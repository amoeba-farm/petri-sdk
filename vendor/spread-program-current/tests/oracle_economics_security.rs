use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{
    constants::{ORACLE_PRE_LISTING_WINDOW_SECONDS, RAMX_ORACLE_PRODUCT_SKU_COUNT},
    instruction::{
        ConfigureOracleEconomicsTemplateV2Params, InitializeOracleMonthV5Params, VaultInstruction,
        VaultInstructionTag,
    },
    state::OracleEconomicParams,
};

#[test]
fn economics_remain_a_versioned_future_month_template() {
    let instruction = VaultInstruction::ConfigureOracleEconomicsTemplateV2 {
        params: ConfigureOracleEconomicsTemplateV2Params {
            expected_config_version: 7,
            economics: OracleEconomicParams::default(),
        },
    };
    let encoded = instruction.try_to_vec().unwrap();
    assert_eq!(
        encoded[0],
        VaultInstructionTag::ConfigureOracleEconomicsTemplateV2 as u8
    );
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded).unwrap(),
        instruction
    );
}

#[test]
fn v5_is_the_only_constructible_month_initializer() {
    let scramble_start_ts = 1_777_478_400;
    let instruction = VaultInstruction::InitializeOracleMonthV5 {
        params: InitializeOracleMonthV5Params {
            scramble_start_ts,
            listing_ts: scramble_start_ts + ORACLE_PRE_LISTING_WINDOW_SECONDS,
            settlement_base_oracle_atomic: 10_000,
            required_sku_root: [7; 32],
            required_sku_count: RAMX_ORACLE_PRODUCT_SKU_COUNT,
        },
    };
    let encoded = instruction.try_to_vec().unwrap();
    assert_eq!(
        encoded[0],
        VaultInstructionTag::InitializeOracleMonthV5 as u8
    );
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded).unwrap(),
        instruction
    );
}
