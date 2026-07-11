/**
 * Pharos — Position Reconciler
 * Normalises raw positions from all 4 platforms into a unified Position schema.
 * READ-ONLY. Never signs or broadcasts anything.
 */

import { randomUUID } from 'crypto';
import type {
  Position, Platform,
  JupiterPositionRaw, OrcaPositionRaw,
  RaydiumPositionRaw, MarinadePositionRaw,
} from '../shared/types.js';
import { DEFAULT_LOSS_THRESHOLD_PCT } from '../shared/types.js';

export class PositionReconciler {
  /**
   * Reconcile a fresh platform snapshot against stored positions.
   * Returns the updated position list with current values and P&L.
   */
  reconcileJupiter(
    userId: string,
    raws: JupiterPositionRaw[],
    stored: Position[]
  ): Position[] {
    return raws.map((raw) => {
      const existing = stored.find(
        (p) => p.platform === 'jupiter' && p.asset === raw.symbol
      );
      return this.buildPosition({
        userId,
        platform: 'jupiter',
        asset: raw.symbol,
        poolId: raw.tokenMint,
        currentValueUsd: raw.valueUsd,
        existing,
      });
    });
  }

  reconcileOrca(
    userId: string,
    raws: OrcaPositionRaw[],
    stored: Position[]
  ): Position[] {
    return raws.map((raw) => {
      const asset = `${raw.tokenA}-${raw.tokenB} LP`;
      const existing = stored.find(
        (p) => p.platform === 'orca' && p.poolId === raw.poolAddress
      );
      return this.buildPosition({
        userId,
        platform: 'orca',
        asset,
        poolId: raw.poolAddress,
        currentValueUsd: raw.liquidityUsd,
        existing,
        metadata: { inRange: raw.inRange, feesEarnedUsd: raw.feesEarnedUsd },
      });
    });
  }

  reconcileRaydium(
    userId: string,
    raws: RaydiumPositionRaw[],
    stored: Position[]
  ): Position[] {
    return raws.map((raw) => {
      const asset = `${raw.tokenA}-${raw.tokenB} LP`;
      const existing = stored.find(
        (p) => p.platform === 'raydium' && p.poolId === raw.poolId
      );
      return this.buildPosition({
        userId,
        platform: 'raydium',
        asset,
        poolId: raw.poolId,
        currentValueUsd: raw.shareUsd,
        existing,
        metadata: { feeApr: raw.feeApr, lpMint: raw.lpMint },
      });
    });
  }

  reconcileMarinade(
    userId: string,
    raws: MarinadePositionRaw[],
    stored: Position[]
  ): Position[] {
    return raws.map((raw) => {
      const existing = stored.find((p) => p.platform === 'marinade');
      return this.buildPosition({
        userId,
        platform: 'marinade',
        asset: 'mSOL (Staked SOL)',
        poolId: 'marinade-state',
        currentValueUsd: raw.valueUsd,
        existing,
        metadata: {
          mSolBalance: raw.mSolBalance,
          stakingApr: raw.stakingApr,
          epochRewardsUsd: raw.epochRewardsUsd,
        },
      });
    });
  }

  private buildPosition(params: {
    userId: string;
    platform: Platform;
    asset: string;
    poolId?: string;
    currentValueUsd: number;
    existing?: Position;
    metadata?: Record<string, unknown>;
  }): Position {
    const {
      userId, platform, asset, poolId,
      currentValueUsd, existing, metadata = {},
    } = params;

    const entryValueUsd = existing?.entryValueUsd ?? currentValueUsd;
    const unrealizedPnlUsd = currentValueUsd - entryValueUsd;
    const unrealizedPnlPct = entryValueUsd > 0
      ? (unrealizedPnlUsd / entryValueUsd) * 100
      : 0;

    const status = this.computeStatus(unrealizedPnlPct, existing);

    return {
      id: existing?.id ?? randomUUID(),
      userId,
      platform,
      asset,
      poolId,
      entryValueUsd,
      currentValueUsd,
      unrealizedPnlUsd,
      unrealizedPnlPct,
      status,
      lastCheckedAt: new Date().toISOString(),
      metadata: { ...existing?.metadata, ...metadata },
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
  }

  private computeStatus(pnlPct: number, existing?: Position): Position['status'] {
    if (existing?.status === 'closed') return 'closed';
    // 5% default threshold — alert zone starts here
    if (pnlPct <= -DEFAULT_LOSS_THRESHOLD_PCT * 2) return 'critical'; // -10% → critical
    if (pnlPct <= -DEFAULT_LOSS_THRESHOLD_PCT) return 'warning';      // -5%  → warning
    return 'active';
  }
}
