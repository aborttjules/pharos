use std::env;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use tokio::time::sleep;

/// Pharos — Rust Wallet Position Poller
///
/// Reads wallet token account balances from Solana RPC.
/// Emits PositionSnapshot JSON to stdout (consumed by TypeScript agent).
///
/// WATCHER_MODE_ONLY = true — no transactions signed or submitted.

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenBalance {
    pub mint: String,
    pub symbol: String,
    pub ui_amount: f64,
    pub decimals: u8,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PositionSnapshot {
    pub wallet: String,
    pub balances: Vec<TokenBalance>,
    pub timestamp_ms: u64,
    pub poll_duration_ms: u64,
    pub source: String,
}

// Well-known token symbols (mainnet)
fn known_symbol(mint: &str) -> &'static str {
    match mint {
        "So11111111111111111111111111111111111111112"  => "SOL",
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" => "USDC",
        "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"  => "USDT",
        "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"  => "mSOL",
        "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj"  => "stSOL",
        _ => "UNKNOWN",
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn poll_wallet(client: &RpcClient, wallet_address: &str) -> Option<PositionSnapshot> {
    let pubkey = Pubkey::from_str(wallet_address).ok()?;
    let start = now_ms();

    // Fetch native SOL balance
    let sol_lamports = client.get_balance(&pubkey).ok()?;
    let sol_amount = sol_lamports as f64 / 1_000_000_000.0;

    let mut balances = vec![TokenBalance {
        mint: "So11111111111111111111111111111111111111112".to_string(),
        symbol: "SOL".to_string(),
        ui_amount: sol_amount,
        decimals: 9,
    }];

    // Fetch SPL token accounts
    let token_program = Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").ok()?;

    if let Ok(token_accounts) = client.get_token_accounts_by_owner(
        &pubkey,
        solana_client::rpc_request::TokenAccountsFilter::ProgramId(token_program),
    ) {
        for keyed_account in token_accounts {
            let account = keyed_account.account;
            if let solana_account_decoder::UiAccountData::Json(parsed) = account.data {
                if let Some(info) = parsed.parsed.get("info") {
                    let mint = info["mint"].as_str().unwrap_or("").to_string();
                    let ui_amount = info["tokenAmount"]["uiAmount"]
                        .as_f64()
                        .unwrap_or(0.0);
                    let decimals = info["tokenAmount"]["decimals"]
                        .as_u64()
                        .unwrap_or(0) as u8;

                    if ui_amount > 0.0 && !mint.is_empty() {
                        let symbol = known_symbol(&mint);
                        balances.push(TokenBalance {
                            mint,
                            symbol: symbol.to_string(),
                            ui_amount,
                            decimals,
                        });
                    }
                }
            }
        }
    }

    let duration = now_ms() - start;

    Some(PositionSnapshot {
        wallet: wallet_address.to_string(),
        balances,
        timestamp_ms: now_ms(),
        poll_duration_ms: duration,
        source: "pharos-rust-poller-v2".to_string(),
    })
}

#[tokio::main]
async fn main() {
    let rpc_url = env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());

    let wallet_address = env::var("WATCH_WALLET_ADDRESS")
        .unwrap_or_else(|_| {
            eprintln!("[Pharos Rust] WATCH_WALLET_ADDRESS not set. Running in dry-run mode.");
            "11111111111111111111111111111111".to_string()
        });

    let poll_interval_secs: u64 = env::var("POLL_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);

    eprintln!("[Pharos Rust v2] Starting wallet poller");
    eprintln!("[Pharos Rust v2] RPC      : {}", &rpc_url[..rpc_url.len().min(50)]);
    eprintln!("[Pharos Rust v2] Wallet   : {}", &wallet_address[..wallet_address.len().min(16)]);
    eprintln!("[Pharos Rust v2] Interval : {}s", poll_interval_secs);
    eprintln!("[Pharos Rust v2] WATCHER_MODE_ONLY = true — no signing");

    let client = RpcClient::new_with_timeout(rpc_url, Duration::from_secs(15));

    loop {
        match poll_wallet(&client, &wallet_address).await {
            Some(snapshot) => {
                let json = serde_json::to_string(&snapshot).unwrap_or_default();
                println!("{}", json); // TypeScript agent reads this via stdout pipe
            }
            None => {
                eprintln!("[Pharos Rust v2] Failed to poll wallet — will retry in {}s", poll_interval_secs);
            }
        }

        sleep(Duration::from_secs(poll_interval_secs)).await;
    }
}
