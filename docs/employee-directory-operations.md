# Secure employee directory operations

Google Sheets is authoritative for employee-directory data. Firestore stores only the latest fully validated operational snapshot and non-reversible Salaire-ID verifier material. Planning sheets are not used.

## Required secure configuration

Set these through Replit Secrets; never commit values:

- `FIREBASE_SERVICE_ACCOUNT`: service-account JSON used by Firebase Admin and read-only Google Sheets access.
- `EMPLOYEE_DIRECTORY_SHEET_ID`: dedicated spreadsheet ID.
- `EMPLOYEE_DIRECTORY_PEPPER`: high-entropy secret used to create keyed, non-reversible Salaire-ID verifiers.
- `MOLARD_ADMIN_FIREBASE_UID`: the one Firebase Authentication UID explicitly allowed to administer the Molard site.

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
- The explicitly configured Molard administrator may call `POST /api/v1/management/employee-directory/refresh`.
- Temporary Google errors or invalid rows never replace the last valid snapshot.
- Public candidates return `503 DIRECTORY_UNAVAILABLE` until a valid snapshot exists.

Management routes require a Firebase ID token whose UID exactly matches `MOLARD_ADMIN_FIREBASE_UID` and whose `siteId` claim exactly matches `EMPLOYEE_DIRECTORY_SITE_ID`. Roles, directory membership, Salaire-ID knowledge, and permissions from other applications do not grant access:

- `GET /api/v1/management/employee-directory/status`
- `POST /api/v1/management/employee-directory/refresh`
- `GET /api/v1/management/employee-photos`
- `PUT /api/v1/management/employee-photos/:employeeId`
- `DELETE /api/v1/management/employee-photos/:employeeId`

Status reports timestamps, health, counts, and redacted issue codes/row numbers. It contains no Salaire-ID or verifier.

## Managed employee portraits

