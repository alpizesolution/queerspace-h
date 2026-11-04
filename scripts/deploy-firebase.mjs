#!/usr/bin/env node
// Publishes firestore.rules and firestore.indexes.json to ONE Firebase project that you name, or checks that the project
// already has the indexes this app needs. It never picks a project for you: a rules deploy replaces a project's whole
// ruleset, so aiming it at the wrong project (this machine also holds the QUEERKSCAPE app) would break another app.
//
//   node scripts/deploy-firebase.mjs --project <id>             publish rules and indexes
//   node scripts/deploy-firebase.mjs --project <id> --rules     rules only (or --indexes)
//   node scripts/deploy-firebase.mjs --project <id> --check     read-only: which local indexes are missing from the project
//   node scripts/deploy-firebase.mjs --project <id> --print     show what would run, change nothing
//
// In CI the project can come from FIREBASE_PROJECT_ID instead of --project.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PLACEHOLDERS = new Set(['your-project-id', 'your_project_id', 'project-id', 'my-project', 'changeme']);
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** The project to act on, from --project (or FIREBASE_PROJECT_ID); throws a plain message when it is missing or not a real id. */
export function resolveProject(argv, env = {}) {
  const at = argv.indexOf('--project');
  const given = at >= 0 ? argv[at + 1] : env.FIREBASE_PROJECT_ID;
  const id = typeof given === 'string' ? given.trim().replace(/^["']|["']$/g, '') : '';
  if (!id || id.startsWith('--')) throw new Error('Say which Firebase project: --project <project-id> (or set FIREBASE_PROJECT_ID). Nothing is chosen for you.');
  if (PLACEHOLDERS.has(id.toLowerCase())) throw new Error(`"${id}" is a placeholder, not a project id.`);
  if (id.startsWith('demo-')) throw new Error(`"${id}" is an emulator project; nothing is deployed to it.`);
  if (!PROJECT_ID.test(id)) throw new Error(`"${id}" is not a valid Firebase project id (lowercase letters, digits and dashes, 6-30 characters).`);
  return id;
}

/** A rules file from this app contains these; another app's rules do not, so a mixed-up folder is caught before deploying. */
export function looksLikeThisApp(rules) {
  return ['match /community_posts/', 'match /public_room_messages/', 'match /signalsPairs/'].every((marker) => rules.includes(marker));
}

/** What to run for the chosen parts. */
export function deployTargets({ rules = true, indexes = true }) {
  const parts = [rules && 'firestore:rules', indexes && 'firestore:indexes'].filter(Boolean);
  if (parts.length === 0) throw new Error('Nothing to deploy: pick --rules, --indexes, or neither for both.');
  return parts.join(',');
}

const sameFields = (local, live) => local.length <= live.length && local.every((f, n) => f.fieldPath === live[n]?.fieldPath && (f.order ?? f.arrayConfig) === (live[n]?.order ?? live[n]?.arrayConfig));

/** The local indexes the project does not have yet. The project adds a trailing __name__ field itself, so a local index matches when its fields are the start of a live one. */
export function missingIndexes(local, live) {
  return (local ?? []).filter((want) => !(live ?? []).some((have) => {
    const group = have.collectionGroup ?? String(have.name ?? '').split('/collectionGroups/')[1]?.split('/')[0];
    return group === want.collectionGroup && (have.queryScope ?? 'COLLECTION') === (want.queryScope ?? 'COLLECTION') && sameFields(want.fields ?? [], have.fields ?? []);
  }));
}

/** The CLI's answer for `firestore:indexes` is JSON, sometimes wrapped in {result} and sometimes preceded by log lines. */
export function parseIndexesOutput(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Could not read the index list from the Firebase CLI.');
  const parsed = JSON.parse(text.slice(start, end + 1));
  const body = parsed.result ?? parsed;
  if (!Array.isArray(body.indexes)) throw new Error('The Firebase CLI answer had no index list.');
  return body.indexes;
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args, options = {}) => spawnSync(npx, ['firebase', ...args], { encoding: 'utf8', shell: process.platform === 'win32', stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });

function main(argv, env) {
  const project = resolveProject(argv, env);
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  if (!looksLikeThisApp(rules)) throw new Error('firestore.rules here does not look like QUEERSPACE\'s (no community_posts / public_room_messages / signalsPairs). Run this from the queerspace-h folder.');

  if (argv.includes('--check')) {
    const out = run(['firestore:indexes', '--project', project], { capture: true });
    if (out.status !== 0) throw new Error('Could not list the project\'s indexes (are you signed in with `firebase login`?).');
    const local = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8')).indexes;
    const missing = missingIndexes(local, parseIndexesOutput(out.stdout));
    if (missing.length === 0) { console.log(`${project}: all ${local.length} indexes are there.`); return 0; }
    console.log(`${project} is missing ${missing.length} of ${local.length} indexes:`);
    for (const m of missing) console.log(`  ${m.collectionGroup}: ${m.fields.map((f) => `${f.fieldPath} ${f.order ?? f.arrayConfig}`).join(', ')}`);
    return 1;
  }

  const only = argv.includes('--rules') || argv.includes('--indexes')
    ? deployTargets({ rules: argv.includes('--rules'), indexes: argv.includes('--indexes') })
    : deployTargets({});
  const command = ['deploy', '--only', only, '--project', project];
  console.log(`Project: ${project}  (default database)\nRuns:    firebase ${command.join(' ')}`);
  if (argv.includes('--print')) return 0;
  return run(command).status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2), process.env));
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}
