/**
 * Pharos Test Runner
 * Uses Node.js built-in assert — no external test framework required.
 * Run: npm test
 */
import { runEvaluatorTests } from './evaluator.test.js';
import { runGatewayTests } from './gateway.test.js';
import { runApiTests } from './api.test.js';

async function main() {
  console.log('\n============================================================');
  console.log('  PHAROS — Test Suite');
  console.log('============================================================');

  let failures = 0;

  const suites = [
    { name: 'Evaluator', run: runEvaluatorTests },
    { name: 'Gateway', run: runGatewayTests },
    { name: 'API', run: runApiTests },
  ];

  for (const suite of suites) {
    try {
      await suite.run();
    } catch (err) {
      console.error(`\n❌ ${suite.name} suite FAILED:`, err);
      failures++;
    }
  }

  console.log('============================================================');
  if (failures === 0) {
    console.log('✅ All test suites passed.');
  } else {
    console.error(`❌ ${failures} test suite(s) failed.`);
    process.exit(1);
  }
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
