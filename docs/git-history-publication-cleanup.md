# Git history publication cleanup

Date: 2026-09-22

## Decision

`IMG_5197.jpg` is a 750×901 photo of the restaurant's ceiling lighting. It contains no people and its inspected EXIF fields contain resolution/orientation data but no GPS, owner, author, camera, or copyright identity. The application intentionally uses it in `style.css` as the shared header background and in the Open Graph metadata of `index.html`, `planning.html`, and `avantages.html`.

The current image blob, `024291de4735609db0f6b1a79b2c33831cfa0b74`, is identical to the blob introduced by commits `176ad2851458c843d4916993468c8614d4cbca72` and `7b9c25d`. Because the image is a required intentional public runtime asset and no private historical version exists, rewriting its history would provide no privacy benefit and would break the site if the current asset were removed. It was preserved unchanged.

`InfosMolard.zip` was a 1,388,809-byte archive containing 34 duplicate source and generated-site entries. It had no runtime references. Its blob, `e8f4d70d8a5dd746696023b193fe72387bf281e6`, entered history at commit `677527300553bb246fa42bcd0c9f2d7e3ab8752a` and was inherited by every later commit.

## Backup and rewrite

Before rewriting:

- local `main`: `a3ad5bf67c137b8644fc036966d66d976acfffae`
- remote-tracking `origin/main`: `6915b14b5e7bc3ea1edb556ade14fa797f74e9db`
- recoverable local backup: `refs/backup/task-41-before-history-cleanup`
- affected path: `InfosMolard.zip`
- preserved path: `IMG_5197.jpg`

The first rewrite processed the complete 149-commit local `main` history with a path-specific index filter. It removed only `InfosMolard.zip`. The rewritten `main` initially pointed to `bbaf3b7ef769e58f18ffd2a9bd4d5423dec604c1`.

The required full-history scan then found historical agent-memory and validation-screenshot paths that were already absent from the current tree. A second rewrite processed the resulting 142-commit `main` history and removed `.agents/memory/` and `screenshots/` as privacy-safe repository hygiene. Final rewritten `main` pointed to `9fd23134db62a5e6d7575e6e3b1fb2408936bdd1` before the cleanup report commit.

Independent review found six additional employee-schedule screenshots under historical `attached_assets/` paths. The directory had no current tracked files or runtime references and was already ignored. A third rewrite removed all historical `attached_assets/` content. Seven commits became empty and were pruned, leaving 135 commits. Final rewritten `main` pointed to `a04f472b08099ed46e9e79110d1d617d6843261e` before the cleanup report commit.

Only `refs/heads/main` was rewritten. `origin/main` remained unchanged and no branch, tag, or object was pushed.

The following exact local or remote-tracking refs still retain the original archive for recovery, task-agent bookkeeping, or because remote refs were explicitly out of scope:

- `refs/backup/task-41-before-history-cleanup` → `a3ad5bf67c137b8644fc036966d66d976acfffae`
- `refs/heads/backup-before-github-merge` → `1b6466e6bdea09121ba5acca5c684eab67509697`
- `refs/heads/replit-agent` → `270006db4278f95ec66a68e75c40b88b1e6ac2f1`
- `refs/heads/subrepl-3htj0g3q` → `7b9c25dd5f799a9b06582cf3689420919ed8d1ac`
- `refs/heads/subrepl-5a75aioc` → `e60ce321531b3e4476b68711145fc7dbdad3d902`
- `refs/heads/subrepl-7lihdduv` → `a2c8df12a97f5373fbe35df3388ae29450abe450`
- `refs/heads/subrepl-bf06bap8` → `074c6e0f5ee0d666afe925f638a4a2924786efe6`
- `refs/heads/subrepl-djsla618` → `53be5b44f22222e7249756d9a1f05f4f3d70c6bb`
- `refs/heads/subrepl-ig372x71` → `79e8fb6f39eba0aff0cdd53a475ebdabffbe07e8`
- `refs/heads/subrepl-la4veq6f` → `dea8ece191a392304e511c6ff6ad7ccff6ae09be`
- `refs/heads/subrepl-ml3d9ofx` → `2b009e8371b1f569189cb469fa5fe41f3aecc86e`
- `refs/heads/subrepl-pjrt6rj9` → `59fec61974c36f1189cd1b2c9878e04946eb26bf`
- `refs/heads/subrepl-qn561jm6` → `e9123a9eb77616df3cb9545b68fef6fe576a05ea`
- `refs/heads/subrepl-r3awdu3n` → `b6d6677092cbcbd6ad58f6552da7ee89f27ca48c`
- `refs/heads/subrepl-ryt8t5qm` → `5cae56c44ebad0a9682f5fd3deb0011aeb6f4894`
- `refs/heads/subrepl-ue6h3d5r` → `d9de5ed5899a500f795146ee4e4238ff615ef5e8`
- `refs/remotes/gitsafe-backup/main` → `a3ad5bf67c137b8644fc036966d66d976acfffae`
- `refs/remotes/origin/HEAD` and `refs/remotes/origin/main` → `6915b14b5e7bc3ea1edb556ade14fa797f74e9db`
- `refs/replit/agent-ledger` → `270006db4278f95ec66a68e75c40b88b1e6ac2f1`

