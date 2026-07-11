/**
 * Pharos — Telegram Bot
 * Command interface for trade observation.
 * All commands are READ-ONLY. Pharos never executes trades.
 *
 * Commands:
 *   /watch <platform> <asset> <entry_usd> [stop:<pct>]
 *   /show
 *   /alerts
 *   /rules
 *   /rule add <type> <operator> <threshold>
 *   /audit
 *   /help
 */

import { Telegraf, Context } from 'telegraf';
import { randomUUID } from 'crypto';
import type { Position, AlertRule, Alert, RuleType, RuleOperator } from '../shared/types.js';
import { DEFAULT_LOSS_THRESHOLD_PCT } from '../shared/types.js';
import type { PollEngine, WatchedUser } from '../agent/poll-engine.js';
import type { AgentAuditLogger } from '../agent/audit-logger.js';

// In-memory alert store per user (replace with DB in production)
const userAlerts: Map<string, Alert[]> = new Map();

export function addAlertToStore(alert: Alert): void {
  const key = alert.userId;
  const list = userAlerts.get(key) ?? [];
  list.unshift(alert); // newest first
  if (list.length > 100) list.pop();
  userAlerts.set(key, list);
}

// ──────────────────────────────────────────────
// Telegram ID → User ID mapping (ephemeral for dev)
// ──────────────────────────────────────────────
const telegramToUserId: Map<string, string> = new Map();

function getUserId(ctx: Context): string {
  const telegramId = String(ctx.from?.id ?? 'anonymous');
  if (!telegramToUserId.has(telegramId)) {
    telegramToUserId.set(telegramId, randomUUID());
  }
  return telegramToUserId.get(telegramId)!;
}