The public homepage links discreetly to `/gestion-photos-login.html`. After Firebase email/password sign-in, the server verifies the ID token, its exact allowlisted UID, and the matching Molard `siteId` claim before issuing an eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` session. It then opens the protected `/administration` landing page, whose only initial option is `📷 Photos collaborateurs`. The landing page and both photo-page URL forms require a current, non-revoked server session before any private HTML is served. Missing, expired, revoked, wrong-site, and unauthorized sessions redirect to login. The private page files are outside every public static mount. Public voting grants, ordinary employees, managers, generic administrators, directory members, and Salaire-ID values cannot create a session, open private pages, or call management operations.

Uploads use the selected file as the raw request body. The server accepts JPEG, PNG, and WebP up to 8 MiB, verifies the decoded format against the declared MIME type, rejects malformed or spoofed files, and limits decoded dimensions to 12,000 × 12,000 pixels. HEIC/HEIF is explicitly rejected with localized guidance. Sharp applies EXIF orientation, crops to a 512 × 512 square, re-encodes to quality-82 WebP, and does not copy EXIF/GPS metadata. Original uploads are not retained.

The private object path is deterministic: `employee-photos/{siteId}/{employeeId}/portrait.webp`. Firestore metadata is stored below `employeePhotoSites/{siteId}/photos/{employeeId}` and contains only schema version, object path, numeric version, and update time. A deletion replaces active metadata with a private tombstone containing only schema version, the last version, and deletion time; this keeps versions monotonic so a later upload never reuses an immutable URL. Metadata contains no name, Salaire-ID, email, role, credential, or eligibility data. Both Firestore and Storage rules deny direct browser access; Express and the Admin SDK are the only access path.

The same-origin image route uses a ten-minute HMAC-signed reference containing version, expiry, and signature. Guessing an Employee ID/version, changing any query value, or reusing an expired reference returns 404. Election snapshots retain the validated legacy/fallback reference, while authorized candidate serialization dynamically prefers an active managed URL. Replacements increment the version query so a browser requests the new portrait despite immutable private caching. Deletion removes the object and active reference, retains only the private version tombstone, and immediately restores legacy/fallback behavior without editing the Google Sheet or any eligibility fields. Inactive employees may retain managed portraits, but their managed image cannot be enumerated without a fresh signed reference issued to authorized management.

### One-time non-production administrator setup

Perform this only in the development Firebase project. Do not put an email, password, UID, or credential in source code, HTML, documentation, logs, or chat.

1. Enable Firebase Authentication email/password sign-in.
2. In the Firebase console, create one separate Authentication identity for Andrea. Use a unique temporary password delivered through a secure channel and require it to be changed before regular use. Do not create employee accounts.
3. Using a trusted server-side Admin SDK script or Firebase administrative tooling, set only the required custom claim on that identity: `{ "siteId": "<the exact EMPLOYEE_DIRECTORY_SITE_ID value>" }`. A `manager` or `admin` role is neither required nor accepted as authorization.
4. Copy the identity's UID from Firebase Authentication and store it as the Replit Secret `MOLARD_ADMIN_FIREBASE_UID`. Never store it in committed configuration. Restart Preview so the server reads the secret. If this secret, the site ID, or Firebase Admin is absent, Administration intentionally fails closed.
5. Validate in Preview: open the public homepage, select `🔐 Administration`, sign in, confirm `/administration` appears, then open `📷 Photos collaborateurs`. Confirm a different Firebase identity and the same UID with a wrong-site claim are denied. Confirm direct private URLs redirect to login and logout removes both the browser login and server cookie.
6. Revoke access by revoking refresh tokens or disabling/deleting the Firebase identity, and remove `MOLARD_ADMIN_FIREBASE_UID` from Secrets. The server verifies revocation on every session-backed page request and every ID-token-backed management API request.

Adding any future administrator is outside the current design. It requires an explicit reviewed change to the single-identity server configuration contract; do not broaden access through roles or directory membership.

Enable Cloud Storage for the configured Firebase project and bucket. Deploy `firestore.rules` and `storage.rules` before any future production use. Keep Preview on development data and do not use real employee imagery for verification.

The safe candidate endpoint is:

- `GET /api/v1/public/election/candidates` with a valid short-lived voting authorization

There is no unauthenticated full-directory endpoint. The voting candidate response contains only the current election’s eligible candidates for that voter. Each candidate contains only an internal selection ID required to submit the ballot, display name, job title, and safe photo URL. Category grouping is represented by the response structure rather than additional employee fields. It never includes inactive/non-candidate employees or management photo metadata.

## Election integration

The monthly election engine consumes the immutable last-known-good snapshot. It never reads planning sheets and never writes election data back to Google Sheets. Election creation copies only stable employee IDs and the safe fields needed for voter/candidate eligibility; each month remains independent.

## Tests and next boundary

Run `npm test` for the directory, election, browser, and photo suites. Photo coverage includes sole-UID/site authorization, generic-role denial, fail-closed configuration, private-page redirects, logout, privacy-safe payloads, traversal-safe employee IDs, directory membership, image policies, localization, and responsive UI.

Firestore and Storage rule enforcement runs with `npm run test:firestore-rules`, including unauthenticated, manager, and cross-site browser denial. Deploy both rule files together.

## Preview verification — 21 September 2026

- Flow: homepage → `/gestion-photos-login.html` → `/administration` → `/gestion-photos-collaborateurs`
- Environment: Preview/development only; no production deployment
- A disposable authorized Firebase identity completed session creation, the private Administration landing page, and photo-page navigation.
- Invalid credentials, a different identity with an `admin` role, and the allowlisted UID carrying a wrong-site claim were denied.
- Logout returned a clearing `__session` cookie. Revoking refresh tokens caused the existing private-page session to redirect to login without serving private HTML.
- Both disposable Firebase identities were deleted immediately after verification. No test credential or allowlist value was retained.
- Without `MOLARD_ADMIN_FIREBASE_UID`, Preview returned `503`/`404` for private pages/session creation and served no private content, confirming fail-closed configuration.
- The public homepage, dedicated login, and voting page remained available without authentication. The login layout was inspected at 390 × 844 and desktop size.
- Automated results: `npm test` passed 58/58, including sole-UID, tenant, redirect, logout, revocation response, mobile, public, and voting regression coverage.

Production remains intentionally unchanged. Before production use, complete Andrea's Firebase Authentication account/custom-claim setup and deploy both rules files described above. The recommended next product task is the already-planned protected manager workflow for closing votes and confirming winners.