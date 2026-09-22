# Railway production preparation report

## Railway runtime dependency repair

**Root cause:** the lockfile pinned package tarballs to Replit's private `package-firewall.replit.internal` host. Railway follows lockfile tarball locations during `npm ci`, cannot access that private host, and therefore could fail before Express or any other runtime module was installed. Express and the other server packages were already declared as production dependencies; their classification was not the source of the missing-module crash. The manifest separately installed browser/rules test packages in production.

The complete server import graph has five direct production dependencies: `express`, `exceljs`, `firebase-admin`, `google-auth-library`, and `sharp`. `@firebase/rules-unit-testing`, the Firebase browser SDK, and `ws` are now development-only. The unused root `cors` dependency was removed. Compatible security overrides were preserved. The lockfile was regenerated without registry-specific `resolved` fields, so Railway uses its configured public npm registry while integrity hashes and locked versions remain enforced.

Regression coverage rejects private Replit package URLs and registry-specific `resolved` fields, creates a clean temporary copy, runs `npm ci --omit=dev` with `https://registry.npmjs.org/` explicitly configured, verifies every direct runtime package resolves and every development-only package is absent, starts `node server.js` with isolated non-production configuration, and checks:

- `/healthz`: 200
- `/readyz`: 503 while durable services are intentionally unconfigured
- `/`: 200
- `/collaborateur-du-mois`: 200
- `/administration`: 503 while Administration authentication is intentionally unconfigured
- server output: no `MODULE_NOT_FOUND` or `Cannot find module`

**Railway conclusion:** FIXED IN THE WORKTREE. A new GitHub commit containing the manifest, lockfile, test, and report changes is required before Railway can receive the repair and redeploy. This task did not push, deploy, configure, or restart Railway.

## Required and completed changes

Completed: dynamic Railway port and public bind, Node/build/start declaration, minimal liveness, safe readiness, exact custom origin and one-hop proxy validation, production-only election namespace, required durable Firebase/Storage configuration, startup rejection of unsafe configuration, and production disabling of unauthenticated mock/in-memory planning and training APIs.

Existing protections retained: secure HttpOnly host-only SameSite=Strict session cookie, revoked Firebase token/session checks, exact same-origin mutation checks through Express trusted-proxy protocol, sole configured administrator UID plus site claim, server-only Firebase Admin, site/environment election paths, and deny-all browser rules for directory, election, planning, enrollment, training, and portraits.

## Isolation and data boundary

Firestore election records (grants, throttling, participation, ballots, audits, and results) remain below the site and data-environment root. Production is fixed to `molard/production`; development remains separate. Portrait bytes remain in Firebase Storage through the Admin SDK, with metadata in Firestore and no local filesystem persistence.

## Repository publication review

The local publishable `main` history was rewritten after a verified local backup was created. No remote ref was changed and nothing was pushed.

- Resolved: `IMG_5197.jpg` is an intentional public photo of the restaurant's ceiling lighting, not a personal portrait. It remains required by the homepage banner and social metadata. The same image blob has been public since its introduction, contains no people or location metadata, and did not require history removal.
- Resolved on local `main`: the unused duplicate source archive `InfosMolard.zip` was removed from the current tree and every commit in the rewritten publishable history. A root ignore rule prevents it from being recommitted.
- Resolved on local `main`: the internal live-vote readiness document and its workforce/election aggregates were removed from the current tree and every commit in the publishable history.
- Review required: operational/security documentation discloses internal routes and architecture.
- Review required: `public/office.html` contains a Firebase web API identifier. It is not an Admin secret, but Firebase restrictions must treat it as public.
- No tracked `.env`, private key, service-account JSON, bearer token, database dump, log, screenshot, diagnostics directory, or agent memory file was found.

The original history remains available only through local backup/original refs and the untouched remote-tracking `origin/main`. Those refs must not be pushed to a new public repository. The rewritten local `main` is the publication candidate.

## Remaining Replit dependencies and approval blockers

- Railway variables and custom domain are not configured; deployment is out of scope.
- Firebase rules have not been deployed by this task.
- Existing `.replit` workflow configuration remains development-only and is not part of Railway runtime.
- A supervised production-configuration smoke test behind the real Railway proxy/custom domain remains required.
- The repository-history publication blockers found by this report are resolved on rewritten local `main`; the remaining configuration and review items still require approval before deployment.

## Verification

- `npm run build`: passed.
- `npm test`: passed, 74/74 tests. This includes unit, browser, multilingual, directory, voting/privacy, Administration, photo, storage-contract, security, Railway production-configuration, and isolated production-pruned installation coverage.
- `HOME=/tmp/molino-task51-home npm run test:firestore-rules`: passed, 3/3 emulator tests.
- Clean `npm ci --omit=dev`: passed in an isolated temporary copy with the public npm registry explicitly configured; Express and all other server runtime dependencies resolved without development packages.
- Lockfile registry portability: passed; no Replit-private host or registry-specific `resolved` field remains.
- Production-pruned route smoke test: passed for liveness, intentionally unavailable readiness, homepage, employee-voting page, and protected Administration routing.
- Production startup with required variables omitted: exited non-zero before listening, as required.
- `npm ls --all`: passed with no invalid dependency relationships.
- `npm audit --omit=dev`: no critical or high findings; nine moderate transitive/direct findings remain in Google/Firebase/Excel dependency trees. Do not force incompatible major-version overrides.
- Tracked secret-pattern scan: found the known public Firebase web API identifier in `public/office.html`; no private key, service-account material, bearer token, or server secret value.
- `git diff --check`: passed.

No production data was accessed or modified.

RUNTIME DEPENDENCY REPAIR COMPLETE; NEW GITHUB COMMIT REQUIRED FOR RAILWAY REDEPLOY