// ──────────────────────────────────────────────
// Bot setup
// ──────────────────────────────────────────────
export function createTelegramBot(
  token: string,
  engine: PollEngine,
  auditLogger: AgentAuditLogger,
  rpcUrl: string
): Telegraf {
  const bot = new Telegraf(token);

  // ── /start ──────────────────────────────────
  bot.start((ctx) => {
    const userId = getUserId(ctx);
    auditLogger.sessionStarted(userId, 'telegram');
    ctx.reply(
      `👁 *Pharos — Trade Observation Infrastructure*\n\n` +
      `I watch your already-taken positions across 4 Solana platforms and alert you when positions are at risk.\n\n` +
      `I never sign, execute, or submit transactions.\n\n` +
      `*Commands:*\n` +
      `/watch — Add a position to watch\n` +
      `/show — View all positions\n` +
      `/alerts — Recent alert history\n` +
      `/rules — Your custom alert rules\n` +
      `/audit — Agent action audit trail\n` +
      `/help — Full command reference\n\n` +
      `Default loss alert: ⚠️ at -${DEFAULT_LOSS_THRESHOLD_PCT}% | 🛑 at -${DEFAULT_LOSS_THRESHOLD_PCT * 2}%`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /help ────────────────────────────────────
  bot.command('help', (ctx) => {
    ctx.reply(
      `*Pharos Command Reference*\n\n` +
      `*/watch <platform> <asset> <entry_usd>*\n` +
      `Platforms: jupiter | orca | raydium | marinade\n` +
      `Example: /watch jupiter SOL 500\n\n` +
      `*/show* — All active positions with P&L\n\n` +
      `*/alerts* — Last 10 alerts fired\n\n` +
      `*/rules* — List your active rules\n\n` +
      `*/rule add <type> <op> <threshold>*\n` +
      `Types: loss_threshold | price_drift | value_below | value_above\n` +
      `Example: /rule add loss_threshold < -8\n\n` +
      `*/rule remove <id>* — Delete a rule\n\n` +
      `*/audit* — Last 20 agent actions\n\n` +
      `*/stop <asset>* — Stop watching a position`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /watch ───────────────────────────────────
  bot.command('watch', async (ctx) => {
    const userId = getUserId(ctx);
    const text = ctx.message.text.replace('/watch', '').trim();
    const parts = text.split(/\s+/);

    if (parts.length < 3) {
      return ctx.reply('Usage: /watch <platform> <asset> <entry_usd>\nExample: /watch jupiter SOL 500');
    }

    const [platformRaw, asset, entryStr] = parts;
    const platform = platformRaw.toLowerCase() as Position['platform'];
    const validPlatforms = ['jupiter', 'orca', 'raydium', 'marinade', 'manual'];

    if (!validPlatforms.includes(platform)) {
      return ctx.reply(`❌ Unknown platform. Use: ${validPlatforms.join(' | ')}`);
    }

    const entryValueUsd = parseFloat(entryStr);
    if (isNaN(entryValueUsd) || entryValueUsd <= 0) {
      return ctx.reply('❌ Entry value must be a positive number in USD.');
    }

    const newPosition: Position = {
      id: randomUUID(),
      userId,
      platform,
      asset,
      entryValueUsd,
      currentValueUsd: entryValueUsd, // starts at entry until next poll
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      status: 'active',
      lastCheckedAt: new Date().toISOString(),
      metadata: {},
      createdAt: new Date().toISOString(),
    };

    // Register or update user in engine
    let user = engine.getUser(userId);
    if (!user) {
      const walletAddress = ctx.from?.username ?? 'manual-watch';
      user = { userId, walletAddress, telegramChatId: String(ctx.chat.id), positions: [], rules: [] };
      engine.registerUser(user);
    }

    const updatedPositions = [...(user.positions ?? []), newPosition];
    engine.updateUserPositions(userId, updatedPositions);
    await auditLogger.positionAdded(userId, platform, asset, entryValueUsd);

    ctx.reply(
      `✅ *Watching ${asset} on ${platform.toUpperCase()}*\n\n` +
      `Entry value: $${entryValueUsd.toFixed(2)}\n` +
      `Default alert: ⚠️ at -${DEFAULT_LOSS_THRESHOLD_PCT}% ($${(entryValueUsd * 0.95).toFixed(2)}) | ` +
      `🛑 at -${DEFAULT_LOSS_THRESHOLD_PCT * 2}% ($${(entryValueUsd * 0.90).toFixed(2)})\n\n` +
      `Pharos will alert you if this position falls below threshold.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /show ────────────────────────────────────
  bot.command('show', async (ctx) => {
    const userId = getUserId(ctx);
    const user = engine.getUser(userId);
    const positions = user?.positions.filter((p) => p.status !== 'closed') ?? [];

    if (positions.length === 0) {
      return ctx.reply('No active positions. Use /watch to add one.');
    }

    const lines = positions.map((p) => {
      const icon = p.status === 'critical' ? '🛑' : p.status === 'warning' ? '⚠️' : '✅';
      const pnlSign = p.unrealizedPnlUsd >= 0 ? '+' : '';
      return (
        `${icon} *${p.asset}* (${p.platform.toUpperCase()})\n` +
        `Entry: $${p.entryValueUsd.toFixed(2)} → Now: $${p.currentValueUsd.toFixed(2)}\n` +
        `P&L: ${pnlSign}$${p.unrealizedPnlUsd.toFixed(2)} (${pnlSign}${p.unrealizedPnlPct.toFixed(1)}%)\n` +
        `Last checked: ${new Date(p.lastCheckedAt).toLocaleTimeString()}`
      );
    });

    ctx.reply(
      `📊 *${positions.length} Active Position(s)*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /alerts ───────────────────────────────────
  bot.command('alerts', (ctx) => {
    const userId = getUserId(ctx);
    const alerts = (userAlerts.get(userId) ?? []).slice(0, 10);

    if (alerts.length === 0) {
      return ctx.reply('No alerts yet. Pharos will message you when thresholds are breached.');
    }

    const lines = alerts.map((a) => {
      const icon = a.severity === 'critical' ? '🛑' : a.severity === 'warning' ? '⚠️' : 'ℹ️';
      return `${icon} ${new Date(a.sentAt).toLocaleString()}\n${a.message}`;
    });

    ctx.reply(`🔔 *Last ${alerts.length} Alert(s)*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
  });

  // ── /rules ───────────────────────────────────
  bot.command('rules', (ctx) => {
    const userId = getUserId(ctx);
    const user = engine.getUser(userId);
    const rules = (user?.rules ?? []).filter((r) => r.enabled);

    if (rules.length === 0) {
      return ctx.reply(
        `No custom rules yet.\n\n` +
        `Default rule active: Alert at -${DEFAULT_LOSS_THRESHOLD_PCT}% from entry.\n\n` +
        `Add rules with: /rule add <type> <operator> <threshold>\n` +
        `Example: /rule add loss_threshold < -8`
      );
    }

    const lines = rules.map((r, i) =>
      `${i + 1}. \`${r.id.slice(0, 8)}\` | ${r.ruleType} ${r.operator} ${r.threshold}` +
      (r.cooldownSecs ? ` | cooldown: ${r.cooldownSecs}s` : '')
    );

    ctx.reply(`⚙️ *Active Rules*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  // ── /rule ────────────────────────────────────
  bot.command('rule', async (ctx) => {
    const userId = getUserId(ctx);
    const text = ctx.message.text.replace('/rule', '').trim();
    const parts = text.split(/\s+/);
    const subCmd = parts[0]?.toLowerCase();

    if (subCmd === 'add') {
      // /rule add <type> <operator> <threshold> [cooldown:<secs>]
      if (parts.length < 4) {
        return ctx.reply('Usage: /rule add <type> <operator> <threshold>\nExample: /rule add loss_threshold < -8');
      }
      const [, ruleType, operator, thresholdStr] = parts;
      const threshold = parseFloat(thresholdStr);

      if (isNaN(threshold)) return ctx.reply('❌ Threshold must be a number.');

      const newRule: AlertRule = {
        id: randomUUID(),
        userId,
        ruleType: ruleType as RuleType,
        threshold,
        operator: operator as RuleOperator,
        cooldownSecs: 300,
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      const user = engine.getUser(userId);
      if (user) {
        engine.updateUserRules(userId, [...user.rules, newRule]);
        await auditLogger.ruleCreated(userId, newRule.id, ruleType, threshold);
      }

      ctx.reply(
        `✅ *Rule Added*\nType: ${ruleType} | When: value ${operator} ${threshold} | Cooldown: 5 min`,
        { parse_mode: 'Markdown' }
      );
    } else if (subCmd === 'remove') {
      const ruleIdPrefix = parts[1];
      const user = engine.getUser(userId);
      if (!user) return ctx.reply('No rules found.');

      const rule = user.rules.find((r) => r.id.startsWith(ruleIdPrefix));
      if (!rule) return ctx.reply(`❌ Rule with ID starting with "${ruleIdPrefix}" not found.`);

      engine.updateUserRules(userId, user.rules.filter((r) => r.id !== rule.id));
      await auditLogger.ruleDeleted(userId, rule.id);
      ctx.reply(`✅ Rule \`${rule.id.slice(0, 8)}\` removed.`, { parse_mode: 'Markdown' });
    } else {
      ctx.reply('Usage: /rule add <type> <op> <threshold> OR /rule remove <id>');
    }
  });

  // ── /stop ────────────────────────────────────
  bot.command('stop', async (ctx) => {
    const userId = getUserId(ctx);
    const asset = ctx.message.text.replace('/stop', '').trim();
    const user = engine.getUser(userId);

    if (!user || !asset) return ctx.reply('Usage: /stop <asset>  e.g. /stop SOL');

    const pos = user.positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase() && p.status !== 'closed');
    if (!pos) return ctx.reply(`❌ No active position found for ${asset}.`);

    const updated = user.positions.map((p) => p.id === pos.id ? { ...p, status: 'closed' as const, closedAt: new Date().toISOString() } : p);
    engine.updateUserPositions(userId, updated);
    await auditLogger.positionRemoved(userId, pos.id, pos.platform);

    ctx.reply(`✅ Stopped watching *${asset}* on ${pos.platform.toUpperCase()}.`, { parse_mode: 'Markdown' });
  });

  // ── /audit ────────────────────────────────────
  bot.command('audit', (ctx) => {
    // For now uses the MemoryAuditLogger — will use DB in production
    ctx.reply(
      `📋 *Audit Rail*\n\nAudit trail is available on the dashboard.\nNavigate to the Audit tab to view and export agent action history as CSV.\n\n` +
      `_All Pharos agent actions are logged: positions added, polls run, alerts fired, rules created._`,
      { parse_mode: 'Markdown' }
    );
  });

  return bot;
}
