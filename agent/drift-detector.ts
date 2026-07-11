/**
 * Pharos — Drift Detector
 * Evaluates positions for loss risk at every poll cycle.
 * Default: alert when position is at or below 5% from entry cost.
 * User-defined rules can override this threshold.
 * Pharos is READ-ONLY — it only emits alerts, never acts.
 */

import { randomUUID } from 'crypto';
import type { Position, Alert, AlertRule, AlertSeverity } from '../shared/types.js';
import {
  DEFAULT_LOSS_THRESHOLD_PCT,
  ALERT_COOLDOWN_DEFAULT_SECS,
} from '../shared/types.js';

export interface DriftEvaluation {
  alerts: Alert[];
  positions: Position[];
}

export class DriftDetector {
  /**
   * Evaluate all positions against default threshold + user rules.
   * Returns any alerts that should be fired this cycle.
   */
  evaluate(
    positions: Position[],
    rules: AlertRule[],
    lastAlertMap: Map<string, number> // positionId → last alert unix ms
  ): Alert[] {
    const alerts: Alert[] = [];

    for (const pos of positions) {
      if (pos.status === 'closed') continue;

      // ── Default 5% loss threshold ───────────────────────────────
      const defaultAlerts = this.checkDefaultThreshold(pos, lastAlertMap);
      alerts.push(...defaultAlerts);

      // ── User-defined rules ──────────────────────────────────────
      const ruleAlerts = this.evaluateRules(pos, rules, lastAlertMap);
      alerts.push(...ruleAlerts);
    }

    return alerts;
  }

  // ──────────────────────────────────────────────────────────────
  // Default loss threshold (5% from entry, hardcoded baseline)
  // ──────────────────────────────────────────────────────────────
  private checkDefaultThreshold(
    pos: Position,
    lastAlertMap: Map<string, number>
  ): Alert[] {
    const alerts: Alert[] = [];
    const cooldownMs = ALERT_COOLDOWN_DEFAULT_SECS * 1000;
    const alertKey = `${pos.id}:default`;
    const lastFired = lastAlertMap.get(alertKey) ?? 0;

    if (Date.now() - lastFired < cooldownMs) return []; // cooldown active

    // Warning: reached 5% (default threshold)
    if (pos.unrealizedPnlPct <= -DEFAULT_LOSS_THRESHOLD_PCT && pos.unrealizedPnlPct > -DEFAULT_LOSS_THRESHOLD_PCT * 2) {
      alerts.push(this.buildAlert(pos, 'loss_warning', 'warning',
        `⚠️ ${pos.asset} on ${pos.platform.toUpperCase()} is down ${Math.abs(pos.unrealizedPnlPct).toFixed(1)}% from entry. ` +
        `Entry: $${pos.entryValueUsd.toFixed(2)} → Now: $${pos.currentValueUsd.toFixed(2)} | ` +
        `P&L: $${pos.unrealizedPnlUsd.toFixed(2)}`
      ));
      lastAlertMap.set(alertKey, Date.now());
    }

    // Critical: at or below -10% (2× default)
    if (pos.unrealizedPnlPct <= -DEFAULT_LOSS_THRESHOLD_PCT * 2) {
      alerts.push(this.buildAlert(pos, 'loss_warning', 'critical',
        `🛑 CRITICAL: ${pos.asset} on ${pos.platform.toUpperCase()} is DOWN ${Math.abs(pos.unrealizedPnlPct).toFixed(1)}% from entry! ` +
        `Entry: $${pos.entryValueUsd.toFixed(2)} → Now: $${pos.currentValueUsd.toFixed(2)} | ` +
        `Loss: $${Math.abs(pos.unrealizedPnlUsd).toFixed(2)}`
      ));
      lastAlertMap.set(alertKey, Date.now());
    }

    return alerts;
  }

  // ──────────────────────────────────────────────────────────────
  // User-defined alert rules
  // ──────────────────────────────────────────────────────────────
  private evaluateRules(
    pos: Position,
    rules: AlertRule[],
    lastAlertMap: Map<string, number>
  ): Alert[] {
    const alerts: Alert[] = [];
    const now = Date.now();

    const applicableRules = rules.filter(
      (r) => r.enabled && (!r.positionId || r.positionId === pos.id)
    );

    for (const rule of applicableRules) {
      const alertKey = `${pos.id}:rule:${rule.id}`;
      const lastFired = lastAlertMap.get(alertKey) ?? 0;
      const cooldownMs = rule.cooldownSecs * 1000;

      if (now - lastFired < cooldownMs) continue;

      const triggered = this.evaluateRule(pos, rule);
      if (!triggered) continue;

      const severity = this.ruleToSeverity(rule, pos);
      alerts.push(this.buildAlert(pos, 'custom_rule', severity,
        `📋 Rule triggered on ${pos.asset} (${pos.platform}): ` +
        `${rule.ruleType} ${rule.operator} ${rule.threshold} | ` +
        `Current value: $${pos.currentValueUsd.toFixed(2)}`
      ));
      lastAlertMap.set(alertKey, now);
    }

    return alerts;
  }

  private evaluateRule(pos: Position, rule: AlertRule): boolean {
    let value: number;

    switch (rule.ruleType) {
      case 'loss_threshold':
        value = pos.unrealizedPnlPct;
        break;
      case 'value_below':
      case 'value_above':
        value = pos.currentValueUsd;
        break;
      case 'price_drift':
        value = Math.abs(pos.unrealizedPnlPct);
        break;
      default:
        value = pos.unrealizedPnlPct;
    }

    switch (rule.operator) {
      case '>': return value > rule.threshold;
      case '<': return value < rule.threshold;
      case '>=': return value >= rule.threshold;
      case '<=': return value <= rule.threshold;
      case '==': return Math.abs(value - rule.threshold) < 0.001;
      default: return false;
    }
  }

  private ruleToSeverity(rule: AlertRule, pos: Position): AlertSeverity {
    if (pos.unrealizedPnlPct <= -10) return 'critical';
    if (pos.unrealizedPnlPct <= -5) return 'warning';
    return 'info';
  }

  private buildAlert(
    pos: Position,
    alertType: Alert['alertType'],
    severity: AlertSeverity,
    message: string
  ): Alert {
    return {
      id: randomUUID(),
      userId: pos.userId,
      positionId: pos.id,
      alertType,
      severity,
      message,
      valueAtAlert: pos.currentValueUsd,
      sentVia: ['telegram', 'dashboard'],
      sentAt: new Date().toISOString(),
    };
  }
}
