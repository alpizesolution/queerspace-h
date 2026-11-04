// Runs before a build. A production build that still carries placeholder Firebase settings would ship an app that quietly
// runs without its database, so that fails the build. Anything merely missing is a loud warning (a preview deploy or a
// local build may legitimately not have the settings).
import { pathToFileURL } from 'node:url';

const KEYS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
const PLACEHOLDER = /^(your[-_ ].*|changeme|todo|xxx+)$/i;

/** { errors, warnings } for an environment. Only a production build (VERCEL_ENV=production) turns a placeholder into an error. */
export function checkEnv(env) {
  const errors = [];
  const warnings = [];
  const production = env.VERCEL_ENV === 'production';
  for (const key of KEYS) {
    const value = (env[key] ?? '').trim().replace(/^["']|["']$/g, '');
    if (!value) warnings.push(`${key} is not set: the app will run without Firebase.`);
    else if (PLACEHOLDER.test(value)) (production ? errors : warnings).push(`${key} is still a placeholder ("${value}").`);
  }
  return { errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { errors, warnings } = checkEnv(process.env);
  for (const w of warnings) console.warn(`[env] warning: ${w}`);
  for (const e of errors) console.error(`[env] ERROR: ${e}`);
  process.exit(errors.length ? 1 : 0);
}
