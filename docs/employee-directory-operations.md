# Secure employee directory operations

Google Sheets is authoritative for employee-directory data. Firestore stores only the latest fully validated operational snapshot and non-reversible Salaire-ID verifier material. Planning sheets are not used.

## Required secure configuration

Set these through Replit Secrets; never commit values:

- `FIREBASE_SERVICE_ACCOUNT`: service-account JSON used by Firebase Admin and read-only Google Sheets access.
- `EMPLOYEE_DIRECTORY_SHEET_ID`: dedicated spreadsheet ID.
- `EMPLOYEE_DIRECTORY_PEPPER`: high-entropy secret used to create keyed, non-reversible Salaire-ID verifiers.

Set these non-secret environment variables:

- `EMPLOYEE_DIRECTORY_SITE_ID`: fixed site/tenant ID, for example the Molard site.
- `EMPLOYEE_DIRECTORY_SHEET_RANGE`: default `Employees!A:J`.
- `EMPLOYEE_DIRECTORY_REFRESH_MS`: default 15 minutes.
- `EMPLOYEE_DIRECTORY_TIMEOUT_MS`: default 10 seconds.
- `EMPLOYEE_DIRECTORY_PHOTO_ORIGINS`: comma-separated allowlist of HTTPS origins.
- `storageBucket` (or `FIREBASE_STORAGE_BUCKET`): Firebase Storage bucket used for managed portraits.
- `EMPLOYEE_PHOTO_URL_SECRET`: optional dedicated HMAC secret of at least 32 characters for short-lived portrait URLs. If omitted, the server uses `ELECTION_GRANT_SECRET`, then `SESSION_SECRET`.

Share the dedicated spreadsheet with the service account email as **Viewer** only. Enable the Google Sheets API for its Google Cloud project. No browser receives the spreadsheet ID, service-account credential, or source URL.

The configured range is limited to ten columns, responses are capped at 1 MiB, and validated snapshots are capped at 500 employees so the Firestore document remains bounded.

## Expected columns

Exact required headers:

| Column | Rules |
| --- | --- |
| `Employee ID` | Stable, unique, 2–64 letters/numbers/`_`/`-`; never reuse |
| `Salaire-ID` | Unique, 4–64 letters/numbers/`_`/`-`; private |
| `Name` | Required display name |
| `Department` | `Cuisine`, `Pizzeria`, `Plonge`, or `Service` |
| `Active` | `true/false`, `yes/no`, `oui/non`, `si/no`, or `1/0` |
| `Can Vote` | Same boolean rules; independent from candidacy |
| `Can Be Elected` | Same boolean rules; independent from voting |

Optional headers:

| Column | Rules |
| --- | --- |
| `Job Title` | Missing value creates a warning |
| `Photo URL` | Root-relative path or HTTPS URL on the configured origin allowlist |
| `Site ID` | If present, every row must match the configured site |

Cuisine, Pizzeria, and Plonge derive voting group `CUISINE`. Service derives `SERVICE`. Unknown departments reject the complete refresh.

## Validation and privacy

The complete update is rejected for duplicate or malformed employee IDs/Salaire-IDs, missing names, unknown departments, invalid flags, site mismatch, or missing groups. Missing job titles and photos are warnings. Missing/unsafe photos use `/assets/avatar-neutral.svg`.

Raw Salaire-ID values are transformed in memory into versioned HMAC-SHA-256 verifiers with the secret pepper. Raw values are never persisted, returned, logged, or used as candidate/ballot identifiers. Candidate responses contain only employee ID, name, job title, department, voting group, and safe photo reference.

`firestore.rules` denies all browser access to `employeeDirectorySnapshots`; only the server-side Firebase Admin SDK may read or write it.

## Refresh and recovery

- On startup, the service loads the last valid Firestore snapshot, then attempts Google refresh.
- It refreshes on the configured interval. A Firestore-backed lease serializes the Google read and snapshot commit across server instances; each committed snapshot receives a monotonic generation.
- Managers may call `POST /api/v1/management/employee-directory/refresh`.
- Temporary Google errors or invalid rows never replace the last valid snapshot.
- Public candidates return `503 DIRECTORY_UNAVAILABLE` until a valid snapshot exists.

Management routes require a Firebase ID token with matching `siteId` and role `manager` or `admin`:

- `GET /api/v1/management/employee-directory/status`
- `POST /api/v1/management/employee-directory/refresh`
- `GET /api/v1/management/employee-photos`
- `PUT /api/v1/management/employee-photos/:employeeId`
- `DELETE /api/v1/management/employee-photos/:employeeId`

Status reports timestamps, health, counts, and redacted issue codes/row numbers. It contains no Salaire-ID or verifier.

## Managed employee portraits

