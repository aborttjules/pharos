/**
 * Pharos — Express REST API + WebSocket Server
 * Exposes position data, alerts, rules, and audit trail to the dashboard
 * READ-ONLY infrastructure — no transaction signing or execution
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import type { Position, Alert, AlertRule, WsEvent } from '../shared/types.js';
import type { PollEngine } from '../agent/poll-engine.js';
import type { MemoryAuditLogger } from '../agent/audit-logger.js';

// ── WebSocket broadcast registry ────────────────
const wsClients: Map<string, Set<WebSocket>> = new Map(); // userId → sockets

export function broadcastToUser(userId: string, event: WsEvent): void {
  const sockets = wsClients.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export function broadcastPositions(positions: Position[], userId: string): void {
  broadcastToUser(userId, {
    type: 'positions:update',
    payload: positions,
    timestamp: new Date().toISOString(),
  });
}

// ── Server factory ──────────────────────────────
export function createApiServer(engine: PollEngine, auditStore: MemoryAuditLogger) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── Health ──────────────────────────────────
  app.get('/health', (_, res) => {
    res.json({ status: 'ok', name: 'Pharos', mode: 'WATCHER_ONLY', timestamp: new Date().toISOString() });
  });

  // ── Positions ────────────────────────────────
  app.get('/api/positions/:userId', (req, res) => {
    const user = engine.getUser(req.params.userId);
    if (!user) return res.json({ positions: [] });
    const active = user.positions.filter((p) => p.status !== 'closed');
    res.json({ positions: active });
  });

  app.post('/api/positions/:userId', (req, res) => {
    const { platform, asset, entryValueUsd, poolId } = req.body as Partial<Position>;
    if (!platform || !asset || !entryValueUsd) {
      return res.status(400).json({ error: 'platform, asset, entryValueUsd required' });
    }
    const userId = req.params.userId;
    const user = engine.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newPos: Position = {
      id: crypto.randomUUID(),
      userId,
      platform,
      asset,
      poolId,
      entryValueUsd: Number(entryValueUsd),
      currentValueUsd: Number(entryValueUsd),
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      status: 'active',
      lastCheckedAt: new Date().toISOString(),
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    engine.updateUserPositions(userId, [...user.positions, newPos]);
    res.status(201).json({ position: newPos });
  });

  app.delete('/api/positions/:userId/:positionId', (req, res) => {
    const { userId, positionId } = req.params;
    const user = engine.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = user.positions.map((p) =>
      p.id === positionId ? { ...p, status: 'closed' as const, closedAt: new Date().toISOString() } : p
    );
    engine.updateUserPositions(userId, updated);
    res.json({ ok: true });
  });

  // ── Alerts ───────────────────────────────────
  // Simple in-memory alerts store reference (set by server startup)
  let alertsStore: Map<string, Alert[]> = new Map();

  app.get('/api/alerts/:userId', (req, res) => {
    const alerts = alertsStore.get(req.params.userId) ?? [];
    res.json({ alerts: alerts.slice(0, 50) });
  });

  app.patch('/api/alerts/:alertId/acknowledge', (req, res) => {
    // Update acknowledgedAt in all stores
    for (const [, alerts] of alertsStore) {
      const alert = alerts.find((a) => a.id === req.params.alertId);
      if (alert) {
        alert.acknowledgedAt = new Date().toISOString();
        break;
      }
    }
    res.json({ ok: true });
  });

  // ── Rules ────────────────────────────────────
  app.get('/api/rules/:userId', (req, res) => {
    const user = engine.getUser(req.params.userId);
    res.json({ rules: user?.rules ?? [] });
  });

  app.post('/api/rules/:userId', (req, res) => {
    const userId = req.params.userId;
    const user = engine.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rule: AlertRule = {
      id: crypto.randomUUID(),
      userId,
      ...req.body,
      enabled: true,
      cooldownSecs: req.body.cooldownSecs ?? 300,
      createdAt: new Date().toISOString(),
    };
    engine.updateUserRules(userId, [...user.rules, rule]);
    res.status(201).json({ rule });
  });

  app.delete('/api/rules/:userId/:ruleId', (req, res) => {
    const { userId, ruleId } = req.params;
    const user = engine.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    engine.updateUserRules(userId, user.rules.filter((r) => r.id !== ruleId));
    res.json({ ok: true });
  });

  // ── Audit ────────────────────────────────────
  app.get('/api/audit/:userId', (req, res) => {
    const entries = auditStore.getByUser(req.params.userId);
    res.json({ entries: entries.slice(0, 100) });
  });

  app.get('/api/audit/:userId/export', (req, res) => {
    const csv = auditStore.exportCsv(req.params.userId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="pharos-audit-${req.params.userId}.csv"`);
    res.send(csv);
  });

  // ── Expose alerts setter for server startup ──
  (app as express.Express & { setAlertsStore: (s: Map<string, Alert[]>) => void }).setAlertsStore =
    (s: Map<string, Alert[]>) => { alertsStore = s; };

  // ── HTTP + WebSocket server ──────────────────
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('userId') ?? 'anon';

    if (!wsClients.has(userId)) wsClients.set(userId, new Set());
    wsClients.get(userId)!.add(ws);
    console.log(`[WS] Client connected for user ${userId}`);

    // Heartbeat
    const hb = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', payload: null, timestamp: new Date().toISOString() }));
      }
    }, 10_000);

    ws.on('close', () => {
      clearInterval(hb);
      wsClients.get(userId)?.delete(ws);
      console.log(`[WS] Client disconnected for user ${userId}`);
    });
  });

  return { app, httpServer };
}
