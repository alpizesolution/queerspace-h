# Publishing Firestore rules and indexes

The site itself deploys from GitHub to Vercel on every push to `main`. Firestore **rules** and **indexes** do not: they live in
Firebase and have to be published separately, or a feature that needs a new rule (or index) fails in production even though the
site is up.

## Rules for doing it safely

- A rules publish replaces the project's **whole** ruleset. Never run it against a project you have not confirmed belongs to
  QUEERSPACE (this machine also has the QUEERKSCAPE app, which has its own, different rules).
- The scripts below never choose a project for you. You always name it, and a placeholder, an emulator (`demo-…`) id or a
  rules file from another app is refused.
- The project id is the value of `VITE_FIREBASE_PROJECT_ID` in Vercel (Settings → Environment Variables).

## From your computer

Sign in once (`npx firebase login`), then, from the `queerspace-h` folder:

```
npm run check:firebase -- --project <id>     # read-only: which indexes the project is missing
npm run deploy:firebase -- --project <id> --print   # shows exactly what would run
npm run deploy:firebase -- --project <id>    # publishes rules and indexes (add --rules or --indexes for one)
```

`.firebaserc.example` shows the file to copy to `.firebaserc` if you would rather set the project once.

## From GitHub

Actions → **Deploy Firestore rules and indexes** → Run workflow. It runs the rules tests first, then publishes. It needs the
repository variable `FIREBASE_PROJECT_ID` and the secret `FIREBASE_SERVICE_ACCOUNT` (see the workflow's header), ideally on a
`production` environment with required reviewers. It never runs by itself.

## After a deploy

- `npm run check:firebase -- --project <id>` should say every index is there. A missing composite index shows up in the app as
  "Couldn't load …" with a retry, not as an empty list.
- Try the feature that needed the change.

## Production builds

`npm run build` first runs `scripts/check-env.mjs`: a Vercel **production** build fails if a Firebase setting is still a
placeholder (for example `your-project-id`). A missing value only warns, because previews and local builds may not have them.
