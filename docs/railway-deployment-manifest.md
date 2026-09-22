# Railway deployment manifest

## Runtime

- Service architecture: one Node/Express same-origin service.
- Node: `20.x`.
- Build: `npm run build`.
- Start: `npm start`.
- Network: `0.0.0.0:$PORT`.
- Liveness: `GET /healthz` (process-only, no dependency or data details).
- Readiness: `GET /readyz` (safe booleans only).
- Public routes: `/`, `/collaborateur-du-mois`, public assets and `/api/v1/public/*`.
- Protected routes: `/administration`, `/gestion-photos-collaborateurs`, and `/api/v1/management/*`.
- Firebase Hosting and `functions/` are not Railway entry points and must not be deployed as alternate public application paths.

## Railway variables

| Name | Classification | Production rule |
|---|---|---|
| `NODE_ENV` | required non-secret | `production` |
| `PORT` | Railway-provided non-secret | Valid TCP port |
| `APP_CANONICAL_ORIGIN` | required non-secret | Exactly `https://infosmolinomolard-production.up.railway.app`; no other Railway hostname, scheme, port, path, query, fragment, credentials, or wildcard-style value is approved |
| `ELECTION_DATA_ENVIRONMENT` | required non-secret | Exactly `production` |
| `ELECTION_TIME_ZONE` | required non-secret | Exactly `Europe/Zurich` |
| `ELECTION_TRUST_PROXY_HOPS` | required non-secret | Exactly `1` for the approved topology |
| `EMPLOYEE_DIRECTORY_SITE_ID` | required non-secret | Exactly `molard` |
| `EMPLOYEE_DIRECTORY_SHEET_RANGE` | required non-secret | Approved range |
| `EMPLOYEE_DIRECTORY_SHEET_ID` | required secret | Google Sheet identifier |
| `EMPLOYEE_DIRECTORY_PEPPER` | required secret | At least 32 characters |
| `ELECTION_GRANT_SECRET` | required secret | At least 32 characters |
| `SESSION_SECRET` | required secret | At least 32 characters |
| `EMPLOYEE_PHOTO_URL_SECRET` | optional secret | Dedicated photo URL signing secret; otherwise a required server secret is used |
| `MOLARD_ADMIN_FIREBASE_UID` | required secret | Sole approved administrator UID |
| `FIREBASE_SERVICE_ACCOUNT` | required secret | Server-only service-account JSON |
| `FIREBASE_STORAGE_BUCKET` | required non-secret | Durable portrait bucket |
| `FIREBASE_DATABASE_URL` | optional non-secret | Only if Realtime Database is used |
| `apiKey`, `appId`, `authDomain`, `projectId`, `storageBucket` | required public client configuration | Firebase web client identifiers; `storageBucket` must match `FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | optional public client configuration | Firebase web client identifier |
| `ELECTION_GRANT_TTL_MS` | optional non-secret | Positive grant lifetime |
| `EMPLOYEE_DIRECTORY_REFRESH_MS` | optional non-secret | Positive refresh interval |
| `EMPLOYEE_DIRECTORY_TIMEOUT_MS` | optional non-secret | Positive source timeout |
| `EMPLOYEE_DIRECTORY_PHOTO_ORIGINS` | optional non-secret | Approved exact legacy portrait origins; prefer empty |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST` | development-only | Forbidden in production |
| `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN` | Replit-only | Not used by Railway runtime |
| `STORAGE_BUCKET`, `UPLOAD_PASSWORD` | obsolete Functions-only | Forbidden as Railway application configuration |

The production election namespace is `electionSites/molard/dataEnvironments/production`. September 2026 must begin as a clean namespace. This preparation performs no production read, write, migration, deletion, election opening, or ballot creation.

`APP_CANONICAL_ORIGIN` remains authoritative for the production host and protocol checks and for same-origin protected mutations. Railway forwards through exactly one approved proxy hop. This exception does not enable CORS or a Railway hostname wildcard, and it does not change secure, HTTP-only, SameSite=Strict session cookies, CSRF checks, or administrator authorization.