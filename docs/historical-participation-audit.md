# Historical Participation Audit — September 2026

**Audit date:** 2026-10-02
**Scope:** Read-only source and runtime-boundary audit of September 2026 “Collaborateur du mois” participation. This report distinguishes current source-code facts from datastore facts. It does not certify the deployed version or the existence or contents of a live election.

## A. Executive finding and evidence boundary

The current source stores each election under a month-specific Firestore document and does not contain a rollover deletion path. Historical election documents are therefore addressable by month **if they still exist**. The Administration monitoring endpoint does not accept a month: it computes the present Europe/Zurich month, reads only that election, and the page calls only that endpoint. The source-code explanation for September disappearing from this page is therefore **A — current-month-only query**.

The current schema snapshots eligible voter IDs and verification data, but not a complete immutable voter-name/department roster. The current named view resolves the old voter IDs against the **current** directory snapshot. It can fail for removed staff and can show today's directory values rather than the election-time values. This source design cannot guarantee a historically accurate, complete named electorate.

**Evidence classes**

- **Verified in current source:** implementation paths and behavior cited below.
- **Runtime evidence observed:** the deployment metadata callback reported a successful public Replit VM deployment at `https://infosmolinomolard.replit.app`. This is a Replit deployment, not proof of the Railway service or its Firebase binding.
- **Prior workspace records:** earlier audit documents report that production binding was not verified. They are context only and were not used as proof of the current target.
- **Live September Firestore facts:** **UNKNOWN; no election data was queried.**

The current project task view showed this audit in progress and no separate Railway deployment task in progress; the Railway-address confirmation task was proposed. The available deployment metadata describes Replit, not Railway. The actual active Railway service/revision, Firebase Admin project, Firestore database, production site, data environment, and authorized read-only access could not be independently established from trusted current runtime/deployment evidence. The source requires a service-account JSON at runtime, but its project ID is taken from that credential; the production validator checks that the JSON is well-formed and non-empty, not that its project matches the public Firebase `projectId`. Firestore is initialized through `admin.firestore()` without a named database selection, so source code implies the default database but does not verify the deployed target.

**Boundary decision:** stop before querying September election data. No public election endpoint, readiness route, or other application endpoint was called. No Firestore election document, participation record, voter map, ballot, grant, result, or other live election data was read. No secret value was accessed or displayed.

## B. Current architecture and exact Firestore paths

`server.js` initializes Firebase Admin, creates the directory and election runtimes, mounts public election routes, then mounts protected management monitoring. The browser uses same-origin HTTP routes; it does not access Firestore directly. The browser rules deny access to the election and directory snapshot trees; server-side Firebase Admin access is the relevant trust boundary.

`FirestoreElectionStore` scopes elections as follows:

```text
electionSites/{siteId}/dataEnvironments/{development|production}/elections/{YYYY-MM}
```

For the intended September identifier, the source-derived path pattern is:

```text
electionSites/{siteId}/dataEnvironments/{dataEnvironment}/elections/2026-09
```

The actual site, environment, Firebase project and database for the live September source are **UNKNOWN**.

Within a monthly election, the current source uses:

| Relative path | Source-defined purpose |
|---|---|
| `participation/{employeeId}` | One submitted-status document per eligible voter; its document ID carries the voter identity. The document body has status and submitted month, but no ballot reference or application submission timestamp. |
| `ballots/{randomUUID}` | Anonymous choice and comment payload. It has no voter ID, grant ID, or participation reference. **No ballot documents were read in this audit.** |
| `grants/{tokenHash}` | Short-lived authorization state, including the voter identity and consumed/expiry fields. |
| `resultInternals/final` | Private finalized result, separate from participation. It was not read. |

The election document itself holds month/window fields, the eligible-voter count, a `voters` map, a `candidates` map, directory source generation and creation time. In the current implementation the voter map is keyed by employee ID and contains the ID, voting group and verifier/version fields. The candidate map contains election-time candidate display name, job title, department, voting group and photo reference. The voter map does **not** contain voter display name or department.

The employee directory is persisted separately at:

```text
employeeDirectorySnapshots/{siteId}
```

`FirestoreDirectoryStore.replaceFromSource()` replaces that site's directory snapshot after validation and increments `sourceGeneration`. This is a current directory snapshot, not a per-month history of names.

## C. Election month key, Zurich window, state and creation

