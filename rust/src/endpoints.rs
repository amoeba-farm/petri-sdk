pub fn chain_identity() -> &'static str {
    "/chain/identity"
}

/// Amoeba's Lean-admitted, read-only Solana JSON-RPC gateway.
pub fn chain_read_gateway() -> &'static str {
    "/rpc"
}

pub fn dlmm_markets() -> &'static str {
    "/dlmm/markets"
}

pub fn dlmm_market_snapshot(market_id: &str) -> String {
    format!("/dlmm/markets/{}/snapshot", path_segment(market_id))
}

pub fn dlmm_market_chart(market_id: &str, window_ms: Option<u64>) -> String {
    let mut path = format!("/dlmm/markets/{}/chart", path_segment(market_id));
    if let Some(window_ms) = window_ms {
        path.push_str(&format!("?windowMs={window_ms}"));
    }
    path
}

pub fn oracle_drafts_prepare() -> &'static str {
    "/dlmm/oracle/drafts/prepare"
}

pub fn dlmm_oracle_state() -> &'static str {
    "/dlmm/oracle/state"
}

pub fn dlmm_oracle_markets() -> &'static str {
    "/dlmm/oracle/markets"
}

pub fn dlmm_oracle_market(market_id: &str) -> String {
    format!("/dlmm/oracle/markets/{}", path_segment(market_id))
}

pub fn dlmm_oracle_latest(market_id: Option<&str>) -> String {
    match market_id.and_then(nonempty_trimmed) {
        Some(market_id) => format!("{}/latest", dlmm_oracle_market(market_id)),
        None => "/dlmm/oracle/latest".to_string(),
    }
}

pub fn dlmm_oracle_history(market_id: Option<&str>) -> String {
    match market_id.and_then(nonempty_trimmed) {
        Some(market_id) => format!("{}/history", dlmm_oracle_market(market_id)),
        None => "/dlmm/oracle/history".to_string(),
    }
}

pub fn dlmm_settlement(market_id: &str, expiry_id: &str) -> String {
    format!(
        "/dlmm/markets/{}/settlements/{}",
        path_segment(market_id),
        path_segment(expiry_id)
    )
}

pub fn dlmm_settlement_oracle(market_id: &str, expiry_id: &str) -> String {
    format!("{}/oracle", dlmm_settlement(market_id, expiry_id))
}

pub fn dlmm_settlement_oracle_preflight(market_id: &str, expiry_id: &str) -> String {
    format!("{}/preflight", dlmm_settlement_oracle(market_id, expiry_id))
}

pub fn user_ledger(owner_pubkey: &str, limit: usize, refresh: bool) -> String {
    let mut path = format!("/users/{}/ledger?limit={limit}", path_segment(owner_pubkey));
    if refresh {
        path.push_str("&refresh=true");
    }
    path
}

pub fn position_expiry_automation_scheduler() -> &'static str {
    "/dlmm/position-expiry-automation/scheduler"
}

pub fn position_expiry_automation_sync() -> &'static str {
    "/dlmm/position-expiry-automation/sync"
}

pub fn position_expiry_automation_records(
    owner_pubkey: Option<&str>,
    market_id: Option<&str>,
    expiry_id: Option<&str>,
    position_address: Option<&str>,
    status: Option<&str>,
    limit: Option<u16>,
) -> String {
    let mut params = Vec::new();
    push_query_param(&mut params, "ownerPubkey", owner_pubkey);
    push_query_param(&mut params, "marketId", market_id);
    push_query_param(&mut params, "expiryId", expiry_id);
    push_query_param(&mut params, "positionAddress", position_address);
    push_query_param(&mut params, "status", status);
    if let Some(limit) = limit {
        params.push(format!("limit={limit}"));
    }

    if params.is_empty() {
        "/dlmm/position-expiry-automation/records".to_string()
    } else {
        format!(
            "/dlmm/position-expiry-automation/records?{}",
            params.join("&")
        )
    }
}

pub fn position_expiry_automation_record(automation_id: &str) -> String {
    format!(
        "/dlmm/position-expiry-automation/records/{}",
        path_segment(automation_id)
    )
}

pub fn position_expiry_automation_record_readiness(automation_id: &str) -> String {
    format!(
        "/dlmm/position-expiry-automation/records/{}/readiness",
        path_segment(automation_id)
    )
}

pub fn dlmm_program_registry() -> &'static str {
    "/dlmm/program-registry"
}

