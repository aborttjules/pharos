/**
 * Pharos — Shared Type Definitions
 * Post-execution trade observation infrastructure.
 * Pharos NEVER signs, executes, or submits transactions.
 */

// ──────────────────────────────────────────────
// Platform identifiers
// ──────────────────────────────────────────────
export type Platform = 'jupiter' | 'orca' | 'raydium' | 'marinade' | 'manual';

// ──────────────────────────────────────────────
// Unified Position — normalised from all 4 platforms
// ──────────────────────────────────────────────
export interface Position {
  id: string;
  userId: string;
  platform: Platform;
  asset: string;                  // e.g. "SOL", "SOL-USDC LP", "mSOL"
  poolId?: string;                // LP pool or program address
  entryValueUsd: number;          // USD value when position was opened / watched
  currentValueUsd: number;        // Latest observed USD value
  unrealizedPnlUsd: number;       // currentValueUsd - entryValueUsd
  unrealizedPnlPct: number;       // (pnl / entry) * 100
  status: PositionStatus;
  lastCheckedAt: string;          // ISO timestamp
  metadata: Record<string, unknown>; // platform-specific extras
  createdAt: string;
  closedAt?: string;
}

export type PositionStatus = 'active' | 'warning' | 'critical' | 'closed';

// ──────────────────────────────────────────────
// Drift status for dashboard rendering
// ──────────────────────────────────────────────
export interface DriftStatus {
  color: 'green' | 'yellow' | 'red';
  label: string;
  pnlPct: number;
}

// ──────────────────────────────────────────────
// Alert
// ──────────────────────────────────────────────
export type AlertType =
  | 'loss_warning'      // position fell to DEFAULT_LOSS_THRESHOLD_PCT (5%)
  | 'stop_breach'       // fell below user-defined stop
  | 'drift_detected'    // rapid move in lookback window
  | 'custom_rule'       // user-defined rule fired
  | 'recovery';         // position recovered above threshold

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannel = 'telegram' | 'dashboard' | 'webhook' | 'email';

export interface Alert {
  id: string;
  userId: string;
  positionId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  valueAtAlert: number;
  sentVia: AlertChannel[];
  sentAt: string;
  acknowledgedAt?: string;
}

// ──────────────────────────────────────────────
// Alert Rules
// ──────────────────────────────────────────────
export type RuleType =
  | 'price_drift'       // % move in lookback window
  | 'loss_threshold'    // absolute loss from entry
  | 'value_below'       // absolute USD value floor
  | 'value_above'       // absolute USD value ceiling
  | 'lp_fee_drop'       // Orca/Raydium fee APR drops
  | 'stake_reward_drop' // Marinade rewards drop
  | 'custom';

export type RuleOperator = '>' | '<' | '>=' | '<=' | '==';

export interface AlertRule {
  id: string;
  userId: string;
  positionId?: string;          // null = applies to all positions
  ruleType: RuleType;
  threshold: number;
  operator: RuleOperator;
  lookbackSecs?: number;        // for time-window rules
  cooldownSecs: number;         // min gap between repeated alerts (default 300)
  enabled: boolean;
  lastFiredAt?: string;
  createdAt: string;
  // AES-256 encrypted payload — server stores ciphertext, never decrypts
  encryptedPayload?: string;
}

// ──────────────────────────────────────────────
// Audit Log — what Pharos agent did and when
// ──────────────────────────────────────────────
export type AuditActor = 'agent' | 'user' | 'telegram';
export type AuditAction =
  | 'position_added'
  | 'position_removed'
  | 'position_polled'
  | 'alert_fired'
  | 'rule_created'
  | 'rule_deleted'
  | 'threshold_updated'
  | 'session_started';

export interface AuditEntry {
  id: string;
  userId: string;
  actor: AuditActor;
  action: AuditAction;
  details: Record<string, unknown>;
  timestamp: string;
}

// ──────────────────────────────────────────────
// Platform position snapshots (raw, before normalisation)
// ──────────────────────────────────────────────

/** Jupiter swap position raw shape */
export interface JupiterPositionRaw {
  tokenMint: string;
  symbol: string;
  uiAmount: number;
  priceUsd: number;
  valueUsd: number;
}

/** Orca Whirlpool LP position raw shape */
export interface OrcaPositionRaw {
  positionMint: string;
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  liquidityUsd: number;
  feesEarnedUsd: number;
  inRange: boolean;
}

/** Raydium AMM LP position raw shape */
export interface RaydiumPositionRaw {
  lpMint: string;
  poolId: string;
  tokenA: string;
  tokenB: string;
  shareUsd: number;
  feeApr: number;
}

/** Marinade staking position raw shape */
export interface MarinadePositionRaw {
  mSolBalance: number;
  mSolPriceUsd: number;
  valueUsd: number;
  stakingApr: number;
  epochRewardsUsd: number;
}

// ──────────────────────────────────────────────
// Agent poll result
// ──────────────────────────────────────────────
export interface PollResult {
  positions: Position[];
  alertsTriggered: Alert[];
  pollDurationMs: number;
  timestamp: string;
}

// ──────────────────────────────────────────────
// WebSocket event shapes (dashboard push)
// ──────────────────────────────────────────────
export type WsEventType = 'positions:update' | 'alert:fired' | 'audit:entry' | 'heartbeat';

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
  timestamp: string;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
export const DEFAULT_LOSS_THRESHOLD_PCT = 5;   // alert at 5% from entry
export const POLL_INTERVAL_MS = 30_000;         // 30 seconds
export const ALERT_COOLDOWN_DEFAULT_SECS = 300; // 5 minutes
export const WATCHER_MODE_ONLY = true;          // compile-time constant — never execute
