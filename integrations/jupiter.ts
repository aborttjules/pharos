/**
 * Pharos — Jupiter Integration
 * Reads SPL token balances for a wallet and fetches USD prices.
 * READ-ONLY. No signing. No transactions.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { JupiterPositionRaw } from '../shared/types.js';

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const TOKEN_LIST_API = 'https://token.jup.ag/strict';

// Well-known token mints (Solana mainnet)
const KNOWN_SYMBOLS: Record<string, string> = {
  'So11111111111111111111111111111111111111112': 'SOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 'stSOL',
};

interface JupPriceResponse {
  data: Record<string, { id: string; mintSymbol: string; price: string }>;
}

export class JupiterIntegration {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Fetch all SPL token positions for a wallet address.
   * Returns normalised JupiterPositionRaw array.
   */
  async fetchPositions(walletAddress: string): Promise<JupiterPositionRaw[]> {
    try {
      const pubkey = new PublicKey(walletAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      });

      const nonZeroAccounts = tokenAccounts.value.filter(
        (a) => a.account.data.parsed.info.tokenAmount.uiAmount > 0
      );

      if (nonZeroAccounts.length === 0) return [];

      // Batch price fetch
      const mints = nonZeroAccounts.map((a) => a.account.data.parsed.info.mint);
      const prices = await this.fetchPrices(mints);

      const positions: JupiterPositionRaw[] = [];

      for (const account of nonZeroAccounts) {
        const info = account.account.data.parsed.info;
        const mint: string = info.mint;
        const uiAmount: number = info.tokenAmount.uiAmount ?? 0;
        const priceUsd = prices[mint] ?? 0;

        positions.push({
          tokenMint: mint,
          symbol: KNOWN_SYMBOLS[mint] ?? mint.slice(0, 6) + '...',
          uiAmount,
          priceUsd,
          valueUsd: uiAmount * priceUsd,
        });
      }

      return positions.filter((p) => p.valueUsd > 0.01); // Filter dust
    } catch (err) {
      console.error('[Jupiter] fetchPositions error:', err);
      return [];
    }
  }

  /** Fetch USD prices for multiple mints from Jupiter Price API v2 */
  async fetchPrices(mints: string[]): Promise<Record<string, number>> {
    if (mints.length === 0) return {};
    try {
      const ids = mints.join(',');
      const res = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as JupPriceResponse;
      const out: Record<string, number> = {};
      for (const [mint, data] of Object.entries(json.data ?? {})) {
        out[mint] = parseFloat(data.price);
      }
      return out;
    } catch (err) {
      console.error('[Jupiter] fetchPrices error:', err);
      return {};
    }
  }

  /** Fetch single asset price by mint */
  async fetchPrice(mint: string): Promise<number> {
    const prices = await this.fetchPrices([mint]);
    return prices[mint] ?? 0;
  }
}
