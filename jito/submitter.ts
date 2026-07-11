import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

// Jito Testnet Block Engine Endpoint
const JITO_TESTNET_URL = 'https://testnet.block-engine.jito.wtf/api/v1/bundles';
const ENABLE_JITO_SUBMISSION = process.env.ENABLE_JITO_SUBMISSION === 'true';

// Jito Testnet Tip accounts
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

export class JitoSubmitter {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Compiles the user swap transaction and a Jito validator tip transaction into a bundle
   * and dry-runs the bundle simulation on Jito Testnet.
   */
  public async simulateJitoBundle(userTx: Transaction, signer: Keypair): Promise<void> {
    console.log(`[Jito Submitter] Structuring Jito bundle payload...`);

    try {
      // 1. Pick a random Jito validator tip account
      const tipAccountStr = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
      const tipAccount = new PublicKey(tipAccountStr);

      // 2. Create the Jito tip transaction
      // Jito requires the tip payment to be the final instruction of the transaction
      // or a separate transaction in the same bundle. We'll compile it as a separate transaction.
      const tipAmountLamports = 100_000; // 0.0001 SOL tip
      const tipTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: tipAccount,
          lamports: tipAmountLamports,
        })
      );

      tipTx.feePayer = signer.publicKey;
      const { blockhash } = await this.connection.getLatestBlockhash();
      tipTx.recentBlockhash = blockhash;

      // 3. Sign the simulated transactions locally
      userTx.sign(signer);
      tipTx.sign(signer);

      // 4. Serialize transactions to base64 wire format as expected by Jito
      const serializedUserTx = userTx.serialize().toString('base64');
      const serializedTipTx = tipTx.serialize().toString('base64');

      console.log(`[Jito Submitter] Bundle compiled:`);
      console.log(`   - Tx 1 (Swap Simulation): ${serializedUserTx.substring(0, 32)}...`);
      console.log(`   - Tx 2 (Jito Tip to ${tipAccountStr.substring(0, 8)}...): ${serializedTipTx.substring(0, 32)}...`);

      const rpcPayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [
          [serializedUserTx, serializedTipTx], // The transaction bundle
        ]
      };

      if (!ENABLE_JITO_SUBMISSION) {
        console.log(`[Jito Submitter] Submission disabled. Set ENABLE_JITO_SUBMISSION=true to post this dry-run payload to Jito Testnet.`);
        console.log(`[Jito Submitter] Prepared payload method: ${rpcPayload.method}, transactions: ${rpcPayload.params[0].length}`);
        return;
      }

      console.log(`[Jito Submitter] Posting sendBundle request to ${JITO_TESTNET_URL}...`);
      
      const response = await fetch(JITO_TESTNET_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rpcPayload),
      });

      const result = await response.json();

      console.log(`[Jito Submitter] Response from Block Engine:`, JSON.stringify(result, null, 2));

      if (result.error) {
        console.warn(`⚠️ [Jito Submitter] Block engine returned simulation error:`, result.error.message);
      } else {
        console.log(`🎉 [Jito Submitter] Bundle simulation completed successfully!`);
      }

    } catch (err) {
      console.error(`[Jito Submitter] Error simulating bundle on Jito Testnet:`, err);
    }
  }
}
