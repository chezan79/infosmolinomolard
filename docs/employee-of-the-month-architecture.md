# Collaborateur du mois — Technical architecture

Status: design only; no schema, production data, application code, deployment, or winner has been changed.

## 1. Decision summary

Build the module as a server-authoritative feature behind the existing Express application, using one canonical Firestore production database and Firebase Storage for employee photos. The browser must never write election, participation, ballot, result, employee, or photo metadata directly.

Before voting is enabled, create one canonical employee directory with stable opaque employee IDs. Import and reconcile names from the management-maintained source into that directory; do not use planning rows as identities and do not create a second election-only employee list.

The public voting page may remain a static, mobile-first page, but all sensitive decisions belong to the server: code verification, election state, eligibility, self-vote rejection, duplicate prevention, ballot storage, closing, result computation, authorization, and tenant isolation.

The key privacy boundary is:

- participation records contain the employee identity and whether that employee voted;
- ballot records contain the two selections and mandatory comments, but no employee ID, code, code hash, session ID, IP address, or participation-record ID;
- only a short-lived, single-purpose voting grant connects verification to an atomic submission, and it is not persisted on the ballot;
- routine management APIs never return raw ballots during voting and never expose any voter-to-choice relation after closing.

This is secret-ballot design, not a promise of mathematical anonymity. A highly privileged database operator could correlate precise write times or application logs unless timestamps, logs, access, exports, backups, and retention are also controlled as described below.

## 2. Current architecture and reuse boundary

### Frontend and routing

The application is a static multi-page site served from the repository root by Express. Pages use plain HTML, inline JavaScript, a shared `style.css`, and direct links. There is no frontend build, component system, client router, or localization framework. Page language declarations and visible text are mixed: the main navigation and planning page are French, while department pages and scripts contain Italian, French, and debug text.

The homepage already groups monthly-management links. A future public voting entry and protected management entry can follow that navigation style, but the election UI needs its own JavaScript module and translation resources rather than copying large inline scripts.

### Backend and execution paths

`server.js` is the active Node/Express server. It serves static files, accepts JSON, downloads public Google Sheets CSV data, exports spreadsheets, exposes planning placeholders, and implements training endpoints. Several routes are unauthenticated. Planning save/get and Sheets-to-Firebase synchronization are placeholders. Training data falls back to an in-memory `Map`, so it is not durable across restarts and its admin endpoint has no authorization.

The repository also contains a separate Firebase Functions upload path. `functions/index.js` uses a shared upload password and broad CORS for PDF upload. Firebase Hosting rewrites only that PDF endpoint. This is not an appropriate pattern for employee voting or management authorization.

**Recommendation:** make the deployed Express service the sole authoritative API for this module. It should use Firebase Admin to access Firestore and Storage. Do not split voting writes between browser Firestore SDK calls, Express, and Cloud Functions; that would create inconsistent validation, authorization, logging, and transaction boundaries.

### Firebase reality

Firebase Admin initialization exists and can produce a Firestore client when `FIREBASE_SERVICE_ACCOUNT` is present. The browser Firebase configuration file is not production-ready: it contains placeholder values and even embeds an HTML `<script>` block inside a JavaScript module. The client helper directly reads and writes Firestore without demonstrated security rules. No Firestore rules, Storage rules, emulator configuration, migrations, indexes, or election collections are present.

Firebase can be reused as the technology choice, but the existing client integration cannot be treated as a security foundation. Election clients should call same-origin Express APIs only. Firestore and Storage must deny browser writes for this domain.

### Employee and department data

Department pages request CSV exports through `/api/download-google-sheets`. They infer the employee name from the first column, remove duplicates by display name, and use the name itself as the option value. The department vocabulary visible in code is:

- Cuisine
- Pizzeria
- Service
- Bar
- Office
- Commis
- Respo / ADJ-CdB in some navigation and planning contexts

This data can help seed and reconcile a canonical directory and can preserve the familiar department vocabulary. It cannot establish identity because it has:

