# Durable Composition Scheduler Initialization

Status: Phase 388 source-pinned initialization implemented. Family-window
advancement, recovery, finalization, routes, and consumers remain inactive.

## Outcome

`initializeFlowDocBackendCompositionV1(...)` now checks the exact source
revision before retaining data or calling core, validates source/manifest
owners, pins profiles and limits, stages immutable source/manifest evidence,
calls core initialization, and creates one revision-zero durable job head.

Exact create replay returns the retained head. Reused job identity with a
different request blocks through repository conflict.

## Revision Gate

The caller supplies current revision separately from requested base revision.
A mismatch returns `stale` before any immutable write or head creation. Later
document edits do not alter the pinned job.

## Core Initialization

The service maps accepted core outcomes exactly:

- `needs-family-window` to `waiting-window` with exact demand;
- demand-free `output-limit` to `ready-to-advance`; and
- `document-complete` to `ready-to-finalize`.

Blocked core initialization creates no head.

## Initial Page Chunks

Core may close pages during initialization, including empty sections, before a
family window exists. Such pages are retained in one immutable chunk with
`transitionNumber: 0` and `windowRef: null`. The job head retains its backend
chunk fingerprint and separate core closed-page prefix. No fake transition
receipt is created; transition count and receipt tip remain zero/null.

## Atomic Boundary

Immutable source, manifest, and optional initial chunk are staged before
idempotent `createHead(...)`. Failed/conflicting creation can leave unreachable
staging data but cannot create partial accepted job state. Repository retention
may garbage-collect it later.

## Verification

Focused tests prove normal first demand plus exact replay, stale-before-write,
immutable owner retention, empty-document terminal initialization with one
initial page, and two-empty-section output-limit continuation.

## PASS

- Base revision gates precede core and storage work.
- Source snapshot, manifest, profiles, limits, and lifetime are immutable pins.
- Core initialization outcomes map without invented semantics.
- Initial closed pages retain real core prefix and no fake receipt.
- Exact create replay does not advance head revision.

## FAIL / BLOCKER

- No family-window advancement or lease service exists yet.
- No recovery, cancellation, expiry, finalization, route, worker, production
  database, auth, tenancy, editor, or renderer integration exists.

## RISK

- Source snapshot producers must provide canonical compact fingerprints.
- Failed creation staging needs retention cleanup.
- Production base-revision reads and head creation need one service transaction
  or immutable source semantics equivalent to this gate.

## UNKNOWN

- Production source snapshot representation and transaction isolation.
- Retention/cleanup timing and quota policy.
- Queue/provider scheduling after first demand.

## Files Changed

- `src/composition/compositionSchedulerInitialization.ts`
- `src/composition/compositionSchedulerTransitionRecords.ts`
- `src/tests/compositionSchedulerInitialization.test.ts`
- `src/tests/durableCompositionSchedulerInitializationDoc.test.ts`
- `src/index.ts`, `README.md`, and core cross-repo records

## Behavior Changed

Backend package consumers can initialize an in-memory durable composition job
against supplied source evidence. No HTTP or product runtime is activated.

## Tests Run

- focused initialization/contracts/documentation tests;
- backend full check and build;
- focused core cross-repo test; and
- core full check.

## Risks Left

Advancement, recovery, terminal finalization, scale, and production policy.

## Intentionally Not Changed

- core semantics; existing backend storage/routes/artifacts; editor; renderer;
  PDF/DOCX; auth; tenancy; deployment.

## Next Recommended Direction

Implement Phase 389 exact-window advancement with short lease CAS, retained
window/chunk/receipt staging, one atomic committed head, replay, and concurrent
worker rejection. Include `ready-to-advance` null-window continuation.
