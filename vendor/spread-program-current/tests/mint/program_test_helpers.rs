use super::*;

pub(super) async fn create_mint(
    context: &mut ProgramTestContext,
    mint_authority: &Pubkey,
    decimals: u8,
) -> Pubkey {
    let mint = Keypair::new();
    let rent = context.banks_client.get_rent().await.unwrap();

    let create_ix = system_instruction::create_account(
        &context.payer.pubkey(),
        &mint.pubkey(),
        rent.minimum_balance(Mint::LEN),
        Mint::LEN as u64,
        &spl_token::id(),
    );

    let init_ix = token_instruction::initialize_mint2(
        &spl_token::id(),
        &mint.pubkey(),
        mint_authority,
        None,
        decimals,
    )
    .unwrap();

    send_ixs(context, vec![create_ix, init_ix], &[&mint])
        .await
        .unwrap();
    mint.pubkey()
}

pub(super) async fn create_token_account(
    context: &mut ProgramTestContext,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Pubkey {
    let token_account = Keypair::new();
    let rent = context.banks_client.get_rent().await.unwrap();

    let create_ix = system_instruction::create_account(
        &context.payer.pubkey(),
        &token_account.pubkey(),
        rent.minimum_balance(TokenAccountState::LEN),
        TokenAccountState::LEN as u64,
        &spl_token::id(),
    );

    let init_ix = token_instruction::initialize_account3(
        &spl_token::id(),
        &token_account.pubkey(),
        mint,
        owner,
    )
    .unwrap();

    send_ixs(context, vec![create_ix, init_ix], &[&token_account])
        .await
        .unwrap();
    token_account.pubkey()
}

pub(super) async fn mint_to(
    context: &mut ProgramTestContext,
    mint: &Pubkey,
    destination: &Pubkey,
    mint_authority: &Keypair,
    amount: u64,
) {
    let mint_ix = token_instruction::mint_to(
        &spl_token::id(),
        mint,
        destination,
        &mint_authority.pubkey(),
        &[],
        amount,
    )
    .unwrap();

    send_ix(context, mint_ix, &[mint_authority]).await.unwrap();
}

pub(super) async fn fund_account(
    context: &mut ProgramTestContext,
    recipient: &Pubkey,
    lamports: u64,
) {
    let transfer_ix = system_instruction::transfer(&context.payer.pubkey(), recipient, lamports);
    send_ix(context, transfer_ix, &[]).await.unwrap();
}

pub(super) async fn warp_to_unix_timestamp_at_least(
    context: &mut ProgramTestContext,
    target_unix: u64,
) {
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let now = if clock.unix_timestamp < 0 {
        0
    } else {
        clock.unix_timestamp as u64
    };
    if now >= target_unix {
        return;
    }

    context.warp_to_slot(clock.slot.saturating_add(1)).unwrap();
    let mut warped_clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    warped_clock.unix_timestamp = target_unix as i64;
    context.set_sysvar(&warped_clock);
}

pub(super) async fn advance_program_test_blockhash(context: &mut ProgramTestContext) {
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    context.warp_to_slot(clock.slot.saturating_add(1)).unwrap();
}

pub(super) async fn token_balance(context: &mut ProgramTestContext, token_account: Pubkey) -> u64 {
    let account = context
        .banks_client
        .get_account(token_account)
        .await
        .unwrap()
        .expect("token account exists");
    let token = TokenAccountState::unpack(&account.data[..TokenAccountState::LEN]).unwrap();
    token.amount
}

pub(super) async fn mint_supply(context: &mut ProgramTestContext, mint: Pubkey) -> u64 {
    let account = context
        .banks_client
        .get_account(mint)
        .await
        .unwrap()
        .expect("mint account exists");
    Mint::unpack(&account.data[..Mint::LEN]).unwrap().supply
}

pub(super) fn extend_as_light_mint(data: &mut Vec<u8>) {
    assert_eq!(data.len(), Mint::LEN);
    data.resize(263, 0);
    data[165] = 1;
}

pub(super) fn extend_as_light_token_account(data: &mut Vec<u8>) {
    assert_eq!(data.len(), TokenAccountState::LEN);
    data.push(2);
    data.push(1);
    data.extend_from_slice(&1_u32.to_le_bytes());
    data.push(32);
    data.resize(272, 0);
}

pub(super) async fn set_program_state<T: BorshSerialize>(
    context: &mut ProgramTestContext,
    address: Pubkey,
    value: &T,
    len: usize,
) {
    set_borsh_account(context, address, &light_token_minter::id(), value, len).await;
}

pub(super) async fn set_vault_paused_fixture(
    context: &mut ProgramTestContext,
    vault_pda: Pubkey,
    paused: bool,
) {
    let mut config: VaultConfig = read_program_state(context, vault_pda).await;
    config.paused = paused;
    set_program_state(context, vault_pda, &config, VaultConfig::LEN).await;
    advance_program_test_blockhash(context).await;
}

#[allow(dead_code)]
pub(super) async fn install_finalized_sku_coverage_for_test(
    context: &mut ProgramTestContext,
    month_key: Pubkey,
    required_sku_count: u16,
) -> Pubkey {
    let program_id = light_token_minter::id();
    let month: OracleMonthState = read_program_state(context, month_key).await;
    let (coverage_key, bump) = derive_oracle_sku_coverage_manifest_pda(&program_id, &month_key);
    set_program_state(
        context,
        coverage_key,
        &OracleSkuCoverageManifest {
            is_initialized: true,
            bump,
            account_discriminator: OracleSkuCoverageManifest::ACCOUNT_DISCRIMINATOR,
            account_version: OracleSkuCoverageManifest::ACCOUNT_VERSION,
            month: month_key,
            required_sku_root: [0x41; 32],
            required_sku_count,
            covered_sku_count: required_sku_count,
            planned_scramble_start_ts: month.scramble_start_ts,
            planned_listing_ts: month.listing_ts,
            coverage_finalized: true,
            coverage_complete_ts: month.scramble_start_ts + 1,
            last_updated_slot: 1,
        },
        OracleSkuCoverageManifest::LEN,
    )
    .await;
    coverage_key
}

pub(super) async fn set_borsh_account<T: BorshSerialize>(
    context: &mut ProgramTestContext,
    address: Pubkey,
    owner: &Pubkey,
    value: &T,
    len: usize,
) {
    let rent = context.banks_client.get_rent().await.unwrap();
    let mut data = vec![0; len];
    let serialized = value.try_to_vec().expect("serialize state");
    data[..serialized.len()].copy_from_slice(&serialized);
    let mut account = AccountSharedData::new(rent.minimum_balance(len), len, owner);
    account.set_data_from_slice(&data);
    context.set_account(&address, &account);
}

pub(super) async fn set_raw_account(
    context: &mut ProgramTestContext,
    address: Pubkey,
    owner: &Pubkey,
    data: Vec<u8>,
    rent_len: usize,
) {
    let rent = context.banks_client.get_rent().await.unwrap();
    let mut account = AccountSharedData::new(rent.minimum_balance(rent_len), data.len(), owner);
    account.set_data_from_slice(&data);
    context.set_account(&address, &account);
}

pub(super) async fn set_test_mint_account(
    context: &mut ProgramTestContext,
    address: Pubkey,
    owner_program: Pubkey,
    mint_authority: Pubkey,
    supply: u64,
    decimals: u8,
) {
    let mut data = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: COption::Some(mint_authority),
            supply,
            decimals,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    if owner_program == LIGHT_TOKEN_PROGRAM_ID {
        extend_as_light_mint(&mut data);
    }
    let rent_len = data.len();
    set_raw_account(context, address, &owner_program, data, rent_len).await;
}

pub(super) async fn set_test_token_account(
    context: &mut ProgramTestContext,
    address: Pubkey,
    owner_program: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let mut data = vec![0; TokenAccountState::LEN];
    TokenAccountState::pack(
        TokenAccountState {
            mint,
            owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    if owner_program == LIGHT_TOKEN_PROGRAM_ID {
        extend_as_light_token_account(&mut data);
    }
    let rent_len = data.len();
    set_raw_account(context, address, &owner_program, data, rent_len).await;
}

pub(super) async fn set_empty_account(
    context: &mut ProgramTestContext,
    address: Pubkey,
    owner: &Pubkey,
    len: usize,
) {
    let rent = context.banks_client.get_rent().await.unwrap();
    let account = AccountSharedData::new(rent.minimum_balance(len), len, owner);
    context.set_account(&address, &account);
}

pub(super) async fn set_system_account_with_lamports(
    context: &mut ProgramTestContext,
    address: Pubkey,
    lamports: u64,
) {
    let account = AccountSharedData::new(lamports, 0, &solana_sdk::system_program::id());
    context.set_account(&address, &account);
}

pub(super) async fn read_program_state<T: BorshDeserialize>(
    context: &mut ProgramTestContext,
    address: Pubkey,
) -> T {
    let account = context
        .banks_client
        .get_account(address)
        .await
        .unwrap()
        .expect("program account exists");
    T::deserialize(&mut &account.data[..]).expect("deserialize state")
}
