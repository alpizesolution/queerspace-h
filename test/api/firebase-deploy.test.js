import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deployTargets, looksLikeThisApp, missingIndexes, parseIndexesOutput, resolveProject } from '../../scripts/deploy-firebase.mjs';
import { checkEnv } from '../../scripts/check-env.mjs';

test('a project must be named: nothing is chosen, and placeholders, emulator ids and junk are refused', () => {
  assert.equal(resolveProject(['--project', 'my-real-app-123']), 'my-real-app-123');
  assert.equal(resolveProject([], { FIREBASE_PROJECT_ID: 'ci-project-1' }), 'ci-project-1', 'CI may use the variable');
  assert.equal(resolveProject(['--project', 'cli-wins'], { FIREBASE_PROJECT_ID: 'env-loses' }), 'cli-wins');
  assert.equal(resolveProject(['--project', '"quoted-id-1"']), 'quoted-id-1');
  assert.throws(() => resolveProject([]), /Say which Firebase project/);
  assert.throws(() => resolveProject([], { VITE_FIREBASE_PROJECT_ID: 'looks-real-1' }), /Say which Firebase project/, 'the app\'s own variable is never used as a deploy target');
  assert.throws(() => resolveProject(['--project']), /Say which/);
  assert.throws(() => resolveProject(['--project', '--rules']), /Say which/);
  assert.throws(() => resolveProject(['--project', 'your-project-id']), /placeholder/);
  assert.throws(() => resolveProject(['--project', 'demo-queerspace-test']), /emulator/);
  assert.throws(() => resolveProject(['--project', 'Bad Id!']), /not a valid/);
});

test('only this app\'s rules can be published: another app\'s rules file is caught', () => {
  assert.equal(looksLikeThisApp(fs.readFileSync('firestore.rules', 'utf8')), true);
  assert.equal(looksLikeThisApp("service cloud.firestore { match /databases/{d}/documents { match /constellations/{id} {} match /unsaidThoughts/{id} {} } }"), false);
  assert.equal(looksLikeThisApp(''), false);
});

test('what gets deployed: both by default, or just the part asked for', () => {
  assert.equal(deployTargets({}), 'firestore:rules,firestore:indexes');
  assert.equal(deployTargets({ rules: true, indexes: false }), 'firestore:rules');
  assert.equal(deployTargets({ rules: false, indexes: true }), 'firestore:indexes');
  assert.throws(() => deployTargets({ rules: false, indexes: false }), /Nothing to deploy/);
});

test('missing indexes are found, including the profile posts index, and the project\'s own __name__ suffix is ignored', () => {
  const local = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8')).indexes;
  const posts = local.find((i) => i.collectionGroup === 'community_posts');
  assert.ok(posts, 'the profile posts index is declared');
  assert.deepEqual(missingIndexes(local, []).length, local.length, 'an empty project is missing all of them');

  const live = local.map((i) => ({ ...i, fields: [...i.fields, { fieldPath: '__name__', order: 'ASCENDING' }] }));
  assert.deepEqual(missingIndexes(local, live), [], 'a project that has them all is complete');
  const withoutPosts = live.filter((i) => i.collectionGroup !== 'community_posts');
  assert.deepEqual(missingIndexes(local, withoutPosts).map((i) => i.collectionGroup), ['community_posts']);

  const wrongOrder = live.map((i) => (i.collectionGroup === 'community_posts' ? { ...i, fields: i.fields.map((f) => (f.fieldPath === 'timestamp' ? { ...f, order: 'ASCENDING' } : f)) } : i));
  assert.deepEqual(missingIndexes(local, wrongOrder).map((i) => i.collectionGroup), ['community_posts'], 'the wrong sort direction is not the same index');
});

test('the CLI\'s index list is read whether it is bare, wrapped, or preceded by log lines', () => {
  const body = { indexes: [{ collectionGroup: 'a', queryScope: 'COLLECTION', fields: [] }] };
  assert.deepEqual(parseIndexesOutput(JSON.stringify(body)), body.indexes);
  assert.deepEqual(parseIndexesOutput(JSON.stringify({ status: 'success', result: body })), body.indexes);
  assert.deepEqual(parseIndexesOutput(`i  firestore: reading\n${JSON.stringify(body, null, 2)}\n`), body.indexes);
  assert.throws(() => parseIndexesOutput('nothing here'), /Could not read/);
  assert.throws(() => parseIndexesOutput('{"x":1}'), /no index list/);
});

test('a production build refuses placeholder Firebase settings; a missing one only warns', () => {
  const good = { VITE_FIREBASE_API_KEY: 'AIzaReal', VITE_FIREBASE_PROJECT_ID: 'real-proj-1', VITE_FIREBASE_APP_ID: '1:123:web:abc' };
  assert.deepEqual(checkEnv({ ...good, VERCEL_ENV: 'production' }), { errors: [], warnings: [] });
  const bad = { ...good, VITE_FIREBASE_PROJECT_ID: 'your-project-id' };
  assert.equal(checkEnv({ ...bad, VERCEL_ENV: 'production' }).errors.length, 1);
  assert.equal(checkEnv({ ...bad, VERCEL_ENV: 'preview' }).errors.length, 0, 'a preview only warns');
  assert.equal(checkEnv({ ...bad, VERCEL_ENV: 'preview' }).warnings.length, 1);
  const missing = checkEnv({ VERCEL_ENV: 'production' });
  assert.equal(missing.errors.length, 0, 'unset is a warning, not a failed build');
  assert.equal(missing.warnings.length, 3);
});

test('the build runs the env check first, and the deploy workflow is manual-only', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts.build, /^node scripts\/check-env\.mjs && /);
  assert.ok(pkg.scripts['deploy:firebase'] && pkg.scripts['check:firebase']);
  const workflow = fs.readFileSync('.github/workflows/deploy-firestore.yml', 'utf8');
  assert.match(workflow, /^on:\s*\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m, 'never runs by itself');
  assert.match(workflow, /environment: production/);
});
