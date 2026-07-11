# Pharos

> **Autonomous trade observation infrastructure for Solana AI agents. Watch already-executed positions across 4 platforms. Surface loss-risk warnings before they materialise. Deliver structured alerts via Telegram and a privacy-first dashboard. Never executes. Always watches.**

---

## What Pharos Is

Pharos is **post-execution observation infrastructure** — not a DEX, router, or execution engine. It is a watchtower that sits *after* trades are taken, not before.

The system watches already-opened positions across four Solana platforms (Jupiter, Orca, Raydium, Marinade), evaluates each position for loss risk every 30 seconds, fires structured alerts when positions breach thresholds, and logs every agent action to an immutable audit trail.

Pharos's output is alerts, risk signals, and audit logs. It is infrastructure for user AI agents to reason about their open positions — not a product that acts on their behalf.

---

## Core Identity

| Property | Value |
|---|---|
| **Project Name** | Pharos |
| **Category** | Autonomous Agent Observation Infrastructure |
| **Network** | Solana (Mainnet + Devnet) |
| **Execution Mode** | Watcher-only — hardcoded at compile time |
| **Signing Authority** | None — no private keys, no transactions |
| **Fund Exposure** | Zero by construction |
| **Primary Languages** | TypeScript / Node.js (agent), Rust (wallet poller), Next.js (dashboard) |
| **Database** | PostgreSQL (Prisma ORM) |
| **Alert Channels** | Telegram bot + WebSocket dashboard push |

---

## Three Pillars

### 1. Privacy-First Unified Dashboard
- Aggregates live positions across all 4 platforms in one view
- Shows entry value, current value, unrealized P&L, drift status
- Color-coded status: ✅ Active | ⚠️ Warning (5%) | 🛑 Critical (−10%)
- Strategy intent (TP/SL targets) stays client-side — server never sees it
- AES-256 encrypted rule payloads (server stores ciphertext only)

### 2. Smart Alerts + Telegram Bot
- Default alert: ⚠️ when position falls **5% from entry cost**, 🛑 at −10%
- User-overridable via custom rules
- Telegram commands: `/watch`, `/show`, `/alerts`, `/rules`, `/audit`
- Real-time WebSocket push to dashboard
- Cooldown system prevents alert spam (default: 5 minutes)

### 3. Custom Rules + Audit Rails
- Define rules: `loss_threshold < -8`, `value_below 400`, `price_drift > 5`
- Rule types: loss threshold, value floor/ceiling, LP fee drop, stake reward drop
- Full audit log of every agent action (position polled, alert fired, rule created)
- Export audit trail as CSV (for strategy review / tax)

---

## 4 Integrated Platforms

| Platform | What Pharos Watches | Data Source |
|---|---|---|
| **Jupiter** | SPL token swap positions (price, value, P&L) | Jupiter Price API v2 + wallet RPC |
| **Orca** | Whirlpool LP positions (range status, liquidity value, fees) | Orca API + position accounts |
| **Raydium** | AMM v4 LP positions (pool share, fee APR) | Raydium API v3 |
| **Marinade** | mSOL staking positions (balance, APR, epoch rewards) | Marinade API + Jupiter price |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  4 Solana Platforms (Read-Only)             │
│  ├─ Jupiter (wallet SPL balances + prices)  │
│  ├─ Orca (Whirlpool position accounts)      │
│  ├─ Raydium (AMM LP pool API)               │
│  └─ Marinade (mSOL balance + staking APR)   │
└──────────────────┬──────────────────────────┘
                   │ Position snapshots (no signing)
                   ▼
┌─────────────────────────────────────────────┐
│  Pharos Agent (TypeScript)                  │
│  ├─ Poll Engine (30s interval, all 4 platforms) │
│  ├─ Position Reconciler (unified schema)    │
│  ├─ Drift Detector (default 5% + user rules)│
│  └─ Audit Logger (every action recorded)    │
└───────────┬──────────────────────────────────┘
            │
   ┌────────┴──────────┐
   ▼                   ▼
┌──────────┐   ┌────────────────────┐
│ Telegram │   │ Privacy Layer      │
│ Bot      │   │ (AES-256 encrypted │
│ Alerts   │   │  client-side rules)│
└──────────┘   └────────────────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │ PostgreSQL + Prisma  │
             │ positions / alerts   │
             │ rules / audit_log    │
             └──────────────────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │ Next.js Dashboard    │
             │ Positions + P&L      │
             │ Alert History        │
             │ Rules Builder        │
             │ Audit Trail + Export │
             └──────────────────────┘
```

---

## Safety Architecture

- `WATCHER_MODE_ONLY = true` — hardcoded constant, cannot be toggled by env
- No private keys loaded at any point in the execution path
- No transaction constructed, signed, or submitted
- Read-only RPC calls only (balance reads, account reads)
- Position snapshots only (no strategy data ever transmitted to server)

**Safety by architecture**, not by configuration.

---

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Set: SOLANA_RPC_URL, TELEGRAM_BOT_TOKEN, DATABASE_URL

# 3. Run database migrations
npm run db:migrate

# 4. Start backend agent
npm run dev

# 5. Start dashboard (separate terminal)
npm run dev:dashboard

# Or run both together:
npm run start:all
```

---

## Environment Variables

```env
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
TELEGRAM_BOT_TOKEN=your_bot_token_here
DATABASE_URL=postgresql://user:pass@localhost:5432/pharos
PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
```

---

## Telegram Commands

| Command | Description |
|---|---|
| `/start` | Introduction + command list |
| `/watch <platform> <asset> <entry_usd>` | Add a position to watch |
| `/show` | View all active positions with P&L |
| `/alerts` | Last 10 alerts fired |
| `/rules` | List active custom rules |
| `/rule add <type> <op> <threshold>` | Add a custom alert rule |
| `/rule remove <id>` | Delete a rule |
| `/stop <asset>` | Stop watching a position |
| `/audit` | Audit trail summary |

---

## Repository

`/home/gvnaap/Documents/travel/paul/poc-mev-agent`  
**License:** MIT

---

*Pharos is observation infrastructure. It never executes on your behalf. No private keys are configured. No funds are at risk.*