These refs are not the publication candidate and must not be pushed. After the Task #44 targeted rewrite, `refs/original/refs/heads/main` points to `b982880fab3438790bd912cb1adcf7a294623234`, the completed Task #41 branch before the internal readiness document was removed. It is not the publication candidate.

## Current-tree protection

`InfosMolard.zip` is absent from the current tree. `/InfosMolard.zip` is ignored at the repository root so the duplicate archive cannot be recommitted accidentally without an explicit override.

## Task #44 targeted cleanup

Before the targeted rewrite:

- local `main`: `b982880fab3438790bd912cb1adcf7a294623234`
- live and remote-tracking `origin/main`: `6915b14b5e7bc3ea1edb556ade14fa797f74e9db`
- recoverable local backup: `refs/backup/task-44-before-readiness-cleanup`
- affected path: `docs/live-vote-readiness.md`

The targeted rewrite processed the 136-commit Task #41 publication branch and removed only `docs/live-vote-readiness.md`. The rewritten `main` initially pointed to `bc8be6e5ac5520ea88f87be92a9f7914df98802d`. A direct tree comparison with the verified Task #44 backup showed only that file deletion. No remote ref was changed and nothing was pushed.

## Publication rule

Only the rewritten local `main` is the publication candidate. Do not publish:

- `refs/backup/task-41-before-history-cleanup`
- `refs/original/refs/heads/main`
- the unchanged remote-tracking history under `origin/main`
- any other local helper branch that still references the pre-cleanup archive

## Verification

The final publishable `main` history contains none of these paths:

- `InfosMolard.zip`
- `.agents/memory/`
- `screenshots/`
- `attached_assets/`
- `docs/live-vote-readiness.md`
- archive, log, diagnostics, or credential filenames

History-wide pattern scans found environment-variable names only in implementation, tests, and operational documentation; no configured secret values, private keys, service-account files, bearer tokens, ID tokens, session values, or credential files were found. The only credential-like match is the known Firebase web API identifier in `public/office.html`; it is intentionally client-visible and is not a Firebase Admin credential. The static scanner also flags placeholder strings in `firebase-config.js`. The privacy/data-flow scanner reports no findings.

Employee-identifier terms occur only in contracts, implementation, tests, and operational documentation. No employee data was printed by the scan.

- `npm run build`: passed
- `npm test`: passed, 73/73
- Firestore/Storage rules tests: passed, 3/3
- public image blob preserved: `024291de4735609db0f6b1a79b2c33831cfa0b74`
- homepage: HTTP 200 with the ceiling-light banner visibly rendered
- `IMG_5197.jpg`: HTTP 200, `image/jpeg`, 750,136 bytes, byte-identical to the tracked source
- Collaborateur du mois route: HTTP 200
- Administration without a session: HTTP 302
- current `main` history length before the report commit: 135 commits
- `main` and `origin/main` merge base: none, as expected after rewriting the complete root history
- `origin/main...main` before the report commit: 135 commits only on `origin/main`, 135 commits only on rewritten `main`
- remote operations: none
- production data operations: none

Task #41 is complete: the two Git-history publication blockers originally identified by Task #38 are resolved on the rewritten local `main`. Only rewritten `main` may be used as the source for a future public repository.

TASK #41 COMPLETE — TASK #38 GIT-HISTORY PUBLICATION BLOCKERS RESOLVED