- no stable employee ID;
- no normalized first/last/display names;
- no position or role entity;
- no active, inactive, start, end, or voting-eligibility state;
- no personal-code record or code-rotation history;
- no employee photo reference;
- no restaurant/tenant identifier;
- no authoritative employee administration workflow;
- possible duplicate names, spelling changes, headings, schedule rows, and employees appearing in multiple sheets.

The Sheets endpoint currently accepts a caller-provided URL, logs sheet metadata and sample rows, and returns raw schedule content. It is not a safe identity API. A future import job must use a server-configured source, map each row to a reviewed employee record, report ambiguous matches, and never silently generate a second employee when a name changes.

### Authentication and authorization

Firebase Auth is imported in placeholder client code, but there is no functioning login flow, server token verification middleware, management role model, tenant-scoped claims, or route authorization. Password-protected upload is not management authentication.

Public voters should authenticate for this narrow action with employee code verification and a short-lived voting grant. Managers need normal authenticated accounts and role-based authorization; employee codes must never grant management access.

### Storage, dates, and tests

Current documents are primarily Google Drive links; the upload function writes PDFs to Cloud Storage. There is no employee-photo pipeline, image validation, thumbnailing, or private/public serving policy.

Dates currently use JavaScript runtime time and browser locale formatting. There is no declared restaurant timezone or timezone library. Election boundaries therefore cannot rely on clients or unspecified server-local time.

The root package has no test or lint scripts. The Functions package has a testing dependency but no project tests. There are no API, transaction, authorization, privacy, accessibility, browser, or security-rule tests.

### Safe reuse

Reuse:

- Express as the same-origin API and static-file host;
- Firebase Admin as the server database/storage SDK after hardening initialization;
- Firestore as the single durable production database;
- existing department labels after product normalization;
- Google Sheets names only as migration input requiring reconciliation;
- shared visual identity and simple multi-page navigation.

Do not reuse:

- display names as identity;
- client-side Firestore writes;
- unauthenticated admin routes;
- shared plaintext upload passwords;
- in-memory fallback for election operations;
- caller-selected Sheets URLs;
- browser time for lifecycle decisions;
- verbose logging of personnel rows, codes, grants, comments, or ballots.

## 3. Domain model

All identifiers are opaque random IDs. Every domain record includes `tenantId`; every server query and document path is tenant-scoped. For the current restaurant there may initially be one tenant, but it must still be explicit.

### Tenant

`tenants/{tenantId}`

- `name`
- `slug`
- `timeZone`: required IANA name, proposed default only after confirmation: `Europe/Zurich`
- `supportedLocales`: `["fr", "it", "en"]`
- `defaultLocale`: product decision
- `active`

The IANA timezone is authoritative for election month and boundaries. Never store only a numeric UTC offset.

### Departments and positions

`tenants/{tenantId}/departments/{departmentId}`

- stable `departmentId`
- translated `nameKey` or localized labels
- `sourceAliases`: controlled import aliases such as `Respo`
- `active`, `sortOrder`

`tenants/{tenantId}/positions/{positionId}`

- stable `positionId`
- translated label/key
- optional `departmentIds`
- `active`, `sortOrder`

Department and position are separate. A position is not inferred from the planning sheet name.

### Employees: one canonical directory

`tenants/{tenantId}/employees/{employeeId}`

- `employeeId`
- `displayName`, normalized searchable name, optional separated names
- `departmentId`, optional `positionId`
- `active`
- `employmentStart`, optional `employmentEnd`
- `votingEnabled`
- `candidateEnabled`
- `photo`: `{ originalObject, thumbnailObject, version, updatedAt }` or null
- `sourceRefs`: reviewed external references, not a display-name identity
- `createdAt`, `updatedAt`, `updatedBy`

Sensitive code verifier material should not be returned with employee documents. Prefer a separate server-only collection:

`tenants/{tenantId}/employeeCredentials/{employeeId}`

