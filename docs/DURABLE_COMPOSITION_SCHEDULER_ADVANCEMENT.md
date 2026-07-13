# Durable Composition Scheduler Advancement

Status: Phase 389 exact-window advancement implemented. Recovery policy,
expiry, cancellation, finalization, routes, and consumers remain inactive.

## Outcome

`advanceFlowDocBackendCompositionV1(...)` advances one source-pinned
composition job through one exact core family window or one exact demand-free
structural continuation. It acquires a short compare-and-swap lease, calls the
pure core transition, stages immutable evidence, and commits cursor, open page,
demand, chain tips, and counts through one final head compare-and-swap.

The service does not paginate a family, combine windows, loop through several
transitions, render output, or expose a route/worker. One accepted call is one
durable transition and one transition receipt.

## Exact Request

The request pins job id, expected head revision/fingerprint, current demand
fingerprint, and supplied window fingerprint. The execution attempt separately
owns attempt id, lease token, acquisition/completion time, and lease expiry, so
retry attempts do not change the idempotent request identity.

`waiting-window` requires its exact demand plus one parsed common family
window. `ready-to-advance` requires both demand and window to be null. A stale
head, mismatched demand/window, active lease, terminal status, or exhausted
pinned limit cannot call core.

## Atomic Protocol

1. Read and validate the complete repository head/context.
2. Return any exact committed request replay before applying stale-head gates.
3. Validate active state, expected head, demand/window pairing, limits, and
   lease lifetime.
4. Compare-and-swap a short lease and increment bounded attempt count.
5. Call `advanceVNextDocumentCompositionV1(...)` with pinned manifest/state,
   exact window or null, and pinned transition limits.
6. Stage the accepted family window, optional non-empty closed-page chunk, and
   exact transition receipt as immutable records.
7. Compare-and-swap the leased head to the accepted next state while clearing
   the lease and atomically indexing the committed request.

The last compare-and-swap is the only accepted transition commit. Staged blobs
from a losing or failed attempt are unreachable and do not advance core state.

## Chunk And Receipt Chain

Closed pages are stored only when the core transition emits a non-empty page
array. Each chunk continues the prior backend chunk tip and the separate core
closed-page prefix/counts. A transition receipt exists for every accepted
transition, including transitions that emit no pages and demand-free
`window: null` continuation.

The job head retains only the latest receipt/chunk tips and cumulative core
counts. It does not grow an array of windows, pages, or attempts.

## Replay And Concurrency

The repository now exposes read-only committed-request lookup. Exact replay
loads and reparses the retained receipt and returns its committed head snapshot
even after the live head has moved. Reusing a committed request id with another
canonical fingerprint conflicts.

Only one worker can acquire an expected head. A concurrent loser receives the
current stale head and commits no cursor, demand, chain, or count changes.

## Rejection And Failure Isolation

Core `window-rejected` clears the lease, preserves the exact cursor/open page/
demand and transition number, and stores only a bounded retryable blocker.
Core terminal blockers clear demand/lease and move the unchanged core state to
`blocked` without a transition receipt.

Immutable staging failure also clears the lease, preserves the demanded state,
and records a retryable blocker. Retry timing, expired-lease takeover, retained
attempt diagnostics, and backoff policy remain Phase 390 responsibilities.

## Verification

Focused tests use real core manifests/windows and prove accepted family
completion, retained immutable window/chunk/receipt records, replay after a
stale expected revision, request conflict, real output-limit then null-window
completion, receipt-only open-page continuation, exact state preservation after
window rejection, terminal family blocking, one concurrent lease winner, and
lease release after storage failure.

## PASS

- One exact family or structural transition commits atomically.
- Core remains the only pagination and window-acceptance authority.
- Demand-free output-limit continuation is executable without fake work.
- Exact replay does not call core or advance the live head.
- Rejected and failed attempts do not advance cursor or transition count.
- Job-head size remains bounded while document-length evidence stays immutable.

## FAIL / BLOCKER

- No expired-lease takeover, retry/backoff scheduler, cancellation, expiry,
  finalization, route, queue worker, production database, auth, or tenancy.
- No renderer, PDF/DOCX, editor progress, or viewport page consumer is active.

## RISK

- Production head and request-index writes must be one atomic transaction.
- Staged unreachable records require retention and garbage collection.
- Production retained-byte accounting is not implemented by the in-memory
  conformance repository.
- Rejected attempts currently retain one bounded head blocker, not a durable
  attempt-log record.

## UNKNOWN

- Production database/object-store and transaction isolation.
- Lease duration, retry/backoff, queue, quota, and cleanup values.
- Measured window/chunk distribution for mixed 200-300 page documents.

## Files Changed

- `src/composition/compositionSchedulerAdvancement.ts`
- `src/composition/compositionSchedulerRepository.ts`
- `src/tests/compositionSchedulerAdvancement.test.ts`
- `src/tests/compositionSchedulerRepository.test.ts`
- `src/tests/helpers/compositionSchedulerFixture.ts`
- `src/tests/durableCompositionSchedulerAdvancementDoc.test.ts`
- `src/index.ts`, `README.md`, and core cross-repo records

## Behavior Changed

Backend package consumers can advance an in-memory source-pinned composition
job by one exact transition. No HTTP or deployed worker behavior is activated.

## Tests Run

- focused advancement/repository/documentation tests;
- backend full check and build;
- focused core cross-repo test; and
- core full check.

## Risks Left

Recovery lifecycle, terminal finalization, retained-byte/production storage,
large-document orchestration, routes, consumers, and deployment policy.

## Intentionally Not Changed

- core composition semantics or contracts;
- existing backend file/package/artifact storage and HTTP routes;
- editor source, viewport, selection, WYSIWYG, or progress UI;
- renderer, PDF, DOCX, or artifact bytes; and
- auth, tenancy, deployment, or queue policy.

## Next Recommended Direction

Implement Phase 390 recovery, expiry, cancellation, finalization, and progress:
expired-lease takeover, bounded retry/backoff, terminal CAS operations, complete
reachable-chain verification, core finalization, immutable plan/map retention,
and completed progress projection.
