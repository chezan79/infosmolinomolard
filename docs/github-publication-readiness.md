# Controlled GitHub publication readiness

Date: 2026-09-22

## Publication candidate

The local `main` branch is the Task #41 publication-safe history followed by the Task #44 targeted removal of `docs/live-vote-readiness.md`. The targeted rewrite changed no application file. A comparison with `refs/backup/task-44-before-readiness-cleanup` showed only removal of the internal readiness document.

The application intentionally retains:

- `IMG_5197.jpg` as the homepage banner and Open Graph image
- `public/office.html` and its public Firebase web client configuration

The Firebase web API identifier is client-visible configuration, not a Firebase Admin credential. It must remain governed by Firebase API restrictions and security rules.

## History scope

The complete history reachable from local `main` contains none of the following:

- `InfosMolard.zip`
- historical `attached_assets/` employee screenshots
- `.agents/memory/`
- `screenshots/`
- diagnostics or log artifacts
- `docs/live-vote-readiness.md`
- private keys or service-account JSON
- configured server secrets or authentication tokens
- real Salaire-ID values or individual employee PII
- stored ballot records or employee comments

Source code, tests, and architecture documentation necessarily contain election-domain terms and synthetic fixtures. Those are not live employee records. The history scan reports filenames and categories only and does not print sensitive values.

## Existing GitHub repository

Repository: `chezan79/infosmolinomolard`

### Workspace Git authentication

Git HTTPS authentication is configured without placing a credential in the repository or its Git configuration:

- The repository-scoped GitHub token is stored only in the Replit Secret named `GIT_URL`.
- A user-level helper at `~/.local/bin/git-credential-replit-github` reads that secret at runtime and is mode `0700`.
- The helper command is configured in the user-level Git configuration only for `https://github.com`.
- The tracked repository and project files contain no token or private key.
- `origin` remains the clean URL `https://github.com/chezan79/infosmolinomolard`.

An authenticated `git ls-remote --symref origin HEAD refs/heads/main` succeeded on 2026-09-22. The exact protected push command below also succeeded with `--dry-run`, confirming write authorization and the explicit lease without changing the remote.

At Task #44 preflight:

- remote-tracking `origin/main`: `6915b14b5e7bc3ea1edb556ade14fa797f74e9db`
- live GitHub `refs/heads/main`: `6915b14b5e7bc3ea1edb556ade14fa797f74e9db`
- Task #44 recovery ref: `refs/backup/task-44-before-readiness-cleanup`

Local rewritten `main` has no merge base with the existing remote branch. A normal push is therefore not appropriate. The controlled operation, after a final live-remote check, is an explicit force-with-lease update of `main` only:

```text
git push --force-with-lease=refs/heads/main:6915b14b5e7bc3ea1edb556ade14fa797f74e9db origin main:main
```

The explicit expected value protects against replacing an unexpected remote update: Git rejects the operation if live `origin/main` no longer equals the recorded commit. The refspec names only local `refs/heads/main` and remote `refs/heads/main`; it does not publish `refs/original`, `refs/backup`, Replit refs, task branches, or other helper refs.

No push was executed. Re-read live `refs/heads/main` immediately before any future controlled update and stop if it differs from the expected lease value.

## Validation

Final checks:

- Complete `main` history scan: no blocked paths, archives, logs, diagnostics, screenshots, credential files, data exports, or database dumps
- Tracked images across the complete history: only `IMG_5197.jpg`
- Credential-pattern scan: only the intentional public Firebase web API identifier in `public/office.html`
- Privacy/data-flow scan: no findings
- Static security scan: expected Firebase client-configuration findings only; no Firebase Admin credential
- `npm run build`: passed
- `npm test`: passed, 73/73
- Firestore/Storage rules tests: passed, 3/3
- `npm ls --all`: passed
- `npm audit --omit=dev --audit-level=high`: no high or critical findings; nine moderate dependency findings remain and the available forced fix would require a breaking Excel library downgrade
- Homepage: HTTP 200
- `IMG_5197.jpg`: HTTP 200, `image/jpeg`, 750,136 bytes, byte-identical to the tracked source
- `public/office.html`: HTTP 200 at its public path with Firebase web configuration present
- Live GitHub `refs/heads/main`: still `6915b14b5e7bc3ea1edb556ade14fa797f74e9db`
- Expected force-with-lease value: matches both the live remote and local remote-tracking ref
- Authenticated Git read: passed through the user-level Replit Secret credential helper
- Exact force-with-lease push dry run: passed; no remote ref was changed
- `git diff --check`: passed
- Remote pushes: none
- Deployments initiated by this task: none
- Production data access: none

READY FOR CONTROLLED FORCE-WITH-LEASE PUSH