- `codeHash`
- `hashAlgorithm` and parameters/version
- `codeVersion`
- `status`: active, rotation-required, disabled
- `failedAttemptState` if per-employee throttling is used
- `createdAt`, `rotatedAt`

Firestore Security Rules must deny all browser access to credentials. Only the server service account accesses them.

### Elections and eligibility snapshots

`tenants/{tenantId}/elections/{electionId}`

- `monthKey`: restaurant-local `YYYY-MM`
- `timeZone`
- `opensAt`, `closesAt`: UTC instants derived once from local policy
- `stateOverride`: normally null; emergency suspended/cancelled only with audit
- `categoryDefinitions`: exactly two stable category IDs and translation keys
- `eligibilitySnapshotVersion`
- `createdAt`, `closedAt`, `resultsComputedAt`
- `resultStatus`: pending, computing, final, failed

Use deterministic uniqueness for `(tenantId, monthKey)`, for example election ID `YYYY-MM` within the tenant.

`.../elections/{electionId}/eligibleVoters/{employeeId}`

- snapshot of voter eligibility;
- minimal display/admin snapshot fields;
- `codeVersionRequired`;
- source/reason and snapshot timestamp.

`.../elections/{electionId}/eligibleCandidates/{employeeId}`

- `employeeId`
- immutable display-name, department, position, and photo-version snapshot needed to render and preserve historical results;
- category eligibility flags if categories differ.

Snapshots prevent later transfers, renames, deactivation, or photo changes from rewriting a past election. The canonical employee remains the source for future elections.

### Participation and secret ballots

`.../elections/{electionId}/participation/{employeeId}`

- `status`: submitted
- `submittedAtBucket`: coarse operational timestamp if needed
- `credentialVersionUsed`
- no candidate IDs, comments, ballot ID, or request identifiers

Document ID uniqueness enforces one final ballot per eligible employee per election.

`.../elections/{electionId}/ballots/{randomBallotId}`

- `choices`: map of the two category IDs to candidate employee IDs
- `comments`: map of both category IDs to validated mandatory comments
- candidate snapshot/version reference
- schema version
- no voter identity, participation ID, credential data, grant ID, IP, user agent, analytics ID, or exact client timestamp

Submission runs in one Firestore transaction:

1. Re-read the election and server-authoritative time.
2. Verify it is open.
3. Validate the one-time voting grant and matching tenant/election/employee.
4. Read voter eligibility and both candidate snapshot documents.
5. Reject self-votes and invalid/inactive-for-snapshot candidates.
6. Confirm the participation document does not exist.
7. Create the participation document and random-ID ballot.
8. Mark the voting grant nonce consumed in the same transaction, or rely on a transaction-created participation record plus one-time grant store.

Because Firestore transactions retry, random ballot ID and all validated inputs must be fixed before transaction execution, and creates must be idempotently handled. A second concurrent request loses on the participation/grant precondition and returns `ALREADY_VOTED`, not a generic server error.

### Results, winners, and ties

`.../elections/{electionId}/results/{categoryId}`

- total eligible voters, participants, valid ballots;
- counts by candidate;
- highest count;
- `winnerEmployeeIds`: array, length greater than one for ex-aequo;
- immutable candidate display/photo snapshots;
- computation version and finalization timestamps;
- integrity totals and status.

Results are computed only after `closesAt`, in a server job or idempotent protected command. Never depend on one administrator opening a page. Firestore aggregate limitations may require a bounded server scan for the restaurant-size dataset; larger scale should use an event-maintained encrypted/controlled tally plus a close-time reconciliation. The initial implementation should prioritize correctness and recompute deterministically.

Raw comments may be shown to authorized management only after close and must not include exact ballot timestamps or any voter metadata. Product must decide retention and whether comments are retained verbatim, redacted, or deleted after a defined period.

### Audit events

`tenants/{tenantId}/auditEvents/{eventId}`

- actor type and authorized manager ID where applicable;
- action, target type/ID, outcome;
- coarse timestamp, request correlation ID;
- safe metadata only.

