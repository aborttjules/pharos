/**
 * Pharos — Marinade Finance Integration
 * Reads mSOL (staked SOL) balance and estimates USD value. READ-ONLY.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { MarinadePositionRaw } from '../shared/types.js';

// mSOL mint address (mainnet)
const MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Marinade state account (mainnet) — stores mSOL/SOL exchange rate
const MARINADE_STATE_PUBKEY = '8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC';

// Jupiter price API for mSOL price
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

interface MarinadeStateLayout {
  msolSupply: bigint;
  solLeg: bigint;
}

export class MarinadeIntegration {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Fetch Marinade staking position for a wallet.
   * Returns mSOL balance, USD value, estimated APR, and epoch rewards.
   */
  async fetchPosition(walletAddress: string): Promise<MarinadePositionRaw | null> {
    try {
      const pubkey = new PublicKey(walletAddress);

      // Find mSOL token account
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, {
        mint: new PublicKey(MSOL_MINT),
      });

      if (tokenAccounts.value.length === 0) return null;

      const mSolAccount = tokenAccounts.value[0];
      const mSolBalance: number = mSolAccount.account.data.parsed.info.tokenAmount.uiAmount ?? 0;

      if (mSolBalance <= 0) return null;

      // Fetch mSOL price in USD from Jupiter
      const mSolPriceUsd = await this.fetchMsolPrice();

      // Fetch staking APR from Marinade API
      const marinadeStats = await this.fetchMarinadeStats();

      const valueUsd = mSolBalance * mSolPriceUsd;
      const dailyRewardRate = marinadeStats.apr / 365 / 100;
      const epochRewardsUsd = valueUsd * dailyRewardRate * 2; // ~2 days per epoch

      return {
        mSolBalance,
        mSolPriceUsd,
        valueUsd,
        stakingApr: marinadeStats.apr,
        epochRewardsUsd,
      };
    } catch (err) {
      console.error('[Marinade] fetchPosition error:', err);
      return null;
    }
  }

  /** Convert wallet address to array for compatibility with multi-platform reconciler */
  async fetchPositions(walletAddress: string): Promise<MarinadePositionRaw[]> {
    const pos = await this.fetchPosition(walletAddress);
    return pos ? [pos] : [];
  }

  private async fetchMsolPrice(): Promise<number> {
    try {
      const res = await fetch(`${JUPITER_PRICE_API}?ids=${MSOL_MINT}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data?: Record<string, { price: string }> };
      return parseFloat(json.data?.[MSOL_MINT]?.price ?? '0');
    } catch {
      // Fallback: mSOL ≈ SOL price (rough approximation)
      return 0;
    }
  }

  private async fetchMarinadeStats(): Promise<{ apr: number; totalStaked: number }> {
    try {
      const res = await fetch('https://api.marinade.finance/msol/apy/1d');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { value?: number };
      return {
        apr: (data.value ?? 0.065) * 100, // Convert from decimal to percent
        totalStaked: 0,
      };
    } catch {
      return { apr: 6.5, totalStaked: 0 }; // Fallback APR
    }
  }
}
