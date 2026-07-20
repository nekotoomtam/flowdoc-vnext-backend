# PDF Export REALDOC Durable Lifecycle

Status: `PDF-EXPORT-REALDOC-E.6.3` accepted for the optional local Backend
composition and Editor reconnect path. Production remains NO-GO.

## Durable Composition

`createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1(...)` opens one
bounded local directory containing protected admission, PDF operation,
lifecycle, artifact projection, and observability SQLite repositories plus the
existing filesystem content-addressed PDF byte store.

Each repository retains its strict parser, scoped identity, bounded busy
behavior, transaction, replay, and corruption policy. The composition does not
claim a cross-database transaction and does not delete its root on close.
Recovery relies on exact idempotent workflow checkpoints.

## Local Runtime

`createFlowDocBackendDocGenLocalDurablePdfExportRuntimeV1(...)` joins that
composition, an admitted-artifact binding, and the optional loopback HTTP
server. The REALDOC-E.6.3 factory supplies the retained 69C structure, trusted
assets, named mapper, Published/Draft contexts, protected admission, and real
artifact materializer.

The runtime schedules an operation when it is created, exactly replayed, or
found by its scoped caller idempotency key. Replaying `POST /pdf-exports` after
a restart therefore resumes the known operation. Reading an arbitrary status
does not discover or start work.

Runtime facts remain:

- `durableComposition: true`;
- `explicitRequestReplayResume: true`;
- `automaticStartupDiscovery: false`;
- `defaultApplicationServerMounted: false`; and
- `productionBinding: false`.

## Recovery Rules

Pending lifecycle work is claimed through the existing local due-work worker.
An exact retained `claimed` head at `before-persist` may recover with the live
claim and revision-bound checkpoint check. Terminal work is finalized without
rematerializing the document.

`close()` stops pending dispatch timers, closes the listener, waits for active
work to settle, then closes all durable repositories. Reopening the same root
does not run a startup scan; the caller must replay the exact scoped request.

## Cancellation Reconciliation

The Editor retains the cancel idempotency key before sending cancellation.
After an interrupted response or Backend restart, it replays the original PDF
request and the same cancel key. Backend returns the retained cancelled state
and an exact cancel replay instead of allocating another lifecycle action.

## 69C Evidence

The retained E.6.3 evidence opens the same durable root four times:

1. admit the 749,929-byte adapted payload, create one pending operation, and
   close before dispatch;
2. reopen, replay the exact request, resume to completion, verify scoped status
   and PDF download, and conceal the operation from another principal;
3. create and cancel a second pending operation, then close; and
4. reopen, reconcile the cancelled request, and replay the same cancel key.

The adapted lane validates 10 requirements and 7 screenshots with zero errors
and three content-free warnings. The completed artifact is 10 pages and
1,417,544 bytes. All four dispatch attempts report zero failures. The retained
fixture contains no business text, raw payload, or local path.

Editor browser QA separately proves direct Published target restoration,
`Reconnecting exact preview`, restored diagnostics, verified same-session
download, and stale-result rejection when the memory-only JSON is absent after
reload.

## Verification

```text
npm test -- --run src/tests/docGenLocalDurablePdfExportRuntime.test.ts
npm test -- --run src/tests/pdfExportRealdocE63ReconnectEvidence.test.ts
npm run pdf-export-realdoc-e63:verify -- --semantic-dir <semantic-directory>
```

The HTTP QA command requires `FLOWDOC_REALDOC_E56_SEMANTIC_DIR`,
`FLOWDOC_REALDOC_E63_DURABLE_ROOT`, and a bounded
`FLOWDOC_PDF_LOCAL_BEARER_TOKEN`, then runs
`npm run pdf-export-realdoc-e63:http`.

## Explicitly Not Changed

- no default application-server mount or automatic worker discovery;
- no hosted database/object provider, production identity policy, deployment,
  retention, SLO, or cost decision;
- no browser persistence of Form/JSON/canonical business data;
- no SQLite scheduler optimization or new 240-page measurement;
- no REALDOC-F Module 2 expansion or REALDOC-G 200-page run; and
- no production activation.

## Next Decision

REALDOC-E.6 is accepted for the optional local-development profile. SQLite
scale optimization, REALDOC-F, and REALDOC-G remain deferred until explicitly
resumed. Production remains NO-GO.
