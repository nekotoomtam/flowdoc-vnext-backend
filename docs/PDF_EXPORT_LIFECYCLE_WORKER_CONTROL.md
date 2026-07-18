# PDF Export Lifecycle And Worker Control

Phase `PDF-EXPORT-V-C` adds a separate mutable lifecycle head and durable
transition journal over the immutable V-B PDF export operation. It accepts the
state, replay, attempt, deadline, checkpoint-cancellation, and shutdown-drain
sub-boundaries without adding a renderer, PDF byte persistence, artifact
projection, route, authorization execution, or production activation.

## Outcome

Each lifecycle head is bound to the exact V-B:

- operation id and operation fingerprint;
- Core admission fingerprint;
- Core idempotency payload fingerprint;
- accepted time;
- maximum attempt count; and
- execution deadline derived from the admitted policy.

The V-B operation remains immutable. Lifecycle updates use a separate head
revision and lifecycle fingerprint.

## Head And Claims

The head begins `pending` at `before-handoff`. A claim:

- requires the current expected head revision;
- records one bounded worker id and opaque claim token;
- increments the attempt count exactly once;
- expires no later than both five minutes and the operation deadline;
- rejects another owner while unexpired; and
- can be reclaimed after expiry under a new attempt and revision.

An exhausted attempt budget stops the backend lifecycle with the backend-only
reason `attempts-exhausted`. This reason is not projected as a Core terminal
receipt or artifact result in V-C.

A retryable release or expired-claim reclaim resets the checkpoint to
`before-handoff`. A new owner must therefore reload source identity and repeat
handoff/render validation instead of resuming an unpersisted renderer stage.

## Checkpoints And Stops

The ordered checkpoints are:

```text
before-handoff -> before-render -> before-persist
```

Passing a checkpoint checks the retained cancellation and deadline first. The
final checkpoint also supports an explicit check receipt on the current head,
so a later persistence phase can require the exact checked revision.

Cancellation of unclaimed work stops immediately at its current checkpoint.
Cancellation of claimed work is retained on the head and becomes terminal when
the owning worker reaches its next checkpoint. Deadline enforcement has an
explicit transition that can stop pending or claimed work and invalidate an
active claim. Forced shutdown also has an explicit terminal transition.

Mid-render cooperative cancellation is still V-D work. V-C contains no
renderer call and cannot claim that binding.

## Transition Replay

Every successful transition writes one immutable receipt containing:

- transition id and kind;
- normalized request fingerprint;
- from/to head revisions;
- result head fingerprint; and
- exact transition time.

Repository replay is checked before the submitted expected revision. Exact
redelivery returns the original receipt and the original post-transition head
snapshot even if the live head has advanced. Reusing a transition id with
changed facts is a conflict. A new transition against an old revision is stale.

## Repository Boundary

`src/pdfExport/pdfExportLifecycleRepository.ts` defines provider-neutral
initialize, scoped read, and transition behavior with an in-memory adapter.

`src/pdfExport/pdfExportLifecycleSqliteRepository.ts` adds a Node SQLite
candidate with:

- strict lifecycle-head and transition tables;
- WAL and `synchronous = FULL`;
- `BEGIN IMMEDIATE` initialization and transition transactions;
- compare-and-swap update by revision and head fingerprint;
- atomic head plus transition-receipt commit;
- exact JSON-to-column projection validation;
- bounded busy outcomes; and
- injectable before/after-commit fault boundaries.

The runtime floor is Node `24.15.0`. The lifecycle repository may use the same
SQLite database file as the V-B operation repository, but V-C does not add
service orchestration that atomically admits an operation and initializes its
head. Initialization is idempotent so an admitted operation without a head can
be repaired by retry.

## Shutdown Drain

`src/pdfExport/pdfExportShutdownDrain.ts` adds a process-local intake gate.
It reserves a claim slot while accepting, rejects new reservations after drain
begins, and reaches `shutdown-drain-complete` only when active reservations are
released. Forced stop returns the exact reservation ids it abandoned.

The gate is intentionally marked `processLocal: true` and
`multiProcessCoordination: false`. It is a worker-host control primitive, not a
durable cluster coordinator or production queue.

## Restart And Fault Evidence

- Lifecycle and transition replay survive close and reopen.
- A fault before transition commit retains the old head and no receipt.
- A fault after commit replays the committed head and receipt.
- Independent SQLite handles retain one claim winner under the same revision.
- Scope-protected reads do not reveal another tenant or principal lifecycle.
- Reads and replays return defensive copies.

Primary evidence:

- `src/pdfExport/pdfExportLifecycle.ts`;
- `src/pdfExport/pdfExportLifecycleRepository.ts`;
- `src/pdfExport/pdfExportLifecycleSqliteRepository.ts`;
- `src/pdfExport/pdfExportShutdownDrain.ts`;
- `src/tests/pdfExportLifecycleRepository.test.ts`; and
- `src/tests/pdfExportShutdownDrain.test.ts`.

## Activation Decision

V-C accepts the durable lifecycle state machine and repository semantics. It
does not bind a queue, due-work scanner, automatic deadline clock, renderer,
mid-render cancellation signal, PDF bytes, terminal Core receipt, artifact
manifest/job, observability sink, authenticated route, deployment, or
production flag.

Follow-up `PDF-EXPORT-V-D` now binds the lifecycle to the exact Core handoff,
receipt, and completion through a cooperative candidate renderer SPI in
`docs/PDF_EXPORT_RENDERER_ADAPTER_QUALIFICATION.md`. Concrete production
renderer selection remains blocked.

Follow-up `PDF-EXPORT-V-E` now binds the checked `before-persist` head to
durable bytes, transactional artifact projection, and terminal receipt replay
in `docs/PDF_EXPORT_DURABLE_ARTIFACT_PERSISTENCE.md`.

Follow-up `PDF-EXPORT-V-F` now composes this lifecycle into privacy-safe
terminal events and full restart/fault qualification in
`docs/PDF_EXPORT_PRIVACY_OBSERVABILITY_QUALIFICATION.md`. Follow-up V-G adds
authenticated cancellation/status routing but records production activation as
NO-GO in `docs/PDF_EXPORT_AUTHENTICATED_ROUTE_ACTIVATION_REVIEW.md`.