`election-engine/contract.js:electionWindow(now, timeZone)` formats the supplied instant in the configured timezone and constructs `YYYY-MM` from the local year and month. It calculates the inclusive opening instant as local midnight on the 25th and the exclusive closing instant as local midnight on the first of the next month. `localMidnightUtc()` converts those local boundaries to UTC, including timezone offset.

For September 2026 in `Europe/Zurich`, the code-derived window is:

- Opens: **2026-09-25 00:00 Europe/Zurich**, equivalent to `2026-09-24T22:00:00.000Z`.
- Closes: **2026-10-01 00:00 Europe/Zurich**, exclusive, equivalent to `2026-09-30T22:00:00.000Z`.
- Month document ID: **`2026-09`**.

These are source-derived expected values, not a read of the stored September document.

`electionState()` derives `UPCOMING`, `OPEN`, or the closed internal state (`CLOSED_PENDING_RESULTS`) from the stored window and the supplied current instant. State is not written as an election document field. If a September document had the expected window, code evaluated on 2026-10-02 would derive it as closed. The actual stored window and any actual derived state are **UNKNOWN**.

`ElectionService.current()` calls `electionWindow()` and then `store.ensureElection()`. `ensureElection()` uses a transaction: if the month document exists, it returns it unchanged; otherwise it validates the current directory snapshot and creates the month document with voter/candidate maps and the eligible count. Thus the first request that invokes `current()` for a new month can create election state. The public election/status, verify, candidates, participation and submit service paths use `current()`; they are not safe historical audit probes.

## D. Current-month monitoring query and name resolution

`election-engine/monitoring.js:createElectionMonitoringService().read()` independently computes `electionWindow(observedAt, timeZone)`, builds the reference using that window's `monthKey`, and reads only that document. Its metadata projection is limited to site, data environment, month, timezone, opening/closing instants and eligible-voter count. It then performs aggregate counts for the current month's participation and ballot subcollections.

For the optional named list, `resolveIndividuals()`:

1. Projects only the current election's `voters` map.
2. Validates that the map size matches `eligibleVoterCount`.
3. Reads `directoryService.getElectionSnapshot()` and maps its **current** employee entries by employee ID.
4. Requires each voter key to match the voter record, a current directory entry, voting group and allowed department; it also rejects duplicate normalized names.
5. Reads only participation document references/IDs via a selected-fields query, not participation payloads; it verifies the count and that each ID belongs to the voter map.
6. Returns current directory name/department and `hasVoted`; on any failed check, it returns `UNAVAILABLE` rather than fabricating a roster.

The endpoint is `GET /api/v1/management/election-monitoring`, protected by the Administration session authorization. `private-pages/suivi-du-vote.html` and `suivi-du-vote.js` render the returned month and roster. The client uses a fixed endpoint URL with no month argument, and the response contains no historical selector or requested-month field.

The public `GET /api/v1/public/election` is also current-month only and invokes the election service. It can create a missing election, so it is not a read-only source for history.

## E. Rollover, historical addressability and disappearance cause

When Zurich local time enters a new month, `electionWindow()` selects a new `YYYY-MM` document. The old month's election, participation and ballots remain in their old month-scoped paths under the source's normal write/read design. Grants are also month-scoped. No election deletion or rollover cleanup is present in the inspected election store/service code. A later directory refresh replaces the current directory snapshot but does not update an election document already created.

This establishes **code-level historical addressability**, not actual September retention. External deletion, retention policies, a different deployed version, wrong project/database/site/namespace, or a missing original document cannot be ruled out without a verified datastore read.

**Cause classification: A — current-month-only monitoring query/UI.** The endpoint derives the month from the current time and the UI has no historical month parameter. On 2026-10-02, a request follows the code path for October, not `2026-09`. The route returns `ELECTION_NOT_FOUND` if that current-month document is absent; it does not search previous months.

The observed disappearance from the current Administration page is therefore explained by the code's current-month-only query. Whether September data is present, partially missing, overwritten or deleted remains **UNKNOWN**. The source's first-write-wins election creation and lack of a rollover deletion path do not prove live retention.

## F. September 2026 datastore findings — blocked / UNKNOWN

The target binding and authorized read-only access were not established, so the required live inspection was not run. The following are not zeroes or inferred results:

