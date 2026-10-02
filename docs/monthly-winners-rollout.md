# Automatic monthly winners: rollout and September recovery

## Current safety boundary

This is an implementation, not a production rollout. No scheduler has been provisioned,
no result flags have been enabled, and no live September election has been accessed,
finalized, published or repaired. The system does not create elections when reading results
or running its worker. There is no migration of existing elections or ballots.

Default: all result processing is disabled. September additionally requires BOTH a
separate explicit recovery flag and a valid server-only recovery authorization. Neither
has been created or enabled in this implementation. There is no browser/API hold-release
button, force-publish control or manually entered winner.

## Architecture and paths

Under `electionSites/{site}/dataEnvironments/{environment}`:

- Existing `elections/{month}` and anonymous `ballots` remain authoritative.
- Existing `elections/{month}/resultInternals/final` contains the canonical private result.
- New `elections/{month}/resultOperations/state` records attempts, lease, retry, safe reason,
  stage and last actor (`WORKER` or `ADMIN_RECOVERY`).
- New `elections/{month}/publication/public` is an immutable, server-only publication snapshot.
- `publicationState/latest` points to the newest published month; old recovery cannot regress it.
- `publicationState/worker` records heartbeat and the catch-up scan cursor.
- `publicationState/septemberRecoveryAuthorization` is reserved for a separately approved
  recovery authorization. It is NOT created by the worker or recovery API.

The public DTO is reconstructed from an explicit allow-list. Direct client access to
these Firestore paths remains denied. Managed portraits are copied to opaque immutable
objects under `published-winner-photos/{site}/{environment}/{month}.{uuid}.webp`.
Only a published snapshot can authorize their public API delivery. External, legacy,
missing or failed photos are omitted. Copies not attached to a successful publication
may be orphaned after a crash; do not add an automatic deletion policy to published photos.

## Endpoints

- GET `/api/v1/public/election-results/latest`: strictly read-only, no-store, no tally,
  no directory initialization, no rollover write. 404 when enabled but no publication exists;
  503 if disabled, binding unavailable or a publication cannot be verified.
- GET `/api/v1/public/winner-photos/:key`: reads only an authorized immutable photo.
- GET `/api/v1/management/election-results`: authorized, read-only monitoring of up to
  60 latest months, safe diagnostics and heartbeat.
- POST `/api/v1/management/election-results/:month/recover`: exact existing administrator
  UID/site session, revoked-session check and same-origin protection; the same canonical
  pipeline as the worker, with no override of integrity checks.
- POST `/api/v1/internal/election-results/run`: Google OIDC machine authentication,
  pinned audience, issuer, service account subject/email and expiry. Not a human login
  mechanism. No site/month selection from request input.
- `/collaborateurs-du-mois`: public winners; `/collaborateur-du-mois`: unchanged vote flow.
- `/resultats-du-vote`: protected result control surface linked from Administration.

## Processing

Every invocation reads a page of 25 existing election metadata records, skips held,
open/upcoming and retry-blocked elections, and resumes its cursor on the next invocation.
The cursor resets after the final page; catch-up therefore does not depend on a single
midnight delivery or a visitor. Very large histories may require several invocations.

A 15-minute settlement interval after the canonical Zurich close allows bounded in-flight
Firestore transactions to settle. Ballot creation timestamps at/after close are rejected,
not silently removed. Ten-minute expiring leases prevent concurrent workers from writing
duplicate results. A worker that exceeds its lease cannot commit.

Election/site/environment/window, eligibility bounds, schema/choices, category references,
anonymous ballot versus participation counts, historical candidate display identity,
existing finalization and publication consistency are checked before publication.
Anonymous choice reads are projected: no voter verifier, participation identities or
comments are loaded for tallying. The ballot and final result are revalidated inside each
mutation transaction. Finalization precedes publication; the publication, newest pointer
and PUBLISHED operation state commit atomically.

Integrity errors require verification. Transient storage failures use bounded retry
backoff (5 minutes through 1 hour). Crashes leave resumable private stages; valid published
snapshots are never overwritten. Manual recovery repeats the same validation and may
retry immediately, but cannot force a result. Public visitors never initiate processing.

## Remaining production rollout — separate approval required

1. Obtain approval for rollout independently of September recovery.
2. Verify the actual production hosting service and canonical HTTPS origin. Treat any
   unused Replit deployment/404 separately; this feature does not change hosting.
3. Verify the Admin SDK project ID, actual Firestore database, bucket ownership/access,
   `molard` site namespace and `production` data environment against the real deployment.
   Do not copy a project ID from an unverified preview. Preserve all original records.
4. Stage the code and explicit private-storage rule for deployment. Firestore's existing
   `electionSites/**` deny rule already covers every new result document.
5. Using the platform's environment/secrets controls, set verified NONSECRET pins:
   - `ELECTION_RESULTS_PROJECT_ID=<verified-project>`
   - `ELECTION_RESULTS_DATABASE_ID=(default)`
   - Existing `EMPLOYEE_DIRECTORY_SITE_ID=molard`
   - Existing `ELECTION_DATA_ENVIRONMENT=production`
   - Existing `ELECTION_TIME_ZONE=Europe/Zurich`
   - Existing production runtime/canonical-origin configuration
   - Initially `ELECTION_RESULTS_ENABLED=false`
   - Initially `ELECTION_RESULTS_AUTOMATION_ENABLED=false`
   - Keep `ELECTION_RESULTS_SEPTEMBER_RECOVERY_APPROVED=false`
