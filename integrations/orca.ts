/**
 * Pharos — Orca Whirlpool Integration
 * Reads LP position accounts for a wallet. READ-ONLY. No signing.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { OrcaPositionRaw } from '../shared/types.js';

// Orca Whirlpool program ID (mainnet)
const WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';

// Orca position account discriminator (first 8 bytes of SHA256("account:Position"))
const POSITION_DISCRIMINATOR = Buffer.from([170, 188, 143, 228, 122, 64, 247, 208]);

interface WhirlpoolPositionData {
  whirlpool: PublicKey;
  positionMint: PublicKey;
  liquidity: bigint;
  tickLowerIndex: number;
  tickUpperIndex: number;
}

export class OrcaIntegration {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Fetch all Orca Whirlpool LP positions for a wallet.
   * Uses token account lookup to find position NFTs, then reads position data.
   */
  async fetchPositions(walletAddress: string): Promise<OrcaPositionRaw[]> {
    try {
      const pubkey = new PublicKey(walletAddress);

      // Get all token accounts — position NFTs have amount=1
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      });

      const nftMints = tokenAccounts.value
        .filter((a) => a.account.data.parsed.info.tokenAmount.amount === '1')
        .map((a) => a.account.data.parsed.info.mint as string);

      if (nftMints.length === 0) return [];

      const positions: OrcaPositionRaw[] = [];

      for (const mint of nftMints) {
        const posData = await this.readPositionAccount(mint);
        if (!posData) continue;

        // Derive pool info (simplified — in production use Orca SDK)
        const poolInfo = await this.getPoolInfo(posData.whirlpool.toBase58());

        positions.push({
          positionMint: mint,
          poolAddress: posData.whirlpool.toBase58(),
          tokenA: poolInfo.tokenA,
          tokenB: poolInfo.tokenB,
          liquidityUsd: poolInfo.liquidityUsd,
          feesEarnedUsd: 0, // Requires Orca SDK for accurate fees
          inRange: this.isInRange(posData.tickLowerIndex, posData.tickUpperIndex, poolInfo.currentTick),
        });
      }

      return positions;
    } catch (err) {
      console.error('[Orca] fetchPositions error:', err);
      return [];
    }
  }

  private async readPositionAccount(positionMint: string): Promise<WhirlpoolPositionData | null> {
    try {
      // Derive position PDA from mint
      const [positionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('position'), new PublicKey(positionMint).toBuffer()],
        new PublicKey(WHIRLPOOL_PROGRAM_ID)
      );

      const accountInfo = await this.connection.getAccountInfo(positionPda);
      if (!accountInfo) return null;

      // Check discriminator
      if (!accountInfo.data.slice(0, 8).equals(POSITION_DISCRIMINATOR)) return null;

      // Parse position data (simplified layout)
      const data = accountInfo.data;
      const whirlpool = new PublicKey(data.slice(8, 40));
      const positionMintPubkey = new PublicKey(data.slice(40, 72));
      const liquidity = data.readBigUInt64LE(72);
      const tickLowerIndex = data.readInt32LE(88);
      const tickUpperIndex = data.readInt32LE(92);

      return { whirlpool, positionMint: positionMintPubkey, liquidity, tickLowerIndex, tickUpperIndex };
    } catch {
      return null;
    }
  }

  private async getPoolInfo(poolAddress: string): Promise<{
    tokenA: string; tokenB: string; liquidityUsd: number; currentTick: number;
  }> {
    try {
      // Fetch pool metadata from Orca API
      const res = await fetch(`https://api.orca.so/v2/solana/whirlpool/${poolAddress}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        tokenA?: { symbol?: string };
        tokenB?: { symbol?: string };
        tvl?: number;
        price?: number;
      };
      return {
        tokenA: data.tokenA?.symbol ?? 'TOKEN_A',
        tokenB: data.tokenB?.symbol ?? 'TOKEN_B',
        liquidityUsd: data.tvl ?? 0,
        currentTick: Math.log(data.price ?? 1) / Math.log(1.0001),
      };
    } catch {
      return { tokenA: 'TOKEN_A', tokenB: 'TOKEN_B', liquidityUsd: 0, currentTick: 0 };
    }
  }

  private isInRange(tickLower: number, tickUpper: number, currentTick: number): boolean {
    return currentTick >= tickLower && currentTick <= tickUpper;
  }
}
