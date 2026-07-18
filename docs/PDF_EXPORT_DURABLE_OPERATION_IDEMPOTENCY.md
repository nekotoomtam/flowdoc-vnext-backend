# PDF Export Durable Operation And Idempotency

Phase `PDF-EXPORT-V-B` accepts a backend-owned immutable PDF export operation,
caller-key idempotency binding, and durable SQLite candidate. It does not add
an operation lifecycle head, worker, renderer, artifact persistence, route,
authorization execution, or production activation.

## Outcome

Backend now calls the public Core production-admission contract and retains its
exact result inside one immutable PDF export operation. The operation binds:

- one backend operation id;
- one nonblank tenant id and principal id;
- one caller-supplied idempotency key;
- the exact Core idempotency payload fingerprint;
- the complete Core admission and admission fingerprint; and
- an exact backend acceptance time.

The backend operation has its own fingerprint. Any operation fact or retained
Core admission drift blocks repository admission and durable reads.

## Idempotency Decision

The repository uniqueness scope is:

```text
(tenantId, principalId, callerIdempotencyKey)
```

The accepted decisions are:

| Existing binding | Submitted Core payload | Decision |
| --- | --- | --- |
| none | any valid payload | create the submitted operation |
| same scope/key | same payload fingerprint | return the existing operation |
| same scope/key | different payload fingerprint | reject as conflict |
| different tenant or principal | same caller key | independent binding |
| existing operation id | another caller-key binding | reject as conflict |

An idempotent replay returns the originally retained operation even when the
retry proposes another operation id. This prevents a retry from forking one
caller intent into two durable operations.

The mapping is immutable. A later lifecycle or terminal receipt cannot change
the caller key, scope, Core payload fingerprint, admission, or operation id.

## Repository Boundary

`src/pdfExport/pdfExportOperationRepository.ts` defines provider-neutral
admit and scoped-read behavior plus an in-memory conformance adapter.

`src/pdfExport/pdfExportOperationSqliteRepository.ts` adds a dynamically gated
Node SQLite candidate with:

- WAL and `synchronous = FULL`;
- one strict operation table;
- a primary key on operation id;
- a unique tenant/principal/caller-key index;
- `BEGIN IMMEDIATE` admission transactions;
- bounded busy outcomes;
- exact JSON-to-column projection validation; and
- injectable before/after-commit fault boundaries.

The runtime floor is Node `24.15.0`, matching the existing composition SQLite
qualification lane. The package-wide lower Node engine remains unchanged, so
callers must use the explicit runtime support check before selecting this
adapter.

## Restart And Fault Semantics

- A first successful admission returns `created`.
- Exact duplicate delivery returns `idempotent-replay` from the retained row.
- A fault before commit leaves no operation; retry creates it.
- A fault after commit can leave the caller with an unknown outcome; retry
  resolves it as idempotent replay.
- Closing and reopening the database retains the exact original operation.
- Independent handles admit one owner for the same scoped caller key.

## Ownership

Core still owns production request/admission identity, measured resource
limits, and payload-fingerprint semantics. Backend imports Core only through
`@flowdoc/vnext-core`; it does not recreate admission policy.

Backend owns caller keys, tenant/principal scope, operation identity,
acceptance time, repository decisions, persistence projection, and SQLite
transaction behavior.

The operation is intentionally immutable. V-C must add a separate lifecycle
head or journal for claims, attempts, deadline, cancellation, and shutdown
drain. Composition worker records are evidence patterns only and are not reused
as PDF operation state.

## Accepted Evidence

Primary evidence:

- `src/pdfExport/pdfExportOperation.ts`;
- `src/pdfExport/pdfExportOperationRepository.ts`;
- `src/pdfExport/pdfExportOperationSqliteRepository.ts`;
- `src/tests/pdfExportOperation.test.ts`;
- `src/tests/pdfExportOperationRepository.test.ts`; and
- `src/tests/helpers/pdfExportOperationFixture.ts`.

Tests cover deterministic Core admission wrapping, stale source rejection,
operation/admission fingerprint drift, exact duplicate replay, conflicting
payload rejection, tenant/principal isolation, operation-id collision,
defensive read clones, SQLite restart, commit-boundary faults, and independent
repository handles.

## Activation Decision

V-B accepts the durable admission and caller-key mapping needed by the backend
idempotency boundary. Follow-up V-E now retains a terminal persistence receipt
by operation for exact restart replay. Follow-up V-G exposes scoped caller-key
replay through an authenticated route candidate, while production identity and
route activation remain blocked.

Authorization and tenancy activation also remain blocked. V-B retains exact
scope facts but performs no identity authentication or permission decision.

No operation lifecycle, queue, worker, timer, cancellation, renderer, PDF byte
write, artifact manifest/job projection, observability sink, route, download,
editor behavior, deployment, or production flag is added.

Follow-up `PDF-EXPORT-V-C` now adds the separate lifecycle head, transition
journal, bounded claim/replay and attempts, deadline and cancellation
decisions, and process-local shutdown drain in
`docs/PDF_EXPORT_LIFECYCLE_WORKER_CONTROL.md`. The immutable V-B operation and
caller-key mapping remain unchanged.

Follow-up `PDF-EXPORT-V-D` now adds the exact Core renderer adapter and
cooperative candidate control in
`docs/PDF_EXPORT_RENDERER_ADAPTER_QUALIFICATION.md`.

Follow-up `PDF-EXPORT-V-E` now adds durable bytes, transactional artifact
projection, terminal receipt replay, and bounded orphan recovery in
`docs/PDF_EXPORT_DURABLE_ARTIFACT_PERSISTENCE.md`.

Follow-up `PDF-EXPORT-V-F` now adds privacy-safe terminal events and full
restart/fault qualification in
`docs/PDF_EXPORT_PRIVACY_OBSERVABILITY_QUALIFICATION.md`. Follow-up V-G is
recorded in `docs/PDF_EXPORT_AUTHENTICATED_ROUTE_ACTIVATION_REVIEW.md` with a
NO-GO production decision.
