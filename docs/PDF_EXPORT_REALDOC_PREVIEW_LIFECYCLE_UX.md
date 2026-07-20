# PDF Export REALDOC Preview Lifecycle UX

Status: `PDF-EXPORT-REALDOC-E.5.8` accepted for the optional local Backend
runtime. Production remains NO-GO.

## Existing Lifecycle Reuse

E.5.8 reuses the accepted authenticated request, status, cancel, and download
routes. Public operation states, cancellation result shape, idempotency
headers, artifact verification, and content-free receipt contracts are not
widened.

Editor now consumes the complete lifecycle for both Draft and Published
Preview. Status acceptance remains pinned to the admitted instance id and
revision. Retry uses the same key for an uncertain admission, operation
request, or cancellation and creates new keys only for a new terminal intent.

## Local Dispatch Window

The isolated 69C real-document runtime schedules its renderer in the same Node
process as the local HTTP listener. E.5.8 adds
`REALDOC_LOCAL_OPERATION_DISPATCH_DELAY_MS = 10_000` before that local worker
starts. This gives the 202 response and a pending cancellation command a
bounded observable window before the evidence renderer can occupy the process.

The delay is limited to `pdfExportRealdocE56Runtime.ts`, which is also reused by
the E.5.7 QA command. It does not change the default local composition,
production scheduler, route schema, or worker contract.

## Accepted Evidence

The real 749,929-byte 69C adapted input completed mapping and validation with 0
errors and 3 warnings. Browser-driven lifecycle QA accepted:

- pending operation cancellation to `cancelled`;
- a new generation after cancellation;
- Backend-unavailable admission failure and retry after restart;
- completed 10-page artifact status; and
- a verified download response with `application/pdf`, 1,417,544 bytes, and
  SHA-256
  `e2f2b3f5e6dd9cc28ecabb31032bb6caa0cdae8b1580baf2110f9dc9079f7713`.

The existing E.4 evidence remains the deeper cancellation, idempotent replay,
corruption, and verified-download contract proof. E.5.8 proves that the Editor
can drive those boundaries through the real-document local composition.

## Explicitly Not Changed

- no public route or response schema change;
- no default application-server mount;
- no durable Draft or protected generation repository;
- no Form admission or Form/API parity claim in E.5.8 itself;
- no SQLite scheduler change or new 240-page result;
- no Module 2 or complete 200-page export; and
- no production identity, tenancy, provider, deployment, or activation.

## Risks

The 10-second window is local harness coordination. It is not evidence of
production queue latency or cancellation SLOs. Because rendering remains in
the listener process, cancellation after dispatch can still wait for a render
checkpoint or event-loop availability.

The protected generation registry remains process-local. E.6 still owns exact
restart, reconstruction, failure, cancellation, and identity evidence through
all three repositories.

## Next Phase

`PDF-EXPORT-REALDOC-E.5.9` is now accepted in
`docs/PDF_EXPORT_REALDOC_FORM_API_PARITY.md`. Direct Form and adapted API lanes
share canonical content while retaining separate instance identities. E.6 now
owns full cross-repo lifecycle acceptance. Production remains NO-GO.