The private sign-in entry is `/gestion-photos-login.html`; it is intentionally absent from all public navigation. After Firebase email/password sign-in, the server verifies the ID token, matching `siteId`, and `manager` or `admin` role before issuing an eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` management session. Both `/gestion-photos-collaborateurs` and the direct `.html` form require that server-verified session before the page file is served. The private page file is outside every public static mount; the server exposes only an explicit allowlist of public root assets, preventing encoded filename, repeated-slash, and dot-segment bypasses. Knowing either URL is insufficient. Public voting grants and ordinary employee accounts cannot create a management session, open the page, or call management operations.

Uploads use the selected file as the raw request body. The server accepts JPEG, PNG, and WebP up to 8 MiB, verifies the decoded format against the declared MIME type, rejects malformed or spoofed files, and limits decoded dimensions to 12,000 × 12,000 pixels. HEIC/HEIF is explicitly rejected with localized guidance. Sharp applies EXIF orientation, crops to a 512 × 512 square, re-encodes to quality-82 WebP, and does not copy EXIF/GPS metadata. Original uploads are not retained.

The private object path is deterministic: `employee-photos/{siteId}/{employeeId}/portrait.webp`. Firestore metadata is stored below `employeePhotoSites/{siteId}/photos/{employeeId}` and contains only schema version, object path, numeric version, and update time. A deletion replaces active metadata with a private tombstone containing only schema version, the last version, and deletion time; this keeps versions monotonic so a later upload never reuses an immutable URL. Metadata contains no name, Salaire-ID, email, role, credential, or eligibility data. Both Firestore and Storage rules deny direct browser access; Express and the Admin SDK are the only access path.

The same-origin image route uses a ten-minute HMAC-signed reference containing version, expiry, and signature. Guessing an Employee ID/version, changing any query value, or reusing an expired reference returns 404. Election snapshots retain the validated legacy/fallback reference, while authorized candidate serialization dynamically prefers an active managed URL. Replacements increment the version query so a browser requests the new portrait despite immutable private caching. Deletion removes the object and active reference, retains only the private version tombstone, and immediately restores legacy/fallback behavior without editing the Google Sheet or any eligibility fields. Inactive employees may retain managed portraits, but their managed image cannot be enumerated without a fresh signed reference issued to authorized management.

Firebase setup required outside the codebase:

1. Enable Firebase Authentication email/password sign-in.
2. Create manager accounts and assign server-verified `siteId` plus `manager` or `admin` custom claims.
3. Enable Cloud Storage for the configured Firebase project and bucket.
4. Deploy `firestore.rules` and `storage.rules` before any production use.
5. Keep Preview on development data and do not use real employee imagery for verification.

The safe candidate endpoint is:

- `GET /api/v1/public/election/candidates` with a valid short-lived voting authorization

There is no unauthenticated full-directory endpoint. The voting candidate response contains only the current election’s eligible candidates for that voter. Each candidate contains only an internal selection ID required to submit the ballot, display name, job title, and safe photo URL. Category grouping is represented by the response structure rather than additional employee fields. It never includes inactive/non-candidate employees or management photo metadata.

## Election integration

The monthly election engine consumes the immutable last-known-good snapshot. It never reads planning sheets and never writes election data back to Google Sheets. Election creation copies only stable employee IDs and the safe fields needed for voter/candidate eligibility; each month remains independent.

## Tests and next boundary

Run `npm test` for the directory, election, browser, and photo suites. Photo coverage includes manager/site authorization, privacy-safe payloads, traversal-safe employee IDs, directory membership, supported/unsupported/spoofed/corrupt files, byte and dimension policies, metadata removal, replacement versioning, deletion fallback, inactive retention, localization, and responsive UI.

Firestore and Storage rule enforcement runs with `npm run test:firestore-rules`, including unauthenticated, manager, and cross-site browser denial. Deploy both rule files together.

## Preview verification — 21 September 2026

- Route: `/gestion-photos-collaborateurs`
- Environment: Preview/development only; no production deployment
- Directory state before and after cleanup: 53 total, 0 managed portraits, 53 legacy/fallback portraits
- Disposable flow: JPEG upload passed; processed WebP serving passed; candidate payload precedence passed; deletion restored legacy/fallback behavior; PNG re-upload used a higher non-reused version; temporary object, active metadata, and test identity were removed
- Privacy check: no Salaire-ID, verifier, site claim, or voting eligibility field appeared in the candidate payload
- Automated results: `npm test` passed 57/57; `npm run test:firestore-rules` passed 3/3
- Preview access checks: both management page URLs returned 401 without a server session; manager/admin sessions and APIs returned 200; employee and voting credentials were rejected; the removed full-directory endpoint returned 404
- Static bypass checks: encoded filename characters, encoded extensions, repeated slashes, dot segments, and the private file path all returned 404 without exposing protected HTML
- Managed portrait checks: a fresh signed URL returned 200, while guessed and tampered portrait URLs returned 404; management storage paths and metadata were not returned
- The private login page and Firebase client configuration returned HTTP 200; the running server reported a healthy 53-row directory

Production remains intentionally unchanged. Before production use, complete the Firebase Authentication account/custom-claim setup and deploy both rules files described above. The recommended next product task is the already-planned protected manager workflow for closing votes and confirming winners.