/**
 * Pharos — Audit Logger
 * Records every agent action to the database audit_log table.
 * This is the "audit rails" pillar — full transparency on what Pharos did.
 */

import type { AuditEntry, AuditActor, AuditAction } from '../shared/types.js';

// Thin abstraction over Prisma AuditLog writes.
// Import your Prisma client where you instantiate this.
export interface AuditLogWriter {
  write(entry: Omit<AuditEntry, 'id'>): Promise<void>;
}

/**
 * In-memory audit logger for use without a DB (testing / early dev).
 * Replace with PrismaAuditLogger in production.
 */
export class MemoryAuditLogger implements AuditLogWriter {
  private log: AuditEntry[] = [];
  private maxEntries = 500;

  async write(entry: Omit<AuditEntry, 'id'>): Promise<void> {
    const full: AuditEntry = { id: crypto.randomUUID(), ...entry };
    this.log.push(full);
    if (this.log.length > this.maxEntries) {
      this.log = this.log.slice(-this.maxEntries);
    }
    console.log(
      `[Audit] ${entry.timestamp} | actor=${entry.actor} | action=${entry.action} | user=${entry.userId}`
    );
  }

  getAll(): AuditEntry[] {
    return [...this.log].reverse();
  }

  getByUser(userId: string): AuditEntry[] {
    return [...this.log].reverse().filter((e) => e.userId === userId);
  }

  exportCsv(userId?: string): string {
    const entries = userId ? this.getByUser(userId) : this.getAll();
    const header = 'id,timestamp,actor,action,userId,details\n';
    const rows = entries.map((e) =>
      `${e.id},${e.timestamp},${e.actor},${e.action},${e.userId},"${JSON.stringify(e.details).replace(/"/g, '""')}"`
    );
    return header + rows.join('\n');
  }
}

/**
 * Convenience function — creates a structured audit entry.
 * Use this throughout the agent to record all actions.
 */
export function buildAuditEntry(
  userId: string,
  actor: AuditActor,
  action: AuditAction,
  details: Record<string, unknown> = {}
): Omit<AuditEntry, 'id'> {
  return {
    userId,
    actor,
    action,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Pharos Agent Action Logger
 * Wraps the logger with typed helpers for each agent action.
 */
export class AgentAuditLogger {
  constructor(private writer: AuditLogWriter) {}

  async positionAdded(userId: string, platform: string, asset: string, entryValueUsd: number) {
    await this.writer.write(buildAuditEntry(userId, 'agent', 'position_added', {
      platform, asset, entryValueUsd,
    }));
  }

  async positionPolled(userId: string, positionId: string, platform: string, currentValueUsd: number, pnlPct: number) {
    await this.writer.write(buildAuditEntry(userId, 'agent', 'position_polled', {
      positionId, platform, currentValueUsd, pnlPct,
    }));
  }

  async alertFired(userId: string, positionId: string, alertType: string, severity: string, message: string) {
    await this.writer.write(buildAuditEntry(userId, 'agent', 'alert_fired', {
      positionId, alertType, severity, message,
    }));
  }

  async ruleCreated(userId: string, ruleId: string, ruleType: string, threshold: number) {
    await this.writer.write(buildAuditEntry(userId, 'user', 'rule_created', {
      ruleId, ruleType, threshold,
    }));
  }

  async ruleDeleted(userId: string, ruleId: string) {
    await this.writer.write(buildAuditEntry(userId, 'user', 'rule_deleted', { ruleId }));
  }

  async thresholdUpdated(userId: string, positionId: string, field: string, oldValue: unknown, newValue: unknown) {
    await this.writer.write(buildAuditEntry(userId, 'user', 'threshold_updated', {
      positionId, field, oldValue, newValue,
    }));
  }

  async sessionStarted(userId: string, channel: 'telegram' | 'dashboard') {
    await this.writer.write(buildAuditEntry(userId, 'user', 'session_started', { channel }));
  }

  async positionRemoved(userId: string, positionId: string, platform: string) {
    await this.writer.write(buildAuditEntry(userId, 'user', 'position_removed', {
      positionId, platform,
    }));
  }
}
