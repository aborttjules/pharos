/**
 * Pharos — Entry Point
 * Bootstraps: Poll Engine, Telegram Bot, API Server.
 * WATCHER_MODE_ONLY = true — this system never signs or executes transactions.
 */

import 'dotenv/config';
import { PollEngine } from './agent/poll-engine.js';
import { AgentAuditLogger, MemoryAuditLogger } from './agent/audit-logger.js';
import { createTelegramBot, addAlertToStore } from './telegram-bot/bot.js';
import { createApiServer, broadcastPositions, broadcastToUser } from './api/server.js';
import type { Alert, Position, WsEvent } from './shared/types.js';

// ── Constants ────────────────────────────────────────
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const WATCHER_MODE_ONLY = true; // Hardcoded — cannot be changed at runtime

// ── Shared alert store ─────────────────────────────
const alertsStore = new Map<string, Alert[]>();

// ── Alert dispatcher — fires when drift detector triggers ──
async function onAlert(alert: Alert, user: { telegramChatId?: string; userId: string }): Promise<void> {
  // Store alert
  const list = alertsStore.get(user.userId) ?? [];
  list.unshift(alert);
  if (list.length > 100) list.pop();
  alertsStore.set(user.userId, list);

  // Push to Telegram bot store
  addAlertToStore(alert);

  // Broadcast to dashboard via WS
  broadcastToUser(user.userId, {
    type: 'alert:fired',
    payload: alert,
    timestamp: new Date().toISOString(),
  } as WsEvent<Alert>);

  // Send Telegram message if bot is active
  if (TELEGRAM_TOKEN && user.telegramChatId) {
    await sendTelegramMessage(user.telegramChatId, alert.message);
  }

  console.log(`[Pharos] Alert fired | user=${user.userId} | type=${alert.alertType} | severity=${alert.severity}`);
}

// Simple Telegram message sender (avoids circular import)
async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('[Pharos] Telegram send error:', err);
  }
}

// ── Main bootstrap ────────────────────────────────
async function main(): Promise<void> {
  console.log('\n══════════════════════════════════════════');
  console.log('  Pharos — Trade Observation Infrastructure');
  console.log('══════════════════════════════════════════');
  console.log(`  Mode         : WATCHER_ONLY (hardcoded=${WATCHER_MODE_ONLY})`);
  console.log(`  RPC URL      : ${RPC_URL.slice(0, 40)}...`);
  console.log(`  Port         : ${PORT}`);
  console.log(`  Telegram     : ${TELEGRAM_TOKEN ? 'configured' : 'NOT configured'}`);
  console.log('══════════════════════════════════════════\n');

  // ── Audit Logger ──────────────────────────────
  const auditStore = new MemoryAuditLogger();
  const auditLogger = new AgentAuditLogger(auditStore);

  // ── Poll Engine ──────────────────────────────
  const engine = new PollEngine(
    RPC_URL,
    (alert, user) => onAlert(alert, user),
    (positions: Position[], userId: string) => broadcastPositions(positions, userId)
  );

  // ── API Server ────────────────────────────────
  const { app, httpServer } = createApiServer(engine, auditStore);
  (app as typeof app & { setAlertsStore: (s: Map<string, Alert[]>) => void }).setAlertsStore(alertsStore);

  httpServer.listen(PORT, () => {
    console.log(`[API] Pharos API listening on http://localhost:${PORT}`);
    console.log(`[API] WebSocket at ws://localhost:${PORT}/ws?userId=<id>`);
  });

  // ── Telegram Bot ─────────────────────────────
  if (TELEGRAM_TOKEN) {
    const bot = createTelegramBot(TELEGRAM_TOKEN, engine, auditLogger, RPC_URL);
    await bot.launch();
    console.log('[Telegram] Bot launched. WATCHER_MODE_ONLY — no execution commands available.');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN not set — bot disabled.');
  }

  // ── Start Polling ─────────────────────────────
  engine.start();

  console.log('\n[Pharos] System ready. Watching for position drift...');
  console.log('[Pharos] No transactions will be signed or executed.\n');

  // Graceful shutdown
  process.on('SIGINT', () => {
    engine.stop();
    httpServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Pharos] Fatal startup error:', err);
  process.exit(1);
});
