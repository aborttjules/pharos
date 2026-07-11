/**
 * Pharos — Poll Engine
 * Core loop: every 30s, fetch all positions from 4 platforms,
 * run drift detection, fire alerts, write audit log.
 * READ-ONLY. Never signs or submits transactions.
 */

import { JupiterIntegration } from '../integrations/jupiter.js';
import { OrcaIntegration } from '../integrations/orca.js';
import { RaydiumIntegration } from '../integrations/raydium.js';
import { MarinadeIntegration } from '../integrations/marinade.js';
import { PositionReconciler } from './reconciler.js';
import { DriftDetector } from './drift-detector.js';
import { AgentAuditLogger, MemoryAuditLogger } from './audit-logger.js';
import type {
  Position, Alert, AlertRule, PollResult, WATCHER_MODE_ONLY,
} from '../shared/types.js';
import { POLL_INTERVAL_MS } from '../shared/types.js';

export interface WatchedUser {
  userId: string;
  walletAddress: string;
  telegramChatId?: string;
  positions: Position[];
  rules: AlertRule[];
}

export type AlertDispatcher = (alert: Alert, user: WatchedUser) => Promise<void>;
export type PositionUpdateBroadcaster = (positions: Position[], userId: string) => void;

export class PollEngine {
  private jupiter: JupiterIntegration;
  private orca: OrcaIntegration;
  private raydium: RaydiumIntegration;
  private marinade: MarinadeIntegration;
  private reconciler: PositionReconciler;
  private detector: DriftDetector;
  private auditLogger: AgentAuditLogger;
  private lastAlertMap: Map<string, number> = new Map();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  // Registered users to watch (in-memory for dev; use DB in production)
  private users: Map<string, WatchedUser> = new Map();

  constructor(
    rpcUrl: string,
    private onAlert: AlertDispatcher,
    private onPositionsUpdate: PositionUpdateBroadcaster
  ) {
    this.jupiter = new JupiterIntegration(rpcUrl);
    this.orca = new OrcaIntegration(rpcUrl);
    this.raydium = new RaydiumIntegration(rpcUrl);
    this.marinade = new MarinadeIntegration(rpcUrl);
    this.reconciler = new PositionReconciler();
    this.detector = new DriftDetector();
    this.auditLogger = new AgentAuditLogger(new MemoryAuditLogger());
  }

  /** Start polling all registered users on a 30s interval */
  start(): void {
    console.log(`[PollEngine] Starting. Interval: ${POLL_INTERVAL_MS / 1000}s. WATCHER_MODE_ONLY=true`);
    this.intervalHandle = setInterval(() => this.pollAll(), POLL_INTERVAL_MS);
    // Immediate first poll
    this.pollAll();
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    console.log('[PollEngine] Stopped.');
  }

  /** Register a user for watching */
  registerUser(user: WatchedUser): void {
    this.users.set(user.userId, user);
    console.log(`[PollEngine] Registered user ${user.userId} (${user.walletAddress.slice(0, 8)}...)`);
  }

  /** Update a user's positions (e.g. after manual /watch command) */
  updateUserPositions(userId: string, positions: Position[]): void {
    const user = this.users.get(userId);
    if (user) {
      user.positions = positions;
      this.users.set(userId, user);
    }
  }

  /** Update a user's rules */
  updateUserRules(userId: string, rules: AlertRule[]): void {
    const user = this.users.get(userId);
    if (user) {
      user.rules = rules;
      this.users.set(userId, user);
    }
  }

  getUser(userId: string): WatchedUser | undefined {
    return this.users.get(userId);
  }

  /** Poll all registered users */
  private async pollAll(): Promise<void> {
    for (const user of this.users.values()) {
      try {
        await this.pollUser(user);
      } catch (err) {
        console.error(`[PollEngine] Error polling user ${user.userId}:`, err);
      }
    }
  }

  /** Poll a single user — fetch all 4 platforms, reconcile, detect drift */
  private async pollUser(user: WatchedUser): Promise<PollResult> {
    const start = Date.now();

    // Fetch from all 4 platforms in parallel
    const [jupiterRaw, orcaRaw, raydiumRaw, marinadeRaw] = await Promise.allSettled([
      this.jupiter.fetchPositions(user.walletAddress),
      this.orca.fetchPositions(user.walletAddress),
      this.raydium.fetchPositions(user.walletAddress),
      this.marinade.fetchPositions(user.walletAddress),
    ]);

    // Reconcile each platform
    const jupiterPositions = this.reconciler.reconcileJupiter(
      user.userId,
      jupiterRaw.status === 'fulfilled' ? jupiterRaw.value : [],
      user.positions
    );
    const orcaPositions = this.reconciler.reconcileOrca(
      user.userId,
      orcaRaw.status === 'fulfilled' ? orcaRaw.value : [],
      user.positions
    );
    const raydiumPositions = this.reconciler.reconcileRaydium(
      user.userId,
      raydiumRaw.status === 'fulfilled' ? raydiumRaw.value : [],
      user.positions
    );
    const marinadePositions = this.reconciler.reconcileMarinade(
      user.userId,
      marinadeRaw.status === 'fulfilled' ? marinadeRaw.value : [],
      user.positions
    );

    const allPositions = [
      ...jupiterPositions,
      ...orcaPositions,
      ...raydiumPositions,
      ...marinadePositions,
    ];

    // Audit: log every position polled
    for (const pos of allPositions) {
      await this.auditLogger.positionPolled(
        user.userId, pos.id, pos.platform, pos.currentValueUsd, pos.unrealizedPnlPct
      );
    }

    // Update stored positions
    user.positions = allPositions;

    // Detect drift and fire alerts
    const alerts = this.detector.evaluate(allPositions, user.rules, this.lastAlertMap);

    for (const alert of alerts) {
      await this.auditLogger.alertFired(
        user.userId, alert.positionId, alert.alertType, alert.severity, alert.message
      );
      await this.onAlert(alert, user);
    }

    // Broadcast position update to dashboard
    this.onPositionsUpdate(allPositions, user.userId);

    const result: PollResult = {
      positions: allPositions,
      alertsTriggered: alerts,
      pollDurationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };

    if (alerts.length > 0) {
      console.log(`[PollEngine] User ${user.userId}: ${alerts.length} alert(s) fired | poll: ${result.pollDurationMs}ms`);
    }

    return result;
  }

  /** Get the audit logger for external access */
  getAuditLogger(): AgentAuditLogger {
    return this.auditLogger;
  }
}
