import assert from 'assert';
import * as gateway from '../gateway/kernel.js';

function testWatcherModeSafety() {
  // Test watcher safety assertion doesn't throw under normal WATCHER_MODE_ONLY conditions
  assert.strictEqual(gateway.WATCHER_MODE_ONLY, true, 'WATCHER_MODE_ONLY must be hardcoded to true');
  assert.strictEqual(gateway.SPEND_CAP_SOL, 5.0, 'SPEND_CAP_SOL must be 5.0');

  // assertWatcherSafety should run without throwing under test env (where we don't set unsafe envs)
  assert.doesNotThrow(() => {
    gateway.assertWatcherSafety();
  });

  console.log('✅ testWatcherModeSafety — PASSED');
}

function testWatcherGuard() {
  // Test that guard lets a safe operation proceed
  const val = gateway.watcherGuard(() => 42, 'SafeRead');
  assert.strictEqual(val, 42);

  console.log('✅ testWatcherGuard — PASSED');
}

function testSafetyStatus() {
  const status = gateway.getSafetyStatus();
  assert.strictEqual(status.watcherModeOnly, true);
  assert.strictEqual(status.spendCapSol, 5.0);
  assert.strictEqual(status.executionEnabled, false);

  console.log('✅ testSafetyStatus — PASSED');
}

export function runGatewayTests() {
  console.log('\n📋 Running Gateway Tests...');
  testWatcherModeSafety();
  testWatcherGuard();
  testSafetyStatus();
  console.log('✅ All Gateway Tests passed.\n');
}