Audit employee edits, imports, eligibility snapshot creation, election suspension, close/finalization, result access, photo changes, and code rotation. Do not audit entered codes, hashes, comments, candidate choices, voting grants, or a ballot/participation cross-reference. Voter submission audit should be an aggregate-safe success/failure event without employee or ballot linkage, while the participation record itself proves voting occurred.

## 4. Employee-code security and privacy

### Code creation and storage

Personal codes must be generated with cryptographically secure randomness, be long enough for the expected threat model, and avoid predictable employee-derived values. Store only a slow password hash (Argon2id preferred; scrypt acceptable where runtime support is simpler) with per-code salt and versioned parameters. A server-side pepper stored in Replit Secrets can add defense in depth but does not replace a slow hash.

Never:

- store plaintext codes in Firestore, Sheets, logs, exports, analytics, URLs, local storage, or browser telemetry;
- compare plaintext codes in client JavaScript;
- use reversible encryption as the primary verifier;
- reveal whether a specific employee exists or which employee matched before successful verification.

Use constant-time-safe library verification. Return generic invalid-code responses.

### Verification flow

`POST /api/v1/public/elections/current/verify-code` accepts code and locale in the body over HTTPS. On success, the server returns a short-lived, signed or server-stored voting grant scoped to tenant, election, employee, credential version, and nonce. Prefer an HttpOnly, Secure, SameSite=Strict cookie plus CSRF protection; if returned in JSON, keep it only in memory and never place it in URLs or persistent browser storage.

The grant:

- expires quickly, for example 10 minutes;
- is valid only for candidate retrieval and one final submission;
- becomes invalid when used, when the code rotates, or when election state changes;
- contains no plaintext code;
- is replay-protected by a nonce consumed atomically on submission.

### Rate limiting and brute-force controls

Apply layered controls:

- per-IP and privacy-safe network-prefix throttles;
- per-tenant global limits and anomaly alerts;
- per-code-fingerprint throttling using an HMAC of normalized input, never logging the input;
- escalating delay and temporary lockout without exposing which code is valid;
- bounded request body size;
- bot protection/challenge after suspicious failures;
- generic `429` with retry guidance;
- do not permanently lock an employee out based only on attacker-controlled failed attempts.

Store rate-limit data with short TTL and restrict access. Logs should include route, coarse outcome, status, latency, and opaque request ID, but no code/fingerprint, employee identity, grant, ballot selections, comments, or raw body.

### Backfill and rotation

Management must first reconcile a unique canonical employee record. For each active employee:

1. Generate or ingest a code through a restricted server-side process.
2. Hash immediately; never stage plaintext in Firestore.
3. Deliver the initial code through an approved out-of-band process.
4. Record credential version and require rotation when appropriate.
5. Disable old verifiers on rotation, termination, loss, or compromise.

If the current management source already contains codes, the migration process must read them in a restricted one-time environment, hash them without logging, write only hashes, produce counts and exception reports without code values, and remove any temporary plaintext export. Product confirmation is required on code length, issuance, recovery, and whether managers may reset but never view a code.

## 5. Election lifecycle and authorization

### Authoritative monthly states

The policy is voting from the 25th through the end of the month in the tenant timezone.

For an election month:

- `UPCOMING`: before local 00:00 on the 25th;
- `OPEN`: from local 00:00 on the 25th, inclusive;
- `CLOSED_PENDING_RESULTS`: from local 00:00 on the first day of the next month until finalized;
- `RESULTS_FINAL`: final results available;
- `SUSPENDED` or `CANCELLED`: explicit audited exception.

Compute and persist UTC boundary instants from the tenant IANA timezone when creating the election. Every API state decision compares server time to those instants. Browser time is display-only. “End of month” is represented as the exclusive start of the next local month, avoiding `23:59:59` and variable month-length bugs.

