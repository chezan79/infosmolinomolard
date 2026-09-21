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

Status reports timestamps, health, counts, and redacted issue codes/row numbers. It contains no Salaire-ID or verifier.

The safe candidate endpoint is:

- `GET /api/v1/employee-directory/candidates`

## Tests and next boundary

Run `npm test` for the directory suite and `npm run test:firestore-rules` for the Firestore emulator policy. Tests cover normalization, independent voter/candidate flags, duplicate and malformed rejection, safe serialization, last-known-good fallback, photo fallback, manager site isolation, directory denial, and compatibility for existing client collections.

The next task may implement rate-limited voter verification against the stored verifiers and then private ballot submission. It must not store votes, participation, comments, elections, or results in Google Sheets.