| September fact | Finding |
|---|---|
| Intended election identifier | `2026-09` by source calculation; live document existence **UNKNOWN** |
| Actual Firebase project / Firestore database | **UNKNOWN** |
| Actual site / data environment | **UNKNOWN** |
| Stored election window | **UNKNOWN**; source schema writes window fields |
| Persisted status field | Current source schema has no persisted status field; derived live status **UNKNOWN** |
| Eligible-voter count | **UNKNOWN** |
| Participation-record count / availability | **UNKNOWN** |
| Ballot count | **UNKNOWN**; no ballot query or read was made |
| Participant identity keys recoverable from participation records | **UNKNOWN** for live September; source design uses participation document IDs |
| Non-participant identity keys recoverable from an electorate snapshot | **UNKNOWN** for live September; source design stores voter keys if the election document exists |
| Complete historical electorate/name snapshot | **NO in the current source schema**; whether the live September document has another shape is **UNKNOWN** |
| Historical participant names recoverable accurately | **UNKNOWN** for live data; current source depends on today's directory and does not preserve a complete election-time voter roster |

No individual identity, employee identifier value, verifier, ballot content, selection, comment, or voter-to-ballot relationship is included in this report.

## G. Recoverability and historical accuracy

**Source-code capability:** if a monthly election document and its participation subcollection still exist, participation document IDs can identify the voters who submitted. If its `voters` map also exists, the full eligible identity-key set can be compared with the participant set to derive non-participants. The current structure therefore contains a potentially recoverable identity-key-level participation view.

**Names and departments:** current monitoring resolves those IDs against the directory snapshot available today. Directory refresh replaces that snapshot, so current data may be missing former employees or may reflect later name/department changes. The current resolver requires all voter IDs to resolve and checks their current voting group and department; an absent or inconsistent entry makes the entire named roster unavailable. It does not label a current directory value as historical.

The election-time `candidates` map snapshots display fields for candidates only. Matching its candidate keys against the voter map could supply election-time names for the subset eligible both to vote and to be a candidate, but it is not a complete electorate roster and the current resolver does not use it for participation names.

Accordingly, the code supports a limited identity-key reconstruction if the relevant documents exist, but it does **not** support a guaranteed complete, historically accurate nominative view for all September eligible voters. Whether any live September participant/non-participant keys or names can actually be recovered is **UNKNOWN** because the datastore was not read.

## H. Privacy and anonymity

The current submission transaction creates a deterministic identity-bearing participation record and a separate randomly keyed ballot containing choices/comments; it does not place the employee ID or grant on the ballot, nor a ballot ID on the participation record. The management roster intentionally reports participation status by employee name, but does not expose choices. Browser Firestore rules deny direct access to these records; management requests are session-authorized on the server.

This is separation of identity-to-participation from identity-to-choice, not a guarantee against a privileged operator correlating write metadata or inferring a voter from free-text comments. Exact timing, small electorates, comments and privileged database access remain correlation risks. The audit did not inspect ballots, comments, grants, participation payloads or any voter-to-ballot relationship.

A history implementation should preserve the existing behavior: show only authorized name/department/participation status and aggregate checks; never return ballots, candidate selections, comments, grants, verifier data, employee IDs, ballot IDs or exact voter-level timestamps. Keep all Firestore reads server-side, preserve deny rules, authorize every history request, scope site/environment from server configuration, and use `Cache-Control: no-store`.

## I. Integrity limits and source/UI caveats

- The submit path transactionally creates the participation record and anonymous ballot together, so ordinary successful application submissions are intended to remain count-aligned. Counts alone cannot prove which participation corresponds to which ballot or validate anonymous ballot contents; do not join them.
- The current monitoring route reports an aggregate anomaly when participation and ballot counts differ or exceed eligible voters. It does not repair records.
- The named roster path separately checks voter-map size, participation IDs and current directory fields. Its failure preserves aggregates and suppresses the named list; it does not establish that September was deleted.
- `electionState()` returns the internal closed state `CLOSED_PENDING_RESULTS`, while `suivi-du-vote.js` currently accepts `CLOSED` as its closed display label. A historical UI should define and test an explicit internal-to-display state mapping rather than assume these strings are identical.
- The audit cannot establish whether the live data follows the current schema, whether any records were changed by privileged operations, or whether the deployed code matches this worktree.

## J. Recommended monthly-history design