At a boundary, transaction-time state wins. A form loaded while open may be rejected as `ELECTION_CLOSED` if submitted after close. No grace period exists unless product defines one. The client should show server time/state and preserve comments in memory long enough to explain the rejection, but must not retry after close.

### Validation and immutability

The submission API validates:

- grant signature/session, expiry, nonce, tenant, election, and credential version;
- election is open;
- voter exists in the voter snapshot;
- both configured categories are present exactly once;
- candidate IDs exist in the candidate snapshot and are category-eligible;
- neither candidate is the voter;
- whether selecting the same colleague in both categories is permitted (open product decision);
- mandatory comments meet trimmed minimum/maximum length and content policy;
- no participation document already exists.

Submitted ballots are immutable. There is no edit or delete endpoint for routine users or managers. Exceptional legal deletion must be a restricted, audited operational procedure and may invalidate published aggregates, so retention requirements must be settled before launch.

### Authorization matrix

Public, no grant:

- read sanitized current election state and public translation/config metadata;
- verify a code under rate limits.

Verified voting grant:

- read the eligible candidate list for that election;
- read its own participation status;
- submit exactly one ballot;
- never read another voter, participation list, ballots, comments, or interim results.

Authenticated manager:

- only for assigned tenant;
- manage employees, departments, positions, photos, credentials/reset, and future-election eligibility according to role;
- during voting, read participation totals and list of employees who have/have not participated, but no ballots, candidate counts, comments, or rankings;
- after close/finalization, read final counts, winners/ties, history, and comments without voter linkage;
- cannot change submitted ballots.

System worker:

- create monthly snapshot/election, close/finalize, compute results, and perform integrity checks with least-privilege service credentials.

Firebase Auth ID tokens should be verified by Express for managers. Tenant membership and roles must be loaded server-side or from carefully maintained custom claims and revalidated for sensitive actions. UI hiding is not authorization.

### Tenant isolation and datastore rules

Every route derives `tenantId` from trusted host/config or authenticated membership, never an arbitrary request-body tenant. Every Firestore path and Storage object includes tenant scope. Repository helpers should require tenant context so an unscoped query is difficult to write.

Browser Firestore/Storage rules:

- deny all direct reads/writes to credentials, participation, ballots, audits, and result internals;
- deny direct writes to all election-domain records;
- photos may be served through authorized/signed server URLs or from a deliberately public thumbnail path containing no sensitive metadata;
- original uploads remain private.

Required indexes include:

- employees by tenant + active + normalized display name;
- employees by tenant + department + active;
- elections by tenant + monthKey/state;
- audit events by tenant + timestamp/action;
- results/history by tenant + month;
- TTL index/policy for grants and rate-limit records where supported.

Participation uniqueness and election uniqueness should come from deterministic document IDs, not query-then-write checks.

### Failure behavior

If Firestore, credentials, tenant timezone, or security configuration is unavailable, fail closed with `503`; never use in-memory fallback and never accept a ballot for later local synchronization. Submission responses use stable error codes and do not reveal sensitive identity information. Safe retries are allowed only with the same idempotency key/grant, and must return the already-submitted state without creating another ballot.

If result computation fails, keep `CLOSED_PENDING_RESULTS`, expose no partial result, alert operations, and allow idempotent recomputation. If photo processing fails, preserve the employee and use the fallback avatar; do not block voting. If an employee is deactivated after snapshots are created, an authorized manager needs an audited election-specific eligibility action rather than silently mutating history.

## 6. User experience

### Stable public mobile flow

Use a stable same-origin URL such as `/collaborateur-du-mois.html`; the server determines the current tenant and election. The flow:

1. **Status/code entry:** explain the two categories, privacy, voting window, and one-final-vote rule. Enter personal code with an accessible show/hide control.
2. **Verification:** generic failure message, throttling message, or already-voted confirmation. Do not reveal employee names on failure.
3. **Category one:** searchable candidate cards with thumbnail/fallback, display name, department, and position. The authenticated voter is omitted and also rejected server-side.
4. **Mandatory comment one:** labeled textarea, remaining-character count, no sensitive-data prompt.
5. **Category two and mandatory comment:** same behavior with the second translated category.
6. **Review:** show both choices and comments; clearly state submission is final.
7. **Submit once:** disable repeat action while pending, use idempotency protection, then remove the grant and show confirmation.

