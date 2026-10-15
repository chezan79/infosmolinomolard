# Regression and dependency review

No production credentials, Firebase records or deployed settings were changed
for this work. Tests use isolated synthetic stores and sessions.

## Failed-test classification

- Homepage visibility and localized navigation: real regression, not obsolete
  expectations. Two unclosed/malformed anchors, a legacy vote URL and missing
  translation markers broke the stable card contract. Restore valid independent
  anchors, the extensionless voting URL and the existing locale translation
  markers. Do not introduce dates, login state or election-state gating.
- Public winners browser test: obsolete dynamic-page DOM expectations, plus a
  real broken legacy route. The approved static September announcement remains
  unchanged and independent of the publication API. Redirect the removed public
  route to that announcement. Exercise the actual shared route in the browser
  test, published API privacy/ties, authenticated administration, protected
  September hold and canonical August recovery. Do not restore a replaced design
  solely to satisfy a stale loading-panel assertion. Static announcement visual
  tests and dynamic client unit tests remain in the suite.

## Main Node application: npm production graph

Before remediation: 1 critical, 1 high, 9 moderate advisories.

- proxy-addr: fixed with compatible 2.0.8 under Express 4's declared range.
  The advisory concerns subnet trust handling and IPv4-mapped IPv6. The current
  production application configures a numeric single proxy hop, not vulnerable
  subnet-list matching. Patch anyway; do not relax host, protocol or owner checks.
- sharp: updated from 0.35.4 to 0.35.5 (same minor, supported Node 20 engine).
  The SVG/librsvg advisory must not be dismissed merely because permitted upload
  formats are JPEG/PNG/WebP: sharp inspects input before the metadata format
  check. Owner authorization reduces exposure but is not a decoder mitigation.
- Nine moderate npm findings remain: one uuid bounds-check advisory propagated
  through exceljs and Google dependencies, not nine independent exploits.
  Audited callers use uuid v4 with no caller-supplied destination buffer
  (ExcelJS conditional-format IDs; Google multipart boundaries and request IDs).
  The reported v3/v5/v6 buffer interface is not reachable through those callers.
  This is a reachability assessment, not a claim that old uuid is patched.
  No forced uuid major override or Firebase Admin downgrade is applied.

Clean production installation must have a valid dependency tree; test it in the
isolated production-install fixture, not the pre-existing mixed npm/pnpm cache.
The pnpm lock is regenerated from the updated application manifest/lock too.

## Repository-wide scope

The separate functions/package-lock.json still contains older versions of
proxy-addr, fast-xml-parser, protobufjs, websocket-driver and signing libraries.
The design sandbox has its own dependency tree. They are separate from the root
npm production installation; root npm audit must not be presented as a clean bill
of health for every project directory. The functions manifest targets Node 22
and a different Firebase Admin major. Updating/deploying those Cloud Functions
is not silently included in the Railway runtime patch. Their deployed state and
reachability were not checked. Unresolved critical/high repository findings
must remain explicit release-review items.

## Static findings

- firebase-config.js: example/placeholder configurations and legacy snippets,
  not a disclosed server credential. The Firebase initialization rule matching
  an example is a false positive for a leaked secret. Do not rotate real keys
  or move credentials because of this example-only match.
- public/office.html: a Firebase Web API key intentionally supplied to the
  browser. Not a Firebase Admin private key and not authorization by itself.
  This file is served by /public, so it is not an unreachable/dead-file finding.
  Restriction status for the real key (allowed APIs/application restrictions),
  deployed Firebase rules and IAM were not independently verified. Do not call
  this harmless without that qualification, and never print its value.

No diagnostic reveals private keys, service accounts, unexpected configuration
values, voter IDs or ballot choices. A successful binding diagnostic does not
validate Firebase permissions or historical result integrity.

## Final validation

- `npm test`: 170 passed, 0 failed, 0 skipped.
- Dedicated history and Firebase-runtime tests: 20 passed, 0 failed.
- `npm run build`: passed (the existing build is a Node syntax check).
- Clean production-only npm installation, valid `npm ls` dependency tree,
  installed Firebase Admin custom-token signing and route smoke test: passed
  inside the full suite, using temporary fixtures rather than production data.
- Three originally failing test groups: 14/14 focused checks passed.
- Main `npm audit --omit=dev`: 0 critical, 0 high, 9 moderate.
- Repository-wide dependency scanner: 4 critical, 57 high, 29 moderate, 9 low;
  these are not equivalent to the root npm production advisory counts. Older
  critical versions are present in the separate functions lock. Scanners also
  differ in advisory/severity assignment (including uuid) and aggregate scopes.
- Static scan: two findings reviewed as described above, not silently removed.
- Automated privacy scanner: unavailable due to `HOUNDDOG_SCHEMA_MISMATCH`;
  do not report this check as passed. Privacy/authorization fixture tests pass.
- Safe Preview HTTP checks: health 200; legacy winners redirect 302; history,
  diagnostic and result-management APIs return 401 without an owner session.
- Preview renders; authenticated UI verification uses synthetic owner sessions,
  not a real production login.

The first complete run after installing patches exposed the internal-registry
lockfile portability problem. That problem was fixed without changing package
versions or integrity hashes, then the complete suite passed.

This work resolves the three regressions but is not a blanket publication
approval: repository-wide security findings, Web key restriction verification,
and official live Firebase runtime attestation remain open. No push, deployment,
production configuration change, ballot read, or production election-data
modification was performed.
