use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{
    constants::{
        CURRENT_STATE_NAMESPACE_SEED, ORACLE_PRODUCT_SKU_DRAFT_PDA_SEED,
        ORACLE_PRODUCT_SKU_MANIFEST_PDA_SEED, ORACLE_SKU_EMPTY_HASH_DOMAIN,
        ORACLE_SKU_LEAF_HASH_DOMAIN, ORACLE_SKU_NODE_HASH_DOMAIN, VAULT_PDA_SEED,
    },
    instruction::{ConfigureOracleProductSkuManifestParams, VaultInstruction},
    processor::process_instruction,
    state::{OracleProductSkuDraft, OracleProductSkuManifest, VaultConfig},
};
use solana_program::{hash::hashv, rent::Rent};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

const DRAFT_NONCE: u64 = 0x51_4b_55;

struct SkuFixture {
    context: ProgramTestContext,
    admin: Keypair,
    oracle: Keypair,
    config: Pubkey,
    draft: Pubkey,
    manifest: Pubkey,
    underlying_id: [u8; 32],
}

impl SkuFixture {
    async fn start() -> Self {
        let program_id = light_token_minter::id();
        let admin = Keypair::new();
        let oracle = Keypair::new();
        let mut underlying_id = [0u8; 32];
        let label = b"ram-standardized-baskets";
        underlying_id[..label.len()].copy_from_slice(label);

        let (config, config_bump) = Pubkey::find_program_address(
            &[CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED],
            &program_id,
        );
        let (draft, _) = Pubkey::find_program_address(
            &[
                CURRENT_STATE_NAMESPACE_SEED,
                ORACLE_PRODUCT_SKU_DRAFT_PDA_SEED,
                &underlying_id,
                &DRAFT_NONCE.to_le_bytes(),
            ],
            &program_id,
        );
        let (manifest, _) = Pubkey::find_program_address(
            &[
                CURRENT_STATE_NAMESPACE_SEED,
                ORACLE_PRODUCT_SKU_MANIFEST_PDA_SEED,
                &underlying_id,
            ],
            &program_id,
        );
        let config_state = VaultConfig {
            is_initialized: true,
            bump: config_bump,
            admin: admin.pubkey(),
            oracle_authority: oracle.pubkey(),
            usdc_mint: Pubkey::new_unique(),
            vault_token_account: Pubkey::new_unique(),
            paused: true,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        };

        let mut program_test = ProgramTest::new(
            "light_token_minter",
            program_id,
            processor!(process_instruction),
        );
        program_test.prefer_bpf(false);
        add_account(
            &mut program_test,
            admin.pubkey(),
            solana_sdk::system_program::id(),
            vec![],
            10_000_000_000,
        );
        add_account(
            &mut program_test,
            oracle.pubkey(),
            solana_sdk::system_program::id(),
            vec![],
            1_000_000,
        );
        add_borsh_account(
            &mut program_test,
            config,
            program_id,
            &config_state,
            VaultConfig::LEN,
        );

        Self {
            context: program_test.start_with_context().await,
            admin,
            oracle,
            config,
            draft,
            manifest,
            underlying_id,
        }
    }

    fn configure_ix(&self, expected_start_index: u16, sku_id_chunk: Vec<[u8; 32]>) -> Instruction {
        Instruction {
            program_id: light_token_minter::id(),
            accounts: vec![
                AccountMeta::new(self.admin.pubkey(), true),
                AccountMeta::new_readonly(self.oracle.pubkey(), true),
                AccountMeta::new_readonly(self.config, false),
                AccountMeta::new(self.draft, false),
                AccountMeta::new(self.manifest, false),
                AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
            ],
            data: borsh::to_vec(&VaultInstruction::ConfigureOracleProductSkuManifest {
                params: ConfigureOracleProductSkuManifestParams {
                    underlying_id: self.underlying_id,
                    draft_nonce: DRAFT_NONCE,
                    expected_start_index,
                    sku_id_chunk,
                },
            })
            .unwrap(),
        }
    }

    async fn send(&mut self, instruction: Instruction) -> Result<(), BanksClientError> {
        let blockhash = self
            .context
            .banks_client
            .get_latest_blockhash()
            .await
            .unwrap();
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&self.context.payer.pubkey()),
            &[&self.context.payer, &self.admin, &self.oracle],
            blockhash,
        );
        self.context
            .banks_client
            .process_transaction(transaction)
            .await
    }
}

#[tokio::test]
async fn final_chunk_preserves_root_and_refunds_the_fixed_frontier_draft() {
    let mut fixture = SkuFixture::start().await;
    let sku_ids: Vec<[u8; 32]> = (1u16..=52)
        .map(|index| {
            let mut sku_id = [0u8; 32];
            sku_id[30..].copy_from_slice(&index.to_be_bytes());
            sku_id
        })
        .collect();
    let initial_admin_lamports = fixture
        .context
        .banks_client
        .get_account(fixture.admin.pubkey())
        .await
        .unwrap()
        .unwrap()
        .lamports;

    for (start, end) in [(0usize, 16usize), (16, 32), (32, 48)] {
        fixture
            .send(fixture.configure_ix(start as u16, sku_ids[start..end].to_vec()))
            .await
            .unwrap();
    }
    let draft_account = fixture
        .context
        .banks_client
        .get_account(fixture.draft)
        .await
        .unwrap()
        .expect("partial fixed-frontier draft");
    assert_eq!(draft_account.data.len(), OracleProductSkuDraft::LEN);
    let mut draft_data = draft_account.data.as_slice();
    let draft = OracleProductSkuDraft::deserialize(&mut draft_data).unwrap();
    assert_eq!(draft.appended_sku_count, 48);
    assert_eq!(draft.frontier_mask, 48);
    assert!(fixture
        .context
        .banks_client
        .get_account(fixture.manifest)
        .await
        .unwrap()
        .is_none());

    fixture
        .send(fixture.configure_ix(48, sku_ids[48..].to_vec()))
        .await
        .unwrap();

    assert!(fixture
        .context
        .banks_client
        .get_account(fixture.draft)
        .await
        .unwrap()
        .is_none());
    let manifest_account = fixture
        .context
        .banks_client
        .get_account(fixture.manifest)
        .await
        .unwrap()
        .expect("immutable SKU manifest");
    assert_eq!(manifest_account.data.len(), OracleProductSkuManifest::LEN);
    let mut manifest_data = manifest_account.data.as_slice();
    let manifest = OracleProductSkuManifest::deserialize(&mut manifest_data).unwrap();
    assert_eq!(manifest.required_sku_count, 52);
    assert_eq!(manifest.required_sku_root, vector_merkle_root(&sku_ids));

    let final_admin_lamports = fixture
        .context
        .banks_client
        .get_account(fixture.admin.pubkey())
        .await
        .unwrap()
        .unwrap()
        .lamports;
    assert_eq!(
        initial_admin_lamports - final_admin_lamports,
        Rent::default().minimum_balance(OracleProductSkuManifest::LEN),
        "the temporary draft rent must be fully returned on finalization"
    );
}

fn vector_merkle_root(sku_ids: &[[u8; 32]]) -> [u8; 32] {
    let width = sku_ids.len().next_power_of_two();
    let mut nodes: Vec<[u8; 32]> = (0..width)
        .map(|index| {
            let index_bytes = u16::try_from(index).unwrap().to_le_bytes();
            if let Some(sku_id) = sku_ids.get(index) {
                hashv(&[ORACLE_SKU_LEAF_HASH_DOMAIN, &index_bytes, sku_id]).to_bytes()
            } else {
                hashv(&[ORACLE_SKU_EMPTY_HASH_DOMAIN, &index_bytes]).to_bytes()
            }
        })
        .collect();
    while nodes.len() > 1 {
        nodes = nodes
            .chunks_exact(2)
            .map(|pair| hashv(&[ORACLE_SKU_NODE_HASH_DOMAIN, &pair[0], &pair[1]]).to_bytes())
            .collect();
    }
    nodes[0]
}

fn add_account(
    program_test: &mut ProgramTest,
    address: Pubkey,
    owner: Pubkey,
    data: Vec<u8>,
    lamports: u64,
) {
    program_test.add_account(
        address,
        Account {
            lamports,
            data,
            owner,
            executable: false,
            rent_epoch: 0,
        },
    );
}

fn add_borsh_account<T: BorshSerialize>(
    program_test: &mut ProgramTest,
    address: Pubkey,
    owner: Pubkey,
    value: &T,
    len: usize,
) {
    let mut data = borsh::to_vec(value).unwrap();
    assert!(data.len() <= len);
    data.resize(len, 0);
    add_account(program_test, address, owner, data, 10_000_000);
}
