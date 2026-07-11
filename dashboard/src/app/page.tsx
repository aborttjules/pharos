'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import './globals.css';

// ── Types (mirrored from shared/types.ts) ──────
type Platform = 'jupiter' | 'orca' | 'raydium' | 'marinade' | 'manual';
type PositionStatus = 'active' | 'warning' | 'critical' | 'closed';
type AlertSeverity = 'info' | 'warning' | 'critical';
type RuleType = 'price_drift' | 'loss_threshold' | 'value_below' | 'value_above' | 'lp_fee_drop' | 'stake_reward_drop';
type RuleOperator = '>' | '<' | '>=' | '<=' | '==';
type Tab = 'positions' | 'alerts' | 'rules' | 'audit';

interface Position {
  id: string; userId: string; platform: Platform; asset: string;
  poolId?: string; entryValueUsd: number; currentValueUsd: number;
  unrealizedPnlUsd: number; unrealizedPnlPct: number;
  status: PositionStatus; lastCheckedAt: string; metadata: Record<string, unknown>; createdAt: string;
}

interface Alert {
  id: string; userId: string; positionId: string;
  alertType: string; severity: AlertSeverity; message: string;
  valueAtAlert: number; sentVia: string[]; sentAt: string; acknowledgedAt?: string;
}

interface AlertRule {
  id: string; userId: string; positionId?: string;
  ruleType: RuleType; threshold: number; operator: RuleOperator;
  lookbackSecs?: number; cooldownSecs: number; enabled: boolean;
  lastFiredAt?: string; createdAt: string;
}

interface AuditEntry {
  id: string; userId: string; actor: string; action: string;
  details: Record<string, unknown>; timestamp: string;
}

// ── Constants ──────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const WS_URL = (process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws');
const DEFAULT_USER_ID = 'demo-user'; // Replace with real auth
const DEFAULT_LOSS_THRESHOLD_PCT = 5;

// ── Helpers ─────────────────────────────────────
const pnlClass = (pct: number) =>
  pct > 0 ? 'pnl-positive' : pct < 0 ? 'pnl-negative' : 'pnl-neutral';

const pnlSign = (n: number) => (n >= 0 ? '+' : '');

const platformClass: Record<Platform, string> = {
  jupiter: 'platform-jupiter', orca: 'platform-orca',
  raydium: 'platform-raydium', marinade: 'platform-marinade', manual: 'platform-manual',
};

const platformEmoji: Record<Platform, string> = {
  jupiter: '⚡', orca: '🐋', raydium: '⚗️', marinade: '🥩', manual: '📝',
};

const statusBadge = (status: PositionStatus) => {
  if (status === 'critical') return <span className="badge badge-red">🛑 Critical</span>;
  if (status === 'warning')  return <span className="badge badge-yellow">⚠️ Warning</span>;
  if (status === 'closed')   return <span className="badge badge-blue">◼ Closed</span>;
  return <span className="badge badge-green">✅ Active</span>;
};

const severityIcon = (s: AlertSeverity) =>
  s === 'critical' ? '🛑' : s === 'warning' ? '⚠️' : 'ℹ️';

const severityClass = (s: AlertSeverity) =>
  `alert-icon alert-icon-${s}`;

