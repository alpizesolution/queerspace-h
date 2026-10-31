import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Vercel turns every file under api/ into a function, except files and folders whose name starts with "_".
// The Hobby plan allows 12 Serverless Functions per deployment (Edge functions are counted separately), and a
// failed deployment follows the moment one more file appears. This keeps a safe margin below that limit.
const SAFE_MAX = 10;
const ROUTE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx']);

function routeFiles(dir = 'api') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const full = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (ROUTE_EXTENSIONS.has(path.extname(entry.name))) found.push(full);
  }
  return found.sort();
}

const isEdge = (file) => /runtime:\s*['"]edge['"]/.test(fs.readFileSync(file, 'utf8'));

test('the deployment stays under the Vercel Hobby limit of Serverless Functions', () => {
  const files = routeFiles();
  const serverless = files.filter((file) => !isEdge(file));
  assert.ok(
    serverless.length <= SAFE_MAX,
    `${serverless.length} Serverless Functions (limit 12, keep ${SAFE_MAX} or fewer): ${serverless.join(', ')}`
  );
});

test('only real endpoints live in api/: no tests, specs or helpers that Vercel would deploy as functions', () => {
  const files = routeFiles();
  const stray = files.filter((file) => /\.(test|spec)\.[a-z]+$/.test(file));
  assert.deepEqual(stray, [], `Move these out of api/ (tests belong in test/api/): ${stray.join(', ')}`);
  // Shared code is prefixed with "_" so it is imported, not deployed.
  assert.deepEqual(files, ['api/admin-growth.js', 'api/age.js', 'api/firebase-auth.js', 'api/match.js', 'api/pseudonym.js', 'api/signals.js']);
});

test('the public API addresses are unchanged', () => {
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const rewrites = vercel.rewrites.map((r) => `${r.source} -> ${r.destination}`);
  assert.ok(rewrites.includes('/__/auth/:path* -> /api/firebase-auth?p=__/auth/:path*'));
  assert.ok(rewrites.includes('/__/firebase/:path* -> /api/firebase-auth?p=__/firebase/:path*'));
  // The app calls these by name; each must still have its own file.
  for (const name of ['admin-growth', 'age', 'match', 'pseudonym', 'signals']) assert.ok(fs.existsSync(`api/${name}.js`), name);
});
