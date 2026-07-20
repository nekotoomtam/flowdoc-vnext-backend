# PDF Export REALDOC Form/API Parity

Status: `PDF-EXPORT-REALDOC-E.5.9` accepted for the optional local Backend
runtime. Production remains NO-GO.

## Admission Lanes

The shared local admission service now accepts two source-neutral inputs:

- `canonical-data` from the generated Editor Form, using lane `direct` and
  mapping `not-required`; and
- `adapted-json` from an API-shaped caller, using lane `adapted` and mapping
  `executed` through an allowlisted exact profile.

Both lanes authorize the exact Structure owner, allocate their own revision-0
generation instance, verify admitted assets, call the same Core runtime
validator, and retain canonical values only in the protected Backend record.
Draft admission reuses this bridge only after its immutable snapshot has been
validated and continues to report `publishedApiParity: false`.

## Identity Contract

Public receipts now include `canonicalContentFingerprint`. Equal values prove
that direct and adapted lanes reached the same canonical data, collections, and
media content. `canonicalInputFingerprint` remains instance-bound and differs
between the two requests. Backend never substitutes the content fingerprint
for idempotency, replay, protected-record integrity, operation lookup, or
artifact identity.

Protected-record reads recompute and verify both fingerprints before export.
A mismatch fails closed.

## Retained Evidence

`npm run pdf-export-realdoc-e59:verify` prepares the trusted 69C section 2.1
input once, submits direct Form-shaped and adapted API-shaped admissions, runs
both through exact local PDF export, and records content-free evidence.

The accepted fixture reports:

- 749,929 adapted UTF-8 bytes, 10 requirements, and 7 screenshots;
- direct: `not-required`, `run-valid`, 0 errors, and 0 warnings;
- adapted: `executed`, `run-valid`, 0 errors, and 3 warnings;
- shared canonical content fingerprint
  `sha256:f21638952df9a5405196b2b797c882858fad79c8ee1e8d9d2179ef8bc868e1ad`;
  and
- two 10-page, 1,417,544-byte artifacts.

The artifact SHA-256 values differ. That is expected because direct and adapted
requests are distinct generation instances. The evidence asserts content
parity and explicitly does not assert cross-instance PDF byte parity.

## Privacy Boundary

The retained fixture contains counts, fingerprints, statuses, diagnostics, and
artifact facts only. It contains no raw adapted payload, mapped values,
requirement text, screenshot captions, executable mapper, credential, or local
source path. Public Editor responses remain content-free.

## HTTP Composition

E.5.9 changes only the optional loopback real-document composition. It does not
mount DocGen or Preview routes in the default application server. Existing
authenticated status, cancel, and verified-download routes are reused without
widening their public schemas.

## Explicitly Not Changed

- no durable Published Structure, Draft snapshot, or protected canonical
  repository;
- no fresh-process generation reconstruction or E.6 restart acceptance;
- no SQLite scheduler optimization or new 240-page measurement;
- no Module 2 or complete 200-page generation;
- no hosted provider, tenancy, deployment, retention, SLO, or cost decision;
  and
- no production activation.

## Current Status

`PDF-EXPORT-REALDOC-E.6.1` is now accepted in
`docs/PDF_EXPORT_REALDOC_DURABLE_ADMISSION.md`. It proves durable protected
admission and fresh-process replay. E.6.2 operation/lifecycle/artifact
reconstruction and E.6.3 Editor reconnect are now accepted in
`docs/PDF_EXPORT_REALDOC_DURABLE_LIFECYCLE.md`. Production remains NO-GO.