// ── Add Position Modal ──────────────────────────
function AddPositionModal({ onAdd, onClose }: {
  onAdd: (p: Partial<Position>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ platform: 'jupiter', asset: '', entryValueUsd: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.asset || !form.entryValueUsd) return;
    onAdd({ platform: form.platform as Platform, asset: form.asset, entryValueUsd: parseFloat(form.entryValueUsd) });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" style={{ width: 420, animation: 'fadeIn 0.2s ease' }}>
        <div className="card-header">
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>👁 Watch New Position</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <p className="text-muted text-sm" style={{ marginBottom: 20 }}>
          Pharos will observe this position and alert you at −{DEFAULT_LOSS_THRESHOLD_PCT}% from entry.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">Platform</label>
            <select className="form-select" value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
              {(['jupiter','orca','raydium','marinade','manual'] as Platform[]).map(p =>
                <option key={p} value={p}>{platformEmoji[p]} {p.charAt(0).toUpperCase() + p.slice(1)}</option>
              )}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Asset / Position Name</label>
            <input className="form-input" placeholder="SOL, SOL-USDC LP, mSOL..." value={form.asset} onChange={e => setForm({ ...form, asset: e.target.value })} required />
          </div>
          <div className="form-group">
            <label className="form-label">Entry Value (USD)</label>
            <input className="form-input" type="number" placeholder="500.00" min="0.01" step="0.01" value={form.entryValueUsd} onChange={e => setForm({ ...form, entryValueUsd: e.target.value })} required />
          </div>
          {form.entryValueUsd && (
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Alert thresholds:</div>
              <div style={{ color: 'var(--yellow)' }}>⚠️ Warning at −5%: ${(parseFloat(form.entryValueUsd) * 0.95).toFixed(2)}</div>
              <div style={{ color: 'var(--red)' }}>🛑 Critical at −10%: ${(parseFloat(form.entryValueUsd) * 0.90).toFixed(2)}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Start Watching</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Dashboard ──────────────────────────────
export default function PharosDashboard() {
  const [tab, setTab] = useState<Tab>('positions');
  const [positions, setPositions] = useState<Position[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRule, setNewRule] = useState({ ruleType: 'loss_threshold', operator: '<', threshold: '' });
  const wsRef = useRef<WebSocket | null>(null);
  const userId = DEFAULT_USER_ID;

  // ── Data fetch ─────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [posRes, alertRes, ruleRes, auditRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/positions/${userId}`),
        fetch(`${API_BASE}/api/alerts/${userId}`),
        fetch(`${API_BASE}/api/rules/${userId}`),
        fetch(`${API_BASE}/api/audit/${userId}`),
      ]);
      if (posRes.status === 'fulfilled' && posRes.value.ok) {
        const d = await posRes.value.json() as { positions: Position[] };
        setPositions(d.positions ?? []);
      }
      if (alertRes.status === 'fulfilled' && alertRes.value.ok) {
        const d = await alertRes.value.json() as { alerts: Alert[] };
        setAlerts(d.alerts ?? []);
      }
      if (ruleRes.status === 'fulfilled' && ruleRes.value.ok) {
        const d = await ruleRes.value.json() as { rules: AlertRule[] };
        setRules(d.rules ?? []);
      }
      if (auditRes.status === 'fulfilled' && auditRes.value.ok) {
        const d = await auditRes.value.json() as { entries: AuditEntry[] };
        setAudit(d.entries ?? []);
      }
    } catch { /* silently ignore */ }
  }, [userId]);

  // ── WebSocket ──────────────────────────────────
  useEffect(() => {
    fetchAll();

    const connect = () => {
      const ws = new WebSocket(`${WS_URL}?userId=${userId}`);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus('live');
      ws.onclose = () => { setWsStatus('offline'); setTimeout(connect, 3000); };
      ws.onerror = () => setWsStatus('offline');

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string; payload: unknown };
          if (msg.type === 'positions:update') setPositions(msg.payload as Position[]);
          if (msg.type === 'alert:fired') {
            setAlerts(prev => [msg.payload as Alert, ...prev].slice(0, 50));
          }
        } catch { /* ignore */ }
      };
    };

    connect();
    return () => wsRef.current?.close();
  }, [fetchAll, userId]);

  // ── Computed stats ─────────────────────────────
  const activePositions = positions.filter(p => p.status !== 'closed');
  const totalValue = activePositions.reduce((s, p) => s + p.currentValueUsd, 0);
  const totalPnl = activePositions.reduce((s, p) => s + p.unrealizedPnlUsd, 0);
  const totalPnlPct = activePositions.reduce((s, p) => s + p.entryValueUsd, 0) > 0
    ? (totalPnl / activePositions.reduce((s, p) => s + p.entryValueUsd, 0)) * 100 : 0;
  const criticalCount = activePositions.filter(p => p.status === 'critical').length;
  const warningCount = activePositions.filter(p => p.status === 'warning').length;
  const unresolvedAlerts = alerts.filter(a => !a.acknowledgedAt).length;

  // ── Handlers ───────────────────────────────────
  const handleAddPosition = async (partial: Partial<Position>) => {
    try {
      await fetch(`${API_BASE}/api/positions/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      await fetchAll();
    } catch { /* ignore */ }
  };

  const handleRemovePosition = async (positionId: string) => {
    await fetch(`${API_BASE}/api/positions/${userId}/${positionId}`, { method: 'DELETE' });
    await fetchAll();
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.threshold) return;
    await fetch(`${API_BASE}/api/rules/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newRule, threshold: parseFloat(newRule.threshold), cooldownSecs: 300 }),
    });
    setNewRule({ ruleType: 'loss_threshold', operator: '<', threshold: '' });
    await fetchAll();
  };

  const handleDeleteRule = async (ruleId: string) => {
    await fetch(`${API_BASE}/api/rules/${userId}/${ruleId}`, { method: 'DELETE' });
    await fetchAll();
  };

  const handleExportAudit = () => {
    window.open(`${API_BASE}/api/audit/${userId}/export`, '_blank');
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    await fetch(`${API_BASE}/api/alerts/${alertId}/acknowledge`, { method: 'PATCH' });
    await fetchAll();
  };

  return (
    <>
      {showAddModal && <AddPositionModal onAdd={handleAddPosition} onClose={() => setShowAddModal(false)} />}

      <div className="app-layout">
        {/* ── Header ── */}
        <header className="app-header">
          <div className="pharos-logo">
            <div className="pharos-logo-dot" />
            Pharos
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {criticalCount > 0 && (
              <span className="badge badge-red">🛑 {criticalCount} Critical</span>
            )}
            {warningCount > 0 && (
              <span className="badge badge-yellow">⚠️ {warningCount} Warning</span>
            )}
            <div className="live-indicator">
              <div className={wsStatus === 'live' ? 'live-dot' : ''} style={wsStatus !== 'live' ? { width: 6, height: 6, background: 'var(--text-muted)', borderRadius: '50%' } : {}} />
              {wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? 'Connecting...' : 'Offline'}
            </div>
          </div>
        </header>

        {/* ── Sidebar ── */}
        <aside className="app-sidebar">
          <div className="nav-section-label">Overview</div>
          {(['positions','alerts','rules','audit'] as Tab[]).map(t => (
            <button key={t} className={`nav-item${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'positions' && '📊'}
              {t === 'alerts'   && '🔔'}
              {t === 'rules'    && '⚙️'}
              {t === 'audit'    && '📋'}
              {' '}{t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'alerts' && unresolvedAlerts > 0 && (
                <span className="badge badge-red btn-sm" style={{ marginLeft: 'auto' }}>{unresolvedAlerts}</span>
              )}
            </button>
          ))}

          <div className="nav-section-label" style={{ marginTop: 32 }}>Platforms</div>
          {(['jupiter','orca','raydium','marinade'] as Platform[]).map(p => {
            const count = activePositions.filter(pos => pos.platform === p).length;
            return (
              <div key={p} className="nav-item" style={{ cursor: 'default' }}>
                <span className={`platform-pill platform-${p}`}>{platformEmoji[p]} {p}</span>
                {count > 0 && <span className="text-muted text-sm" style={{ marginLeft: 'auto' }}>{count}</span>}
              </div>
            );
          })}

          <div style={{ padding: '24px 16px 0' }}>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px', fontSize: 11, color: 'var(--text-muted)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>Default Loss Alert</div>
              <div style={{ color: 'var(--yellow)' }}>⚠️ −{DEFAULT_LOSS_THRESHOLD_PCT}% from entry</div>
              <div style={{ color: 'var(--red)' }}>🛑 −{DEFAULT_LOSS_THRESHOLD_PCT * 2}% critical</div>
            </div>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="app-main">
          {/* Stats */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Portfolio Value</div>
              <div className="stat-value">${totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
              <div className="stat-sub">{activePositions.length} active position{activePositions.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total P&amp;L</div>
              <div className={`stat-value ${pnlClass(totalPnl)}`}>
                {pnlSign(totalPnl)}${Math.abs(totalPnl).toFixed(2)}
              </div>
              <div className="stat-sub">
                <span className={pnlClass(totalPnlPct)}>{pnlSign(totalPnlPct)}{totalPnlPct.toFixed(2)}%</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Active Alerts</div>
              <div className="stat-value" style={{ color: unresolvedAlerts > 0 ? 'var(--yellow)' : 'var(--text-primary)' }}>
                {unresolvedAlerts}
              </div>
              <div className="stat-sub">{alerts.length} total fired</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Custom Rules</div>
              <div className="stat-value">{rules.filter(r => r.enabled).length}</div>
              <div className="stat-sub">+1 default threshold</div>
            </div>
          </div>

          {/* ── Positions Tab ── */}
          {tab === 'positions' && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Watched Positions</span>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>+ Watch Position</button>
              </div>

              {activePositions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">👁</div>
                  <div className="empty-title">No positions watched yet</div>
                  <div className="empty-desc">Add a position and Pharos will alert you when it drifts below your threshold.</div>
                  <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>Watch First Position</button>
                </div>
              ) : (
                <table className="position-table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Platform</th>
                      <th>Entry</th>
                      <th>Current</th>
                      <th>P&amp;L</th>
                      <th>Status</th>
                      <th>Last Poll</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePositions.map(pos => (
                      <tr key={pos.id}>
                        <td><strong>{pos.asset}</strong></td>
                        <td>
                          <span className={`platform-pill platform-${pos.platform}`}>
                            {platformEmoji[pos.platform]} {pos.platform}
                          </span>
                        </td>
                        <td className="mono">${pos.entryValueUsd.toFixed(2)}</td>
                        <td className="mono">${pos.currentValueUsd.toFixed(2)}</td>
                        <td>
                          <span className={pnlClass(pos.unrealizedPnlPct)}>
                            {pnlSign(pos.unrealizedPnlUsd)}${Math.abs(pos.unrealizedPnlUsd).toFixed(2)}<br />
                            <span style={{ fontSize: 11 }}>{pnlSign(pos.unrealizedPnlPct)}{pos.unrealizedPnlPct.toFixed(1)}%</span>
                          </span>
                        </td>
                        <td>{statusBadge(pos.status)}</td>
                        <td className="text-muted text-sm mono">
                          {new Date(pos.lastCheckedAt).toLocaleTimeString()}
                        </td>
                        <td>
                          <button className="btn btn-danger btn-sm" onClick={() => handleRemovePosition(pos.id)}>Stop</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Alerts Tab ── */}
          {tab === 'alerts' && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Alert History</span>
                <span className="text-muted text-sm">{alerts.length} total</span>
              </div>
              {alerts.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🔔</div>
                  <div className="empty-title">No alerts fired yet</div>
                  <div className="empty-desc">Pharos will alert you when positions approach loss thresholds.</div>
                </div>
              ) : alerts.map(alert => (
                <div key={alert.id} className="alert-item">
                  <div className={severityClass(alert.severity)}>{severityIcon(alert.severity)}</div>
                  <div style={{ flex: 1 }}>
                    <div className="alert-message">{alert.message}</div>
                    <div className="alert-meta">
                      {new Date(alert.sentAt).toLocaleString()} · via {alert.sentVia.join(', ')}
                      {alert.acknowledgedAt && ' · ✓ acknowledged'}
                    </div>
                  </div>
                  {!alert.acknowledgedAt && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleAcknowledgeAlert(alert.id)}>Ack</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Rules Tab ── */}
          {tab === 'rules' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Default rule info */}
              <div className="card" style={{ borderColor: 'rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.03)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 20 }}>⚙️</span>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Default Loss Alert (always active)</div>
                    <div className="text-secondary text-sm">
                      ⚠️ Warning when position falls −{DEFAULT_LOSS_THRESHOLD_PCT}% from entry cost<br />
                      🛑 Critical when position falls −{DEFAULT_LOSS_THRESHOLD_PCT * 2}% from entry cost<br />
                      Cooldown: 5 minutes between same alert type
                    </div>
                  </div>
                </div>
              </div>

              {/* Add custom rule */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Add Custom Rule</span>
                </div>
                <form onSubmit={handleAddRule} className="rule-form">
                  <div className="form-group">
                    <label className="form-label">Rule Type</label>
                    <select className="form-select" value={newRule.ruleType} onChange={e => setNewRule({ ...newRule, ruleType: e.target.value as RuleType })}>
                      <option value="loss_threshold">Loss Threshold (%)</option>
                      <option value="value_below">Value Below ($)</option>
                      <option value="value_above">Value Above ($)</option>
                      <option value="price_drift">Price Drift (%)</option>
                      <option value="lp_fee_drop">LP Fee Drop (%)</option>
                      <option value="stake_reward_drop">Stake Reward Drop</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Operator</label>
                    <select className="form-select" value={newRule.operator} onChange={e => setNewRule({ ...newRule, operator: e.target.value as RuleOperator })}>
                      {(['<','<=','>','>=','=='] as RuleOperator[]).map(op => <option key={op} value={op}>{op}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Threshold</label>
                    <input className="form-input" type="number" step="0.1" placeholder="-8" value={newRule.threshold} onChange={e => setNewRule({ ...newRule, threshold: e.target.value })} required />
                  </div>
                  <button type="submit" className="btn btn-primary">Add Rule</button>
                </form>

                {rules.length === 0 ? (
                  <div className="empty-state" style={{ padding: 24 }}>
                    <div className="empty-desc">No custom rules yet. Add a rule above.</div>
                  </div>
                ) : (
                  <table className="position-table">
                    <thead>
                      <tr><th>Rule Type</th><th>Condition</th><th>Cooldown</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {rules.map(rule => (
                        <tr key={rule.id}>
                          <td><span className="badge badge-blue">{rule.ruleType}</span></td>
                          <td className="mono">{rule.operator} {rule.threshold}</td>
                          <td className="text-muted text-sm">{rule.cooldownSecs}s</td>
                          <td>{rule.enabled ? <span className="badge badge-green">Active</span> : <span className="badge badge-blue">Paused</span>}</td>
                          <td><button className="btn btn-danger btn-sm" onClick={() => handleDeleteRule(rule.id)}>Delete</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── Audit Tab ── */}
          {tab === 'audit' && (
            <div className="card">
              <div className="card-header">
                <span className="card-title">Agent Audit Trail</span>
                <button className="btn btn-ghost btn-sm" onClick={handleExportAudit}>⬇ Export CSV</button>
              </div>
              <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
                Every action Pharos takes is recorded here. No strategy data is stored — only position values and alert events.
              </p>
              {audit.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <div className="empty-icon">📋</div>
                  <div className="empty-desc">No agent actions recorded yet. Start watching a position to begin the audit trail.</div>
                </div>
              ) : audit.map(entry => (
                <div key={entry.id} className="audit-row">
                  <div className="audit-time">{new Date(entry.timestamp).toLocaleTimeString()}</div>
                  <div className="audit-actor">
                    <span className={`badge ${entry.actor === 'agent' ? 'badge-blue' : 'badge-green'}`}>{entry.actor}</span>
                  </div>
                  <div className="audit-action">{entry.action}</div>
                  <div className="audit-details">{JSON.stringify(entry.details)}</div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
