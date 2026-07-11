import * as net from 'net';
import * as fs from 'fs';

export const SOCKET_PATH = '/tmp/poc_mev_agent.sock';

/**
 * SwapEvent mirrors the Rust SwapEvent struct exactly.
 * All timestamps are in milliseconds for latency measurement.
 */
export interface SwapEvent {
  signature: string;
  slot: number;
  signer: string;
  source: 'Raydium' | 'Jupiter' | 'Unknown';
  source_subscription_id: number;  // which logsSubscribe subscription fired
  logs: string[];
  timestamp_ms: number;            // on-chain event time (ms)
  ingest_ts_ms: number;            // Rust UDS dispatch timestamp (ms)
  uds_receive_ts_ms: number;       // TypeScript receive timestamp (ms) — stamped on arrival
}

export class UdsServer {
  private server: net.Server | null = null;
  private connections: Set<net.Socket> = new Set();

  constructor(private onEvent: (event: SwapEvent) => void) {}

  public start(): void {
    // Cleanup stale socket file from a previous run
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch (err) {
        console.error(`[UDS] Failed to unlink stale socket path ${SOCKET_PATH}:`, err);
      }
    }

    this.server = net.createServer((socket) => {
      console.log('[UDS] Rust ingestion client connected.');
      this.connections.add(socket);

      let buffer = '';

      socket.on('data', (data) => {
        buffer += data.toString();
        let boundary = buffer.indexOf('\n');

        while (boundary !== -1) {
          const line = buffer.substring(0, boundary).trim();
          buffer = buffer.substring(boundary + 1);
          boundary = buffer.indexOf('\n');

          if (!line) continue;

          try {
            const raw = JSON.parse(line);
            // Stamp receive timestamp immediately on arrival
            const event: SwapEvent = {
              ...raw,
              uds_receive_ts_ms: Date.now(),
            };

            const ingestDelay = event.uds_receive_ts_ms - (event.ingest_ts_ms || event.uds_receive_ts_ms);
            console.log(
              `[UDS] Event received | source=${event.source} | sig=${event.signature.substring(0, 12)}... | Δ ingest→receive: ${ingestDelay}ms`
            );

            this.onEvent(event);
          } catch (err) {
            console.error('[UDS] Failed to parse incoming SwapEvent JSON:', err);
          }
        }
      });

      socket.on('close', () => {
        console.log('[UDS] Ingestion client disconnected.');
        this.connections.delete(socket);
      });

      socket.on('error', (err) => {
        console.error('[UDS] Socket connection error:', err);
      });
    });

    this.server.listen(SOCKET_PATH, () => {
      console.log(`[UDS] Server listening on ${SOCKET_PATH}`);
      try {
        fs.chmodSync(SOCKET_PATH, '0777');
      } catch (err) {
        console.warn('[UDS] Could not set socket permissions:', err);
      }
    });

    this.server.on('error', (err) => {
      console.error('[UDS] Server error:', err);
    });
  }

  public stop(): void {
    for (const conn of this.connections) {
      conn.destroy();
    }
    if (this.server) {
      this.server.close();
    }
    if (fs.existsSync(SOCKET_PATH)) {
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch {
        // Ignored during shutdown
      }
    }
  }
}
