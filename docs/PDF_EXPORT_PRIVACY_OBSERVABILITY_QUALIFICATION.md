# PDF Export Privacy-Safe Observability And Workflow Qualification

Status: `PDF-EXPORT-V-F` observability and end-to-end workflow candidate
accepted. Production event delivery/retention, worker hosting, storage-provider
selection, authenticated routes, concrete renderer promotion, deployment, and
activation remain blocked.

## Boundary

V-F composes the accepted V-B through V-E candidates without adding an HTTP
route or automatic queue loop. The runner checks durable terminal workflow
state first, then retained V-E persistence and physical bytes, before it can
invoke the renderer. This ordering makes restart behavior explicit:

1. admit or exactly replay the immutable V-B operation;
2. initialize, claim, and advance the V-C lifecycle;
3. run the qualified V-D adapter only when verified V-E bytes are absent;
4. persist and physically revalidate bytes through V-E; and
5. atomically commit the terminal V-F event chain and workflow completion.

The terminal V-F completion becomes the end-to-end replay owner after V-E
persistence. It retains the exact V-E receipt fingerprint and live V-C
lifecycle fingerprint. V-F intentionally does not rewrite the V-C lifecycle
schema after persistence; its completion contract records that the retained
lifecycle trace has been superseded by terminal workflow evidence.

## Privacy-Safe Events

The event schema accepts only the Core vocabulary:

- `pdf-export.accepted`;
- `pdf-export.deduplicated`;
- `pdf-export.render-started`;
- `pdf-export.render-completed`;
- `pdf-export.persist-started`;
- `pdf-export.persist-completed`;
- `pdf-export.cancelled`;
- `pdf-export.deadline-exceeded`;
- `pdf-export.resource-rejected`; and
- `pdf-export.failed`.

Each event has a closed root and closed dimensions object. The allowed
dimensions are export request, artifact, document/revision, request and source
contract fingerprints, renderer and measurement profiles, attempt, stop
reason, page count, byte length, and duration. Tenant/principal values are
replaced by a one-way scope fingerprint in event payloads.

Source text, PDF bytes, raw tenant/principal values, free-form messages, and
arbitrary payloads are not representable. Every event fingerprints its exact
facts and the previous event, producing an append-only ordered chain.

## Atomic Terminal Journal

The in-memory and SQLite repositories retain one terminal completion per
operation. SQLite inserts the complete event batch and workflow completion in
one `BEGIN IMMEDIATE` transaction. Faults after the event batch or before
commit leave neither events nor completion. An after-commit fault reopens as
the exact terminal replay.

The retained batch is a terminal observability projection, not a real-time
telemetry stream. Provider-specific export, retention, access policy,
aggregation, alerting, and deletion remain production decisions.

## Restart And Fault Evidence

The full SQLite qualification closes and reopens independent V-B, V-C, V-E,
and V-F repositories around faults after operation admission, lifecycle
readiness, renderer completion, and artifact persistence. Recovery proves:

- no render occurred before the operation/lifecycle fault points;
- a fault after render reruns the renderer because no durable bytes exist;
- a fault after persistence reuses verified retained bytes without rerender;
- terminal completion survives another complete repository restart; and
- terminal replay performs neither renderer nor persistence work.

The V-D before-persist checkpoint now first replays the exact revision bound to
its original transition id. This preserves durable transition identity when a
crash occurs after renderer completion and the live lifecycle head has already
advanced.

Primary files:

- `src/pdfExport/pdfExportObservability.ts`;
- `src/pdfExport/pdfExportObservabilitySqliteRepository.ts`;
- `src/pdfExport/pdfExportWorkflow.ts`;
- `src/tests/pdfExportObservability.test.ts`;
- `src/tests/pdfExportObservabilitySqlite.test.ts`;
- `src/tests/pdfExportWorkflow.test.ts`; and
- `src/tests/pdfExportWorkflowSqliteQualification.test.ts`.

## Remaining Boundary

V-F does not authenticate or authorize a principal, expose request/status/
cancel/download routes, start a queue consumer, select a production event or
byte-storage provider, promote a concrete renderer, define deployment
retention policy, or enable a production flag.

Follow-up `PDF-EXPORT-V-G` now adds the unmounted authenticated route candidate
and records a NO-GO activation review in
`docs/PDF_EXPORT_AUTHENTICATED_ROUTE_ACTIVATION_REVIEW.md`. Concrete renderer,
production storage/event providers, worker hosting, identity policy, and
deployment remain blocked.
