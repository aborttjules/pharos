import assert from 'assert';
import { PositionReconciler } from '../agent/reconciler.js';
import { DriftDetector } from '../agent/drift-detector.js';
import { MemoryAuditLogger, AgentAuditLogger } from '../agent/audit-logger.js';
import type { Position, AlertRule } from '../shared/types.js';

function testReconciler() {
  const reconciler = new PositionReconciler();

  // Test Jupiter Reconcile
  const rawJup = [
    { tokenMint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', uiAmount: 10, priceUsd: 150, valueUsd: 1500 }
  ];
  const stored: Position[] = [];

  const reconciled = reconciler.reconcileJupiter('user1', rawJup, stored);
  assert.strictEqual(reconciled.length, 1);
  assert.strictEqual(reconciled[0].asset, 'SOL');
  assert.strictEqual(reconciled[0].entryValueUsd, 1500);
  assert.strictEqual(reconciled[0].currentValueUsd, 1500);
  assert.strictEqual(reconciled[0].unrealizedPnlPct, 0);
  assert.strictEqual(reconciled[0].status, 'active');

  // Test PnL changes
  const storedWithSol = [{ ...reconciled[0], entryValueUsd: 1500 }];
  const rawJupDropped = [
    { tokenMint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', uiAmount: 10, priceUsd: 142.5, valueUsd: 1425 } // down 5%
  ];
  const reconciled2 = reconciler.reconcileJupiter('user1', rawJupDropped, storedWithSol);
  assert.strictEqual(reconciled2[0].unrealizedPnlPct, -5);
  assert.strictEqual(reconciled2[0].status, 'warning'); // -5% default threshold

  const rawJupCritical = [
    { tokenMint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', uiAmount: 10, priceUsd: 135, valueUsd: 1350 } // down 10%
  ];
  const reconciled3 = reconciler.reconcileJupiter('user1', rawJupCritical, storedWithSol);
  assert.strictEqual(reconciled3[0].unrealizedPnlPct, -10);
  assert.strictEqual(reconciled3[0].status, 'critical'); // -10% default threshold

  console.log('✅ testReconciler — PASSED');
}

function testDriftDetector() {
  const detector = new DriftDetector();
  const lastAlertMap = new Map<string, number>();

  const pos: Position = {
    id: 'pos1',
    userId: 'user1',
    platform: 'jupiter',
    asset: 'SOL',
    entryValueUsd: 1000,
    currentValueUsd: 940, // down 6%
    unrealizedPnlUsd: -60,
    unrealizedPnlPct: -6,
    status: 'warning',
    lastCheckedAt: new Date().toISOString(),
    metadata: {},
    createdAt: new Date().toISOString()
  };

  // 1. Default alert triggered
  const rules: AlertRule[] = [];
  const alerts = detector.evaluate([pos], rules, lastAlertMap);
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].severity, 'warning');
  assert.ok(alerts[0].message.includes('SOL on JUPITER is down 6.0%'));

  // 2. Cooldown active
  const alerts2 = detector.evaluate([pos], rules, lastAlertMap);
  assert.strictEqual(alerts2.length, 0); // within cooldown

  // 3. Custom rules
  const customRule: AlertRule = {
    id: 'rule1',
    userId: 'user1',
    ruleType: 'value_below',
    operator: '<',
    threshold: 950,
    cooldownSecs: 300,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  const lastAlertMap2 = new Map<string, number>();
  const alerts3 = detector.evaluate([pos], [customRule], lastAlertMap2);
  assert.strictEqual(alerts3.length, 2); // 1 default warning, 1 custom rule below 950

  console.log('✅ testDriftDetector — PASSED');
}

function testAuditLogger() {
  const memStore = new MemoryAuditLogger();
  const logger = new AgentAuditLogger(memStore);

  logger.positionAdded('user1', 'jupiter', 'SOL', 1000);
  logger.alertFired('user1', 'pos1', 'loss_warning', 'warning', 'Down 5%');

  const entries = memStore.getAll();
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].action, 'alert_fired');
  assert.strictEqual(entries[1].action, 'position_added');
  assert.ok(memStore.exportCsv().includes('position_added'));

  console.log('✅ testAuditLogger — PASSED');
}

export function runEvaluatorTests() {
  console.log('\n📋 Running Evaluator/Reconciler Tests...');
  testReconciler();
  testDriftDetector();
  testAuditLogger();
  console.log('✅ All Evaluator/Reconciler Tests passed.\n');
}
