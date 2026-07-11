import assert from 'assert';
import http from 'http';
import { createApiServer } from '../api/server.js';
import { PollEngine } from '../agent/poll-engine.js';
import { MemoryAuditLogger } from '../agent/audit-logger.js';

interface HttpResponse {
  statusCode: number;
  body: string;
}

function httpPost(path: string, body: string | null, contentType = 'application/json'): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body ?? ''),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () =>
        resolve({ statusCode: res.statusCode ?? 0, body: data })
      );
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpGet(path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () =>
        resolve({ statusCode: res.statusCode ?? 0, body: data })
      );
    });

    req.on('error', reject);
    req.end();
  });
}

async function testHealthEndpoint() {
  const res = await httpGet('/health');
  assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}`);
  const json = JSON.parse(res.body);
  assert.strictEqual(json.status, 'ok', 'Health should return status: ok');
  assert.strictEqual(json.mode, 'WATCHER_ONLY', 'mode should be WATCHER_ONLY');
  console.log('✅ testHealthEndpoint — PASSED');
}

async function testPositionsEndpoints() {
  // Add a position
  const newPos = {
    platform: 'jupiter',
    asset: 'SOL',
    entryValueUsd: 1000
  };
  const addRes = await httpPost('/api/positions/demo-user', JSON.stringify(newPos));
  assert.strictEqual(addRes.statusCode, 201, `Expected 201, got ${addRes.statusCode}`);
  const added = JSON.parse(addRes.body).position;
  assert.strictEqual(added.asset, 'SOL');
  assert.strictEqual(added.entryValueUsd, 1000);

  // Retrieve positions
  const getRes = await httpGet('/api/positions/demo-user');
  assert.strictEqual(getRes.statusCode, 200);
  const data = JSON.parse(getRes.body);
  assert.ok(Array.isArray(data.positions));
  assert.ok(data.positions.some((p: { asset: string }) => p.asset === 'SOL'));

  console.log('✅ testPositionsEndpoints — PASSED');
}

async function testRulesEndpoints() {
  const newRule = {
    ruleType: 'loss_threshold',
    operator: '<',
    threshold: -10,
  };
  const addRes = await httpPost('/api/rules/demo-user', JSON.stringify(newRule));
  assert.strictEqual(addRes.statusCode, 201);
  const added = JSON.parse(addRes.body).rule;
  assert.strictEqual(added.ruleType, 'loss_threshold');
  assert.strictEqual(added.threshold, -10);

  const getRes = await httpGet('/api/rules/demo-user');
  assert.strictEqual(getRes.statusCode, 200);
  const data = JSON.parse(getRes.body);
  assert.ok(Array.isArray(data.rules));

  console.log('✅ testRulesEndpoints — PASSED');
}

export async function runApiTests() {
  console.log('\n📋 Running API Tests (launching temporary test server)...');

  const auditStore = new MemoryAuditLogger();
  const engine = new PollEngine(
    'https://api.mainnet-beta.solana.com',
    async () => {},
    () => {}
  );

  // Register demo-user in engine so endpoints don't return 404
  engine.registerUser({
    userId: 'demo-user',
    walletAddress: '11111111111111111111111111111111',
    positions: [],
    rules: []
  });

  const { app, httpServer } = createApiServer(engine, auditStore);

  // Start server on port 3001
  await new Promise<void>((resolve) => {
    httpServer.listen(3001, () => {
      resolve();
    });
  });

  try {
    await testHealthEndpoint();
    await testPositionsEndpoints();
    await testRulesEndpoints();
    console.log('✅ All API Tests passed.\n');
  } finally {
    // Close server
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
  }
}