6. Deploy the reviewed build/rules after approval. Smoke-test protected routing,
   anonymous unavailable-state rendering, health check and unauthorized worker rejection.
7. Validate the full pipeline against an isolated staging Firebase project first.
   Review the older closed production months that catch-up would discover before enabling
   processing. September remains excluded.
8. Provision a dedicated Google service account and Cloud Scheduler job, initially PAUSED:
   - Schedule `*/5 * * * *`, UTC (closure itself uses stored Zurich instants).
   - HTTPS POST to the verified canonical origin plus `/api/v1/internal/election-results/run`.
   - OIDC token for that service account, with the exact job URL as audience.
   - Pin `ELECTION_RESULTS_JOB_AUDIENCE` to that exact URL.
   - Pin `ELECTION_RESULTS_JOB_SUBJECT` to its numeric service-account unique ID.
   - Pin `ELECTION_RESULTS_JOB_EMAIL` to its exact service-account email.
   - Configure a deadline no greater than 9 minutes, retries/backoff and failure alerting.
     Abort/deadline duplicates remain safe through persisted leases and idempotency.
   - Grant the scheduler's service agent only the permission needed to mint this account's
     OIDC token. Keep production Firebase credentials on the server, never in the job.
9. Set `ELECTION_RESULTS_ENABLED=true` only after the binding and staging checks.
   This permits canonical manual recovery for nonheld closed months; the scheduler
   remains paused and the automatic switch remains false.
10. After the approved operational checks, set `ELECTION_RESULTS_AUTOMATION_ENABLED=true`
    and resume the scheduler. Verify its actual authenticated invocation, heartbeat,
    catch-up behavior and a permitted canonical publication; do not use September as
    the smoke test. Monitor job failures and heartbeat older than 15 minutes.
11. Keep latest winners visible independently of the current election. Confirm current
    voting works alongside a prior publication without opening the result worker.

Rollback: pause the scheduler and set automation false. To stop all result processing
and reads, set the results-enabled flag false. Do not delete or rewrite elections,
ballots, canonical finals, publication snapshots or images when rolling back code.

## September 2026 — proposed recovery, NOT performed

1. Obtain explicit approval for a read-only production September audit. Keep both the
   recovery flag false and normal scheduler paused while preparing this operation.
2. Independently verify the real Firebase project, `(default)` database, production
   namespace, site and original September document; confirm its canonical window
   and provenance. Do not initialize a missing September election.
3. Use the same `FirestoreResultsStore.validate('2026-09', auditedNow)` read-only
   transaction against that verified store. It validates original anonymous choices,
   participation counts, closure timestamps, candidate snapshot and any existing final.
   Return a safe audit outcome and the aggregate input digest, not ballots, comments,
   voter identities, vote totals or inferred winner names in logs or an audit export.
   This callable is NOT a public/API hold bypass and has not been run on September.
4. If anything fails or the original snapshot/provenance cannot be established, stop.
   Do not repair, synthesize candidates, discard ballots, choose winners or finalize.
   Any necessary data repair requires its own explicit approval and evidence.
5. Present the verified binding and successful integrity-audit outcome for separate
   approval to recover/publish September. Protect any backup according to existing
   restricted-access practices; do not export sensitive election data into this repository.
6. Only after that approval, create the server-only authorization at
   `publicationState/septemberRecoveryAuthorization` in the verified production root:
   ```json
   {
     "schemaVersion": 1,
     "monthKey": "2026-09",
     "projectId": "<verified-project>",
     "databaseId": "(default)",
     "siteId": "molard",
     "dataEnvironment": "production",
     "integrityDigest": "<digest-from-successful-canonical-audit>",
     "verifiedAt": "<audit-ISO-time>",
     "authorizedAt": "<approved-recovery-ISO-time>"
   }
   ```
   Use a separately reviewed/approved one-off administrative operation. The regular
   worker and manual API cannot create this record.
7. Explicitly enable `ELECTION_RESULTS_SEPTEMBER_RECOVERY_APPROVED=true` only for that
   approved recovery. Both the flag AND correctly bound authorization are required.
8. Andrea invokes the existing protected recovery action. The unchanged canonical
   pipeline revalidates the source and compares its digest with the audited authorization
   before writing any final result. Any source change stops publication.
9. Verify the immutable snapshot, public allow-list and tie/no-winner presentation.
   If a later month is already published, September remains historical and MUST NOT
   replace that newer latest-publication pointer.
10. Record the approved outcome, then disable the September recovery flag again.
    Resume normal automation only under its separate approval.

No part of this procedure was executed during implementation or testing.

## Test commands

`npm test` uses isolated in-memory data and isolated local browser fixture servers.
`firebase emulators:exec --project demo-monthly-results --only firestore,storage "node --test test/firestore-rules.emulator.js"`
tests actual local transactions and security rules, never the live database.
No September finalization/publication test is performed. Rollover is checked with an
earlier fixture publication across September/October; September holds are rejection tests.