# Official voting runtime attestation

Administration → Résultats du vote → Vérification du Firebase officiel exposes an
opt-in diagnostic through GET /api/v1/management/election-runtime-diagnostic.
It requires the existing server-verified owner session (exact owner UID and site
claim), returns no-store responses, and has no public equivalent.

The report examines the same initialized Firestore client used by the server,
not a separate connection. It compares client metadata and configuration only:

- Admin project infosmolinomoard and database (default)
- site molard, data environment production, NODE_ENV production
- Europe/Zurich timezone
- matching ELECTION_RESULTS_PROJECT_ID and ELECTION_RESULTS_DATABASE_ID
- no Firestore, Auth or Storage emulator configuration

Only fixed expected values and MATCH / MISSING / MISMATCH / UNAVAILABLE states
are returned. Unexpected configuration values and SDK exceptions are never
reflected. No credentials, sessions, voters, publications, ballots or other
datastore documents are inspected. VERIFIED does not prove network access,
Firestore permissions, roster integrity or result finalization.

Production result, photo, history, recovery and worker HTTP paths fail closed
before storage access when binding validation fails. Production must match the
operator-approved project as well as the declared result binding. Explicit
development Preview metadata remains separate; it is never attested as official
and a broken production configuration never falls back to it.
Requests to the approved official hostname and requests in Railway runtimes must
pass the production guard even if both NODE_ENV and the data environment were
mistakenly set to development. Development Preview is allowed only outside that
official context.

## Operator verification

Only after a separately authorized release, sign in as the owner on the
official Railway host, open Résultats du vote and run the diagnostic. All nine
checks must be MATCH and status VERIFIED. A report from Replit Preview does not
attest Railway: Preview is expected to report BLOCKED for production checks.

This feature does not change NODE_ENV, result bindings, automation flags or
September recovery authorization. Missing bindings remain an explicit block.
Implementing or testing it is not a production attestation. That requires its
execution in the live process, after authorized release or through a separately
available non-public diagnostic in that process. No release is performed here.
