/**
 * Pharos — Raydium AMM v4 Integration
 * Reads LP token balances and estimates USD value. READ-ONLY. No signing.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { RaydiumPositionRaw } from '../shared/types.js';

const RAYDIUM_API_V3 = 'https://api-v3.raydium.io';
// Raydium LP Token Program
const LP_MINT_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

interface RaydiumPoolResponse {
  id: string;
  mintA: { symbol: string; address: string };
  mintB: { symbol: string; address: string };
  tvl: number;
  day: { apr: number };
  lpMint: { address: string; supply: string; decimals: number };
}

export class RaydiumIntegration {
  private connection: Connection;
  private poolCache: Map<string, RaydiumPoolResponse> = new Map();

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Fetch all Raydium AMM LP positions for a wallet.
   * Finds LP token accounts, matches them against known Raydium pools.
   */
  async fetchPositions(walletAddress: string): Promise<RaydiumPositionRaw[]> {
    try {
      const pubkey = new PublicKey(walletAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: new PublicKey(LP_MINT_PROGRAM),
      });

      const nonZero = tokenAccounts.value.filter(
        (a) => parseFloat(a.account.data.parsed.info.tokenAmount.amount) > 0
      );
      if (nonZero.length === 0) return [];

      const lpMints = nonZero.map((a) => ({
        mint: a.account.data.parsed.info.mint as string,
        uiAmount: a.account.data.parsed.info.tokenAmount.uiAmount as number,
      }));

      // Load all pools once (cached)
      const pools = await this.loadPools();

      const positions: RaydiumPositionRaw[] = [];

      for (const { mint, uiAmount } of lpMints) {
        const pool = pools.find((p) => p.lpMint?.address === mint);
        if (!pool) continue; // Not a known Raydium LP

        const totalSupply = parseFloat(pool.lpMint?.supply ?? '1') / Math.pow(10, pool.lpMint?.decimals ?? 6);
        const shareRatio = totalSupply > 0 ? uiAmount / totalSupply : 0;
        const shareUsd = shareRatio * (pool.tvl ?? 0);

        positions.push({
          lpMint: mint,
          poolId: pool.id,
          tokenA: pool.mintA?.symbol ?? 'TOKEN_A',
          tokenB: pool.mintB?.symbol ?? 'TOKEN_B',
          shareUsd,
          feeApr: pool.day?.apr ?? 0,
        });
      }

      return positions;
    } catch (err) {
      console.error('[Raydium] fetchPositions error:', err);
      return [];
    }
  }

  private async loadPools(): Promise<RaydiumPoolResponse[]> {
    try {
      const res = await fetch(`${RAYDIUM_API_V3}/pools/info/list?poolType=all&poolSortField=tvl&sortType=desc&pageSize=500&page=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { data?: { data?: RaydiumPoolResponse[] } };
      return data?.data?.data ?? [];
    } catch (err) {
      console.error('[Raydium] loadPools error:', err);
      return [];
    }
  }

  /** Fetch a single pool's current APR and TVL */
  async fetchPoolStats(poolId: string): Promise<{ apr: number; tvl: number } | null> {
    try {
      const res = await fetch(`${RAYDIUM_API_V3}/pools/info/ids?ids=${poolId}`);
      if (!res.ok) return null;
      const data = await res.json() as { data?: RaydiumPoolResponse[] };
      const pool = data?.data?.[0];
      return pool ? { apr: pool.day?.apr ?? 0, tvl: pool.tvl ?? 0 } : null;
    } catch {
      return null;
    }
  }
}