For future elections, write an **immutable, minimal, per-election electorate/name snapshot** at the same time the election is first created. Preserve, for each eligible voter, the election-time display name and department (and only any other explicitly approved display fields). Keep it separate from verifier material; do not duplicate the voter code, verifier, or grant data. Bind it to the same site, environment and month, and never update it from later directory refreshes.

The current `voters` map remains the source of eligibility and verification so the vote flow, credential checks and duplicate-vote behavior are unchanged. A separate snapshot document/subcollection prevents historical display resolution from depending on today's directory. The authorized management read path can match the existing participation document IDs against that month's snapshot and return only the named status DTO, without reading ballots.

The snapshot must be created only by the server-side election creation flow, be immutable after creation, have explicit version/size checks, and be covered by the existing server-only Firestore boundary. If the roster does not validate or is absent, show aggregates and state that the named historical roster is unavailable; do not fall back silently to today's directory or guess names. Confirm retention, permitted manager access and retention duration for this added identity-bearing history before production rollout.

## K. Future files/functions and safe implementation sequence

**Likely code paths**

- `election-engine/contract.js`: month/window/state contract and any new snapshot-field validation.
- `election-engine/firestore-store.js`: `ensureElection()` first-write transaction and a new read-only month-specific monitoring repository method. Do not reuse a creating path for historical reads.
- `election-engine/service.js`: current-month service contract; keep voting/verification/submit behavior unchanged.
- `election-engine/monitoring.js`: validated month selection, direct non-creating monthly reads, snapshot-to-participation resolution and no-store protected response.
- `server.js`: existing monitoring mount and Administration route composition.
- `private-pages/suivi-du-vote.html`, `suivi-du-vote.js`: month selector/history states and safe rendering.
- `employee-directory/service.js` and `employee-directory/firestore-store.js`: canonical source snapshot at election creation; do not use the mutable current directory as historical truth.
- `test/election-monitoring.test.js` plus election-engine tests: current/history routing, privacy, fail-closed behavior and unchanged voting flow.

**Implementation order**

1. Approve the identity-history fields, manager access, retention and missing-snapshot behavior.
2. Add the minimal immutable election-time roster to newly created elections without changing voter verification or candidate selection.
3. Add a read-only, session-authorized `YYYY-MM` management query, constrained to the server-configured site/environment. Validate the requested month and stored document fields. Do not call `ElectionService.current()` or `ensureElection()` from it.
4. Resolve names only from that month's immutable roster and participation IDs. Keep ballot documents unread and return aggregate-only output when the roster is missing or inconsistent.
5. Add the month selector and explicit loading, missing-election, aggregate-only, closed-window and unavailable states to Administration.
6. Test wrong UID/site, invalid month, missing election versus zero participation, both namespaces, staff removed/renamed after election, duplicate/malformed roster entries, mismatched counts, no writes, no current-month initialization, no ballot reads, and no sensitive response fields.
7. Use fixtures/emulator data for development verification. Separately verify the production Railway/Firebase binding and obtain rollout approval before enabling the feature against production.

## L. Migration/backfill, decision and zero-change confirmation

**Migration:** no migration is needed for new elections if the snapshot is added to the existing first-creation path. The proposed history reader must tolerate older documents that lack the new snapshot and return aggregate data with named status `UNAVAILABLE`.

**September backfill:** not currently justified or safe. The source schema provides voter IDs and groups but not a complete historical display-name/department roster. The current directory can at most establish today's directory details for identities that still exist; it cannot prove names, departments or eligibility labels as of September. Candidate snapshots could recover display data for only an overlapping subset. A complete backfill is possible only if an independently verified, contemporaneous September directory/electorate export exists and can be matched without guessing under an approved read-only procedure. No such source was verified here. Do not fabricate or silently backfill September names.

**Conclusion:** `SAFE TO IMPLEMENT MONTHLY HISTORY: YES` — a forward-only, code/test implementation using immutable election-time roster snapshots and a non-creating month-scoped management reader can be built without reading or modifying production election data and without changing the existing ballot flow. This does **not** authorize a production rollout, September backfill, live history display, or any result recovery. Those require separate verification and approval.

**Changes made:** this report document only. **Application code:** none. **Firestore reads or writes:** none. **Rules, migrations, snapshots, election state:** none. **Deployment:** none. **Commit or push:** none. The repository was already on local `main` ahead of `origin/main` by six commits before this report; this audit created no commit and pushed nothing.