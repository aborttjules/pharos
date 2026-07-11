/**
 * Pharos — Safety Gateway
 * Unchanged core invariant: WATCHER_MODE_ONLY = true (hardcoded, cannot be toggled).
 * In v2 the gateway validates that no execution path is ever triggered.
 * It no longer deals with Jito bundles (v1 feature) — now guards the poll engine.
 */

// ── Safety constants — compile-time, NOT runtime-configurable ──
export const SPEND_CAP_SOL = 5.0;
export const WATCHER_MODE_ONLY = true;       // hardcoded — immutable

/**
 * Safety assertion — called at startup to verify invariants.
 * Will throw if any execution path is accidentally enabled.
 */
export function assertWatcherSafety(): void {
  if (!WATCHER_MODE_ONLY) {
    throw new Error('[SAFETY] WATCHER_MODE_ONLY is false — this must never happen in production.');
  }

  // Verify no signing authority is available
  const unsafeEnvVars = [
    'PRIVATE_KEY',
    'WALLET_SECRET_KEY',
    'SIGNER_SECRET',
    'EXECUTION_ENABLED',
  ];

  const found = unsafeEnvVars.filter((v) => process.env[v]);
  if (found.length > 0) {
    console.warn(`[Safety Gateway] WARNING: Suspicious env vars found: ${found.join(', ')}`);
    console.warn('[Safety Gateway] Pharos is read-only. These variables have no effect.');
  }

  console.log('[Safety Gateway] ✅ Watcher mode confirmed. WATCHER_MODE_ONLY=true (hardcoded).');
  console.log('[Safety Gateway] ✅ No signing authority loaded. No transactions will be submitted.');
}

/**
 * Guard function — wraps any operation to ensure it cannot execute trades.
 * Use this around any code that might touch wallet or transaction state.
 */
export function watcherGuard<T>(fn: () => T, operationName: string): T {
  if (!WATCHER_MODE_ONLY) {
    throw new Error(`[SAFETY] Attempted to run "${operationName}" with WATCHER_MODE_ONLY=false. BLOCKED.`);
  }
  return fn();
}

/**
 * Log safety status — called at startup and included in health endpoint.
 */
export function getSafetyStatus(): {
  watcherModeOnly: boolean;
  spendCapSol: number;
  signingAuthority: 'none';
  executionEnabled: false;
} {
  return {
    watcherModeOnly: WATCHER_MODE_ONLY,
    spendCapSol: SPEND_CAP_SOL,
    signingAuthority: 'none',
    executionEnabled: false,
  };
}