pub fn dlmm_trade_prepare() -> &'static str {
    "/dlmm/trades/prepare"
}

pub fn dlmm_trade_submit() -> &'static str {
    "/dlmm/trades/submit"
}

pub fn dlmm_trade_operation_status(operation_id: &str) -> String {
    format!("/dlmm/trades/status/{}", path_segment(operation_id))
}

pub fn dlmm_writer_close_prepare() -> &'static str {
    "/dlmm/writer-sleeves/closes/prepare"
}

pub fn dlmm_writer_close_next_prepare() -> &'static str {
    "/dlmm/writer-sleeves/closes/next/prepare"
}

pub fn dlmm_writer_close_cancel_next_prepare() -> &'static str {
    "/dlmm/writer-sleeves/closes/cancel/next/prepare"
}

pub fn dlmm_writer_submit() -> &'static str {
    "/dlmm/writer-sleeves/submit"
}

pub fn dlmm_writer_operation_status(operation_id: &str) -> String {
    format!("/dlmm/writer-sleeves/status/{}", path_segment(operation_id))
}

pub fn dlmm_writer_close_request(close_request: &str) -> String {
    format!(
        "/dlmm/writer-sleeves/close-requests/{}",
        path_segment(close_request)
    )
}

fn path_segment(value: &str) -> String {
    percent_encode_path_segment(value.trim())
}

fn nonempty_trimmed(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn push_query_param(params: &mut Vec<String>, key: &str, value: Option<&str>) {
    if let Some(value) = value.and_then(nonempty_trimmed) {
        params.push(format!("{key}={}", percent_encode_path_segment(value)));
    }
}

fn percent_encode_path_segment(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                output.push(char::from(*byte));
            }
            other => output.push_str(&format!("%{other:02X}")),
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_segments_are_trimmed_and_percent_encoded() {
        assert_eq!(
            dlmm_market_snapshot(" ramx/lead month "),
            "/dlmm/markets/ramx%2Flead%20month/snapshot"
        );
    }

    #[test]
    fn current_product_and_full_series_ids_keep_canonical_routes() {
        assert_eq!(
            dlmm_market_chart("ramx", Some(86_400_000)),
            "/dlmm/markets/ramx/chart?windowMs=86400000"
        );
        assert_eq!(
            user_ledger("Owner111", 50, true),
            "/users/Owner111/ledger?limit=50&refresh=true"
        );
        assert_eq!(
            position_expiry_automation_scheduler(),
            "/dlmm/position-expiry-automation/scheduler"
        );
        assert_eq!(
            position_expiry_automation_sync(),
            "/dlmm/position-expiry-automation/sync"
        );
        assert_eq!(
            position_expiry_automation_records(
                Some("owner/1"),
                Some("ramx"),
                Some("RAMX-202701-CALL-01"),
                None,
                Some("cleanup_submitted"),
                Some(25),
            ),
            "/dlmm/position-expiry-automation/records?ownerPubkey=owner%2F1&marketId=ramx&expiryId=RAMX-202701-CALL-01&status=cleanup_submitted&limit=25"
        );
        assert_eq!(
            position_expiry_automation_record("automation?#1"),
            "/dlmm/position-expiry-automation/records/automation%3F%231"
        );
        assert_eq!(
            position_expiry_automation_record_readiness("automation?#1"),
            "/dlmm/position-expiry-automation/records/automation%3F%231/readiness"
        );
        assert_eq!(
            dlmm_writer_close_prepare(),
            "/dlmm/writer-sleeves/closes/prepare"
        );
        assert_eq!(
            dlmm_writer_close_next_prepare(),
            "/dlmm/writer-sleeves/closes/next/prepare"
        );
        assert_eq!(
            dlmm_writer_close_cancel_next_prepare(),
            "/dlmm/writer-sleeves/closes/cancel/next/prepare"
        );
        assert_eq!(dlmm_writer_submit(), "/dlmm/writer-sleeves/submit");
        assert_eq!(chain_read_gateway(), "/rpc");
        assert_eq!(
            dlmm_trade_operation_status("operation/#1"),
            "/dlmm/trades/status/operation%2F%231"
        );
        assert_eq!(
            dlmm_writer_operation_status("operation/#1"),
            "/dlmm/writer-sleeves/status/operation%2F%231"
        );
        assert_eq!(
            dlmm_writer_close_request("request?#1"),
            "/dlmm/writer-sleeves/close-requests/request%3F%231"
        );
    }
}