Candidate search should be local over the authorized candidate response for a small directory, accent-insensitive, keyboard operable, and not expose codes. Cards need visible selected/focus states, meaningful photo alt behavior, and a non-photo fallback using initials or a neutral icon. Do not use color alone.

Explicit states:

- upcoming with opening date;
- open;
- already voted;
- closed/results pending;
- results available if product wants public results;
- suspended/cancelled;
- no eligible candidates;
- session expired, offline, throttled, validation error, and service unavailable.

The page must not load third-party analytics, session replay, ad scripts, or external image hosts in the ballot flow. Set `Cache-Control: no-store` for verification, candidates tied to a grant, participation, and submission responses. Use strict CSP, clickjacking protection, referrer policy, and secure cookies.

### Management experience

Protected screens:

- **Employees:** canonical list, search/filter, department, position, active/eligibility state, photo, credential status, import/reconciliation status. Managers may reset codes but not retrieve existing codes.
- **Election setup:** month, server-derived window, two category definitions, eligibility preview and exceptions, snapshot creation, state, and audited emergency suspension.
- **Participation during voting:** counts and eligible employee names marked voted/not voted. No candidate totals, rankings, comments, raw ballots, or exact ballot timestamps.
- **Final results:** final counts, participation rate, winner cards, explicit ex-aequo presentation, integrity totals, and result version.
- **Comments after closing:** grouped by category/candidate as product allows, with no voter identity, ballot timestamp, or export fields that permit linkage.
- **History:** immutable month summaries and winner snapshots.
- **Audit:** privileged operational events, never ballot content.

### Photos

Managers upload photos through an authenticated Express endpoint using multipart parsing with strict size limits. The server:

- verifies authorization and tenant;
- validates actual decoded image type, not filename/MIME alone;
- rejects SVG and active content;
- strips EXIF/metadata;
- re-encodes to a safe format;
- crops or creates fixed thumbnails;
- stores private originals and versioned thumbnails in tenant/employee paths;
- records object generation/version;
- serves thumbnails with controlled cache headers or short-lived signed URLs.

Deletion/replacement must not break historical results: election snapshots retain a photo version/reference or intentionally fall back if retention policy deletes it.

## 7. Proposed API contracts

All responses contain a stable `code`, translated UI keys or data, and an opaque `requestId`. Server logs use the request ID without logging bodies.

### Public election

`GET /api/v1/public/election`

Returns sanitized state, month key, server time, open/close instants, timezone, category translation keys, supported locales, and whether public final results are available. No candidates before verification.

`POST /api/v1/public/election/verify-code`

Body: `{ code, locale }`. Success establishes/returns a short-lived voting grant and returns `{ state: "VERIFIED" | "ALREADY_VOTED", expiresAt }`. Invalid codes return generic `INVALID_CREDENTIALS`; throttling returns `RATE_LIMITED`.

`GET /api/v1/public/election/candidates`

Requires voting grant. Returns voter-safe election metadata and candidate snapshots: employee ID, display name, department/position labels or keys, and thumbnail URL/version. It omits the voter.

`GET /api/v1/public/election/participation`

Requires voting grant. Returns only `{ submitted: boolean }` for that verified employee and election.

`POST /api/v1/public/election/ballots`

Requires grant, CSRF protection, and `Idempotency-Key`. Body:

```json
{
  "choices": {
    "category_1": { "candidateId": "emp_...", "comment": "..." },
    "category_2": { "candidateId": "emp_...", "comment": "..." }
  }
}
```

Returns `201 SUBMITTED`; concurrent/replayed requests return the same submitted outcome or `409 ALREADY_VOTED`. It never returns a ballot ID.

