# Security Hardening Report

Date: 2026-09-22

## Scope and constraints

This hardening pass addressed dependency vulnerabilities, privacy-safe logging, repository hygiene, and secret scanning before publication. It did not push or merge to GitHub, deploy production, modify production data, start a Railway migration, cast a real employee vote, or change election dates, eligibility, ballot rules, result visibility, Firebase authorization, Administration authorization, management sessions, or employee-photo behavior.

## 1. Vulnerabilities before remediation

The pre-publish OSV-based scan reported 8 critical, 73 high, 55 moderate, and 14 low package findings. A reproducible `npm audit` baseline on the installed dependency tree reported 5 critical, 7 high, 13 moderate, and 1 low vulnerability.

The critical/high dependency paths included:

- `firebase-admin` → Google Cloud Storage → `fast-xml-parser`
- `firebase-admin` → Firestore/Google GAX → `@grpc/grpc-js` and `protobufjs`
- `firebase-admin` / Google authentication → `form-data`, `jws`, and `uuid`
- test/browser Firebase SDK → `websocket-driver`, `@grpc/grpc-js`, and `protobufjs`
- Express → `body-parser`, `path-to-regexp`, and `qs`
- direct `xlsx@0.18.5`
- direct but unused npm `jspdf` and `jspdf-autotable`

The Firebase Admin, Firestore, Storage, authentication, Express, and server-side spreadsheet paths are production reachable. The npm Firebase browser SDK, WebSocket client, and Firebase rules test library are exercised by tests and are not loaded by the Express production server. The vulnerable npm jsPDF packages were unused; browser pages loaded jsPDF separately from a CDN.

## 2. Packages upgraded

Direct compatible upgrades:

- `cors`: 2.8.5 → 2.8.6
- `express`: 4.18.2 → 4.22.3
- `firebase`: 12.4.0 → 12.19.0
- `firebase-admin`: 13.5.0 → 13.10.0
- `google-auth-library`: 10.5.0 → 10.9.1

Safe transitive versions are enforced for:

- `form-data` 2.5.6
- Google GAX → `@grpc/grpc-js` 1.14.5
- `protobufjs` 7.6.5
- `websocket-driver` 0.7.5

Browser-only libraries were updated to SheetJS 0.20.3 and jsPDF 4.2.1. Both final CDN resources returned HTTP 200 with JavaScript content.

## 3. Packages removed and replaced

Removed:

- `xlsx@0.18.5`
- unused npm `jspdf`
- unused npm `jspdf-autotable`

The server-side XLSX export now uses `exceljs@4.4.0`. The replacement preserves the XLSX response format, bounds rows and columns, keeps untrusted formula-looking text as strings, and sanitizes download filenames. An endpoint smoke test returned HTTP 200 and a valid Microsoft Excel 2007+ archive.

## 4. Major-version changes

- SheetJS was replaced server-side rather than suppressed because the maintained fixed Community Edition is not distributed through normal npm releases.
- Browser jsPDF moved from 2.5.1 to 4.2.1 because current advisories require a fixed major release. Existing PDF-generation calls continue to use the supported UMD `window.jspdf.jsPDF` API.
- No authentication-critical package is forced outside its declared semver range. Attempted broad `uuid` and JWS overrides were rejected during independent review; current Firebase Admin uses its supported `jsonwebtoken@9.0.3` → `jws@4.0.1` dependency path.

## 5. Vulnerabilities after remediation

The final current-tree `npm audit` reports:

- critical: 0
- high: 0
- moderate: 9
- low: 0
- total: 9

`npm ls` confirms that the fixed critical/high transitive versions are installed without invalid dependency relationships. The remaining npm findings all trace to `uuid@8.3.2` or `uuid@9.0.1` through ExcelJS and the current Firebase Admin Google Cloud clients.

The `uuid` advisory concerns the optional caller-supplied output-buffer path in UUID v3/v5/v6. Infos Molino Molard does not call those UUID APIs, supply output buffers, or expose UUID generation parameters to users; ExcelJS and the Google clients use their own internal ID generation. Forcing `uuid@11` would violate those packages' declared major-version ranges in authentication-critical code, so the reviewed safe outcome is to retain the upstream-supported versions and track their parent-package upgrades. The finding is not reachable through current application inputs.

A separately invoked centralized dependency scanner returned stale package versions from the pre-remediation tree, including `@grpc/grpc-js@1.14.0`, `protobufjs@7.5.4`, and `websocket-driver@0.7.4`, which are absent from the final lockfile. Those stale records were not treated as current-tree findings.

The static scanner still identifies:

- placeholder Firebase browser configuration in `firebase-config.js`
- the public Firebase web API key in `public/office.html`

Neither is a Firebase Admin credential, service-account key, private key, token, password, or server secret. Firebase web configuration is intentionally public. The privacy/data-flow scanner reports no findings after remediation.

## 6. Logging and privacy changes

Server logs no longer include enrollment objects, employee names, user IDs, spreadsheet URLs or IDs, CSV contents, headers, row objects, training records, progress identifiers, or exception objects that may embed request data.

Logs retain bounded operational information such as event classification, storage backend, HTTP status, byte count, and aggregate row/count values.

## 7. Repository hygiene

The following internal validation artifacts are no longer tracked and are ignored locally:

- `.agents/memory/`
- `screenshots/`

Existing ignore rules already cover attached uploads, environment files, logs, npm debug output, and operating-system metadata. Generated Firebase emulator logs remain untracked.

## 8. Secret scan

The current tree and every commit between `origin/main` and the local `main` branch were scanned by filename and content pattern.

No tracked service-account JSON, private key, password, Firebase ID token, session secret, election secret, directory pepper, configured Administration UID value, Google service-account credential, Replit Secret value, environment file, or credential file was found.

Matches are limited to environment-variable names in code/documentation and deliberately fake test fixtures. The only high-entropy client match is the expected public Firebase web API key.

## 9. Regression and runtime verification

- Application suite: 67 passed, 0 failed
- Firestore/Storage rules suite: 3 passed, 0 failed
- Security-specific export/logging/dependency/authentication tests: 5 passed, 0 failed
- Homepage: HTTP 200
- Collaborateur du mois route: HTTP 200
- Administration without a session: HTTP 302
- XLSX export: HTTP 200, correct MIME type, valid XLSX archive
- Server workflow: running cleanly after restart

The tests cover the public homepage, static routing, localized Collaborateur du mois navigation, UPCOMING state, September 25 Europe/Zurich boundary, Salaire-ID privacy, candidate eligibility, self-vote prevention, one ballot per employee/month, Cuisine plus Service selection, required comments, hidden partial results, sole configured UID Administration authorization, management sessions, portrait list/upload/replace/delete and fallback behavior, Firestore and Storage rules, and logout/session invalidation. All election tests use isolated test stores; no real employee vote was submitted.

SECURITY HARDENING READY FOR REVIEW