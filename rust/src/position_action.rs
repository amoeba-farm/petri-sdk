//! Frozen RC44 collateral-action admission names and logical tags.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurrentPositionActionType {
    InitCollateral,
    DepositCollateral,
    WithdrawCollateral,
}

impl CurrentPositionActionType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InitCollateral => "init_collateral",
            Self::DepositCollateral => "deposit_collateral",
            Self::WithdrawCollateral => "withdraw_collateral",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CurrentPositionActionAdmission {
    pub action_type: CurrentPositionActionType,
    pub action_type_name: &'static str,
    pub instruction_name: &'static str,
    pub instruction_tag: u8,
}

pub const CURRENT_POSITION_ACTION_ADMISSION: [CurrentPositionActionAdmission; 3] = [
    CurrentPositionActionAdmission {
        action_type: CurrentPositionActionType::InitCollateral,
        action_type_name: "init_collateral",
        instruction_name: "InitUserCollateral",
        instruction_tag: 9,
    },
    CurrentPositionActionAdmission {
        action_type: CurrentPositionActionType::DepositCollateral,
        action_type_name: "deposit_collateral",
        instruction_name: "DepositCollateral",
        instruction_tag: 10,
    },
    CurrentPositionActionAdmission {
        action_type: CurrentPositionActionType::WithdrawCollateral,
        action_type_name: "withdraw_collateral",
        instruction_name: "WithdrawCollateral",
        instruction_tag: 11,
    },
];

pub fn current_position_action_admission(
    action_type: CurrentPositionActionType,
) -> &'static CurrentPositionActionAdmission {
    &CURRENT_POSITION_ACTION_ADMISSION[action_type as usize]
}

pub fn parse_current_position_action_type(value: &str) -> Option<CurrentPositionActionType> {
    CURRENT_POSITION_ACTION_ADMISSION
        .iter()
        .find(|admission| admission.action_type_name == value)
        .map(|admission| admission.action_type)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DepositCollateralAccounts, InitUserCollateralAccounts,
        build_deposit_collateral_instruction, build_init_user_collateral_instruction,
        build_withdraw_collateral_instruction,
    };
    use solana_program::pubkey::Pubkey;

    #[test]
    fn position_action_admission_is_exact_and_action_specific() {
        assert_eq!(
            CURRENT_POSITION_ACTION_ADMISSION.map(|entry| (
                entry.action_type_name,
                entry.instruction_name,
                entry.instruction_tag
            )),
            [
                ("init_collateral", "InitUserCollateral", 9),
                ("deposit_collateral", "DepositCollateral", 10),
                ("withdraw_collateral", "WithdrawCollateral", 11),
            ],
        );
        for admission in CURRENT_POSITION_ACTION_ADMISSION {
            assert_eq!(
                parse_current_position_action_type(admission.action_type_name),
                Some(admission.action_type),
            );
            assert_eq!(
                current_position_action_admission(admission.action_type),
                &admission,
            );
            assert_eq!(admission.action_type.as_str(), admission.action_type_name);
        }
        assert_eq!(parse_current_position_action_type("liquidity"), None);

        let keys: Vec<Pubkey> = (0..6).map(|_| Pubkey::new_unique()).collect();
        let collateral = DepositCollateralAccounts {
            user: keys[0],
            user_token_account: keys[1],
            vault_token_account: keys[2],
            vault_config: keys[3],
            user_collateral: keys[4],
            collateral_mint: keys[5],
        };
        let actual_tags = [
            build_init_user_collateral_instruction(
                crate::ID,
                InitUserCollateralAccounts {
                    user: keys[0],
                    user_collateral: keys[4],
                },
            )
            .unwrap()
            .data[0],
            build_deposit_collateral_instruction(crate::ID, collateral, 1)
                .unwrap()
                .data[0],
            build_withdraw_collateral_instruction(crate::ID, collateral, 1)
                .unwrap()
                .data[0],
        ];
        assert_eq!(
            actual_tags,
            CURRENT_POSITION_ACTION_ADMISSION.map(|entry| entry.instruction_tag)
        );
    }
}