`GET /api/v1/public/election/results`

Only if product approves public results and only after finalization. Returns final aggregates and tie-aware winner arrays, never comments or ballots.

### Manager APIs

All require verified Firebase Auth plus tenant role checks.

- `GET/POST/PATCH /api/v1/management/employees`
- `POST /api/v1/management/employees/import-preview`
- `POST /api/v1/management/employees/import-apply`
- `POST /api/v1/management/employees/{id}/credential-reset`
- `POST /api/v1/management/employees/{id}/photo`
- `DELETE /api/v1/management/employees/{id}/photo`
- `GET/POST/PATCH /api/v1/management/departments`
- `GET/POST/PATCH /api/v1/management/positions`
- `GET/POST /api/v1/management/elections`
- `POST /api/v1/management/elections/{id}/snapshot`
- `GET /api/v1/management/elections/{id}/participation`
- `GET /api/v1/management/elections/{id}/results`
- `GET /api/v1/management/elections/{id}/comments`
- `GET /api/v1/management/elections/history`
- `GET /api/v1/management/audit`

Imports use preview/confirm semantics and explicit match decisions. They never accept client-supplied stable IDs without authorization and validation.

## 8. Localization

Add explicit translation catalogs, for example `locales/fr.json`, `locales/it.json`, and `locales/en.json`, loaded by the new pages or embedded through a small shared localization module. Every visible label, validation error, status, category title, date phrase, accessibility label, and server error maps to a stable translation key. Do not hard-code user-facing strings in route handlers or page scripts.

Locale selection order:

1. explicit user choice stored as a non-sensitive preference;
2. supported browser language;
3. tenant default.

Set `<html lang>` dynamically/correctly, use `Intl.DateTimeFormat(locale, { timeZone: tenant.timeZone })`, and format names without assuming Western first/last order. Persist stable category IDs, never translated category strings. Comments remain in the language entered and are not automatically translated.

API error codes stay language-neutral (`ELECTION_CLOSED`, `SELF_VOTE_NOT_ALLOWED`); the client maps them to FR/IT/EN. Server-generated emails or printable code sheets, if later approved, use the same catalogs.

## 9. Verification strategy

### Unit tests

- timezone conversion and state for all month lengths, leap years, DST changes, and exact boundaries;
- category/comment validation;
- self-vote and candidate eligibility;
- code normalization, hashing, versioning, rotation, and generic errors;
- locale negotiation and all translation-key presence;
- tie calculation and deterministic result recomputation;
- import normalization and ambiguous duplicate-name detection;
- photo type/size/dimension validation.

### API and authorization tests

- every public and management route by role and tenant;
- forged/expired/replayed grants and CSRF failure;
- no cross-tenant reads/writes by changing IDs or paths;
- managers cannot read ballots during or after voting through any endpoint;
- interim results and counts are embargoed;
- browser cannot directly access protected Firestore/Storage paths;
- body limits, unsafe uploads, injection strings, and stable safe errors;
- unavailable Firestore fails closed without in-memory writes.

### Transaction and privacy tests

- two simultaneous submissions for the same employee produce one participation document and one ballot;
- retry/idempotency behavior does not create an extra ballot;
- different employees can submit concurrently;
- participation documents contain no ballot fields or IDs;
- ballot documents contain no voter/grant/network/session fields;
- logs, error reports, analytics, URLs, exports, audits, and admin responses contain no codes, comments during voting, or linkage;
- database export access and operator roles follow least privilege.

Run these against the Firestore emulator with deliberate transaction conflicts and, before rollout, against an isolated staging project.

### Lifecycle and result tests

- 24th/25th transition and first-of-next-month transition in the restaurant timezone;
- submit begun before close but committed after close;
- 28/29/30/31-day months;
- election suspension and recovery;
- zero votes, one vote, ineligible/deactivated candidates, and both categories;
- two-way and multi-way ties represented as arrays without arbitrary tie-breaking;
- result job retry, partial failure, and deterministic reconciliation;
- historical snapshots remain unchanged after employee edits.

