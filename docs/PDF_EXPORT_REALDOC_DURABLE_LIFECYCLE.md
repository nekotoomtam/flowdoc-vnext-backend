# PDF Export REALDOC Durable Lifecycle

Status: `PDF-EXPORT-REALDOC-E.6.2` accepted for the optional local Backend
composition. Editor reconnect remains E.6.3. Production remains NO-GO.

## Composition

`createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1(...)` opens one
bounded local directory containing:

- protected DocGen admission in SQLite;
- PDF operation in SQLite;
- lifecycle head and transition receipts in SQLite;
- artifact projection metadata in SQLite;
- terminal completion and observability events in SQLite; and
- PDF bytes in the existing filesystem content-addressed store.

Each repository retains its existing strict parser, scoped identity, bounded
busy behavior, transaction, replay, and corruption policy. The composition
does not create a cross-database transaction and does not delete its root on
close. Recovery therefore uses the existing idempotent workflow checkpoints
rather than pretending all stores commit atomically.

Composition facts keep `defaultApplicationServerMounted: false` and
`productionBinding: false`.

## Restart Sequence

The accepted sequence is:

```text
adapted admission + pending operation
  -> close all durable handles
reopen + exact admission replay + claim
  -> render completes
  -> injected fault before persistence
  -> lifecycle retained at before-persist
  -> close all durable handles
reopen + reconstruct from protected canonical record
  -> rerender + verified persistence + terminal events
  -> close all durable handles
reopen
  -> completed status + idempotent operation replay + verified download
```

The generic acceptance executes create, after-render fault, recovery, and
verification in four independent Node processes. It also proves that another
principal cannot read operation, lifecycle, persistence, or terminal records.

## After-Render Recovery

E.6.2 exposed and repairs one real restart defect. A crash after rendering had
already advanced lifecycle to `before-persist`. The previous DocGen binding
recreated the original before-render transition with a new revision/time,
which conflicted and terminated the operation.

Renderer recovery now accepts an already-passed before-render checkpoint only
when the durable head is still `claimed`, is exactly at `before-persist`, owns
the same live claim token, and retains a matching checkpoint check. Recovery
then uses a revision-bound new before-persist check for the rerender. Normal
first-attempt and generic workflow behavior is unchanged.

## 69C Evidence

The retained section 2.1 adapted input is 749,929 UTF-8 bytes with 10
requirements and 7 screenshots.

- initial mapping executes once;
- admission replay after reopen executes the mapper zero times;
- all five metadata/value boundaries reopen four times in total;
- an injected after-render fault retains `before-persist` with no artifact
  projection;
- recovery rematerializes from the protected canonical record and completes;
- terminal status/download performs zero new materializations;
- the artifact is 10 pages and 1,417,544 bytes;
- metadata and downloaded bytes share SHA-256
  `5deed98f1d7b711dfba18e233b6b9d811ebeaf6e4474efd2f55f64ff08b60ac2`;
  and
- six terminal observability events and exact idempotent replay survive the
  final reopen.

The retained evidence contains fingerprints, counts, lifecycle facts, and
artifact facts only. It contains no requirement text, screenshot caption, raw
payload, or local source path.

## Explicit Resume Boundary

E.6.2 proves reconstruction when the exact operation identity is resumed. The
local composition does not scan and start pending work automatically on
process startup. Automatic startup discovery remains false, and no background
worker is mounted by this factory.

E.6.3 must connect Editor reload/retry to the durable local composition,
recover the known scoped operation, and prove cancel/retry/status/download UX.
Production worker discovery is a separate production-readiness decision.

## Explicitly Not Changed

- no default application-server route or automatic worker activation;
- no browser persistence or reconnect acceptance;
- no hosted provider, cross-store distributed transaction, migration rollout,
  retention, deployment, SLO, or cost decision;
- no SQLite scheduler optimization or new 240-page measurement;
- no REALDOC-F Module 2 expansion or REALDOC-G 200-page run; and
- no production activation.

## Verification

```text
npm test -- --run src/tests/docGenLocalDurablePdfExport.test.ts
npm test -- --run src/tests/pdfExportRealdocE62DurableLifecycleEvidence.test.ts
npm run pdf-export-realdoc-e62:verify -- --semantic-dir <semantic-directory>
```

## Next Phase

`PDF-EXPORT-REALDOC-E.6.3` owns durable local runtime wiring and Editor
reload/reconnect, failure, cancel, retry, diagnostics, status, and download
acceptance. Production remains NO-GO.
