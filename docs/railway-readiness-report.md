# Railway production preparation report

## Required and completed changes

Completed: dynamic Railway port and public bind, Node/build/start declaration, minimal liveness, safe readiness, exact custom origin and one-hop proxy validation, production-only election namespace, required durable Firebase/Storage configuration, startup rejection of unsafe configuration, and production disabling of unauthenticated mock/in-memory planning and training APIs.

Existing protections retained: secure HttpOnly host-only SameSite=Strict session cookie, revoked Firebase token/session checks, exact same-origin mutation checks through Express trusted-proxy protocol, sole configured administrator UID plus site claim, server-only Firebase Admin, site/environment election paths, and deny-all browser rules for directory, election, planning, enrollment, training, and portraits.

## Isolation and data boundary

Firestore election records (grants, throttling, participation, ballots, audits, and results) remain below the site and data-environment root. Production is fixed to `molard/production`; development remains separate. Portrait bytes remain in Firebase Storage through the Admin SDK, with metadata in Firestore and no local filesystem persistence.

## Repository publication review

Reviewed all 12 commits ahead of `origin/main` and tracked content without pushing or rewriting history.

- Blocker: `IMG_5197.jpg` is a tracked personal portrait and requires removal from the entire publishable Git history or explicit publication approval.
- Blocker: `InfosMolard.zip` is a tracked duplicate source/archive and should be removed from the entire publishable Git history before a public push.
- Review required: `docs/live-vote-readiness.md` contains workforce/election population counts and operational state.
- Review required: operational/security documentation discloses internal routes and architecture.
- Review required: `public/office.html` contains a Firebase web API identifier. It is not an Admin secret, but Firebase restrictions must treat it as public.
- No tracked `.env`, private key, service-account JSON, bearer token, database dump, log, screenshot, diagnostics directory, or agent memory file was found.

Deleting files only in the current commit would not remove them from the 12-commit history, so no history rewrite was performed.

## Remaining Replit dependencies and approval blockers

- Railway variables and custom domain are not configured; deployment is out of scope.
- Firebase rules have not been deployed by this task.
- Existing `.replit` workflow configuration remains development-only and is not part of Railway runtime.
- A supervised production-configuration smoke test behind the real Railway proxy/custom domain remains required.
- The repository-history publication blockers above must be resolved before pushing to a public GitHub repository.

## Verification

- `npm run build`: passed.
- `npm test`: passed, 73/73 tests. This includes unit, browser, multilingual, directory, voting/privacy, Administration, photo, storage-contract, security, and Railway production-configuration coverage.
- `HOME=/tmp/molino-home npm run test:firestore-rules`: passed, 3/3 emulator tests.
- Production startup with required variables omitted: exited non-zero before listening, as required.
- `npm ls --all`: passed with no invalid dependency relationships.
- `npm audit --omit=dev`: no critical or high findings; nine moderate transitive/direct findings remain in Google/Firebase/Excel dependency trees. Do not force incompatible major-version overrides.
- Tracked secret-pattern scan: found the known public Firebase web API identifier in `public/office.html`; no private key, service-account material, bearer token, or server secret value.
- `git diff --check`: passed.

No production data was accessed or modified.

NOT READY FOR GITHUB + RAILWAY SETUP