### Migration, UI, and accessibility tests

- import preview for duplicate names, renamed employees, cross-department moves, missing positions, and inactive staff;
- no duplicate employee directory is created;
- credential backfill writes hashes only and sanitized exception reports;
- valid/invalid/rotated code and recovery process;
- photo replacement, corrupt images, metadata stripping, fallback, and historical version behavior;
- responsive tests on narrow mobile, tablet, and desktop;
- keyboard-only selection/search/review, screen reader labels/live errors, focus management, contrast, zoom, and reduced motion;
- browser tests for current Chrome, Safari/iOS, Firefox, and Edge;
- offline/slow network, double tap, refresh/back button, expired session, and closed-boundary UX.

Add CI validation commands only during implementation. Security review and a privacy-focused code review are release gates.

## 10. Phased implementation plan

Each phase is independently testable and should be reviewed before the next begins.

1. **Foundation decisions and threat model**
   - Confirm tenant/timezone, category definitions, same-candidate rule, public-result policy, comment retention/moderation, code issuance/recovery, eligibility rules, management roles, and legal/privacy retention.
   - Produce data-flow/threat model and acceptance tests.

2. **Canonical employee directory**
   - Add tenant, department, position, employee, and credential models.
   - Build protected manager authentication/authorization.
   - Implement Sheets import preview/reconciliation into the single directory.
   - Add credential hashing, reset, throttling foundations, and audit controls.
   - Do not open voting yet.

3. **Election core and datastore protections**
   - Add elections, immutable eligibility snapshots, participation, ballots, results, grants, indexes, and deny-by-default rules.
   - Implement timezone lifecycle and transaction service with emulator tests.

4. **Public voting API**
   - Implement status, verification, candidate, participation, and atomic submit endpoints.
   - Add replay protection, idempotency, safe logging, cache/security headers, and rate limits.
   - Complete concurrency and privacy tests before UI connection.

5. **Mobile public voting UI and localization**
   - Build the stable public page and FR/IT/EN catalogs.
   - Implement searchable cards, two required comments, review/final submit, all state/error screens, accessibility, and responsive tests.

6. **Management election experience**
   - Build employee/photo administration, eligibility preview/snapshot, participation-only live view, and post-close result/comment/history views.
   - Enforce the embargo and role matrix through API tests, not only UI.

7. **Photo pipeline**
   - Add authenticated upload, decode/re-encode, metadata stripping, thumbnails, private originals, versioning, fallback, and storage lifecycle tests.
   - This may proceed alongside phase 5 after employee IDs and authorization exist.

8. **Automated close, results, and rollout**
   - Add idempotent monthly creation/finalization scheduling and operational alerts.
   - Backfill employees/codes through reviewed migration, run a staging dry run and mock election, verify backup/access/retention, then enable one production election behind a feature flag.
   - Monitor aggregate success/failure metrics only; do not instrument ballot choices or comments.

## 11. Open product decisions

Implementation must not guess these:

1. Is the authoritative restaurant timezone `Europe/Zurich`?
2. What are the exact two category names and eligibility rules?
3. May one colleague be selected in both categories?
4. Who may vote and be a candidate: all active employees, minimum tenure, managers, temporary staff, or department restrictions?
5. Are final results public to employees, management-only, or both?
6. How long are ballots, comments, participation records, audit events, and photos retained?
7. May managers view all comments verbatim, and what moderation/redaction process applies?
8. How are initial codes delivered, recovered, and rotated, and what minimum code format is acceptable?
9. Which management roles can edit employees, reset codes, create snapshots, suspend elections, view participation, and view final comments?
10. Should a person with multiple departments have one primary department, multiple memberships, or election-specific candidate labels?
11. What is the approved behavior for termination or eligibility correction after an election snapshot is created?
12. Must past winner photos remain frozen, or may they fall back when an employee photo is deleted?