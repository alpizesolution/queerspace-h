// Runs the emulator-backed tests (the API integration tests and the Firestore rules tests) the same way on Windows, macOS and
// Linux: it sets the switch the tests look for, then starts the emulators and runs the tests inside them.
// Extra arguments go to `firebase emulators:exec`, e.g.  npm run test:emulator -- --config my-firebase.json
import { spawnSync } from 'node:child_process';

const inner = 'npx tsx --test --test-concurrency=1 test/api/*.integration.test.js test/firestore-rules.test.ts';
// With a shell (Windows) the arguments are joined into one command line, so the inner command must carry its own quotes.
const windows = process.platform === 'win32';
const args = ['firebase', 'emulators:exec', '--project', 'demo-queerspace-test', '--only', 'auth,firestore', ...process.argv.slice(2), windows ? `"${inner}"` : inner];
const result = spawnSync(windows ? 'npx.cmd' : 'npx', args, {
  stdio: 'inherit',
  shell: windows,
  env: { ...process.env, SIGNALS_INTEGRATION_TESTS: 'true' },
});
process.exit(result.status ?? 1);
