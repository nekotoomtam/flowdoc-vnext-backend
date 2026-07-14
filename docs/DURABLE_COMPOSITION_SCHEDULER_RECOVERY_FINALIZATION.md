# Durable Composition Scheduler Recovery And Finalization

Status: Phase 390 lifecycle recovery and terminal finalization implemented over
the backend repository boundary. Production storage, worker/queue policy,
routes, cleanup, and consumers remain inactive.

## Outcome

The backend package can now recover an expired composition lease, retain an
explicit retry time, cancel or expire a job through compare-and-swap, project
source-aware progress, verify the complete reachable evidence chain, and
publish authoritative core page-plan and heading-page-map outputs.

This phase completes the in-memory scheduler lifecycle selected in Phase 385.
It does not promote the in-memory adapter to production storage or make
composition work run automatically.

## Recovery And Retry

`recoverExpiredFlowDocBackendCompositionLeaseV1(...)` requires the exact head
revision and fingerprint. It cannot take an active lease. At lease expiry it
clears only that lease, preserves accepted composition state, records a bounded
retryable blocker, and optionally retains a retry time. If the pinned job
lifetime has also ended, recovery commits terminal `expired` instead.

`scheduleFlowDocBackendCompositionRetryV1(...)` accepts only unleased active
heads with a retryable blocker. Advancement and finalization both reject lease
acquisition before the retained retry time. Attempt limits and the pinned job
lifetime remain authoritative.

## Cancellation Expiry And Progress

Cancellation uses the exact current head and atomically clears demand, lease,
retry timing, and blocker before entering terminal `cancelled`. An old worker
therefore loses its final compare-and-swap. Expiry enters terminal `expired`
only at or after the source-pinned lifetime. Completed, blocked, cancelled, and
expired states cannot be rewritten into another terminal meaning.

Progress is rebuilt from the validated current head and source pin. The caller
supplies the current source revision only to derive the redacted
`sourceCurrent` fact; source payloads and lease tokens are not exposed.

## Reachable Chain Verification

Finalization walks closed-page chunks and transition receipts backward by
their content fingerprint, then validates them in forward order. It proves:

- exact backend chunk links and exact core closed-page prefix continuity;
- cumulative page, placement, and heading counts equal the committed head;
- contiguous receipt numbers and receipt links cover every transition;
- each referenced family window and page chunk resolves to exact retained
  content; and
- the terminal receipt cursor equals the completed core cursor.

Transition-zero pages emitted during initialization are valid with no fake
receipt. Missing, malformed, cyclic, or cross-linked retained evidence blocks
finalization terminally instead of publishing partial output.

## Finalization Protocol

`finalizeFlowDocBackendCompositionV1(...)` accepts only an exact unleased
`ready-to-finalize` head. It first checks committed-request replay, acquires one
short lease through compare-and-swap, verifies the reachable chain, and calls
`finalizeVNextDocumentCompositionV1(...)` with the pinned manifest, terminal
cursor, and ordered closed pages.

The resulting page plan and heading-page map are stored as immutable records.
One final compare-and-swap commits the `completed` head and finalization request
index together. Exact retries reopen and revalidate both outputs; reuse of the
request id with different request facts conflicts. A competing finalizer loses
the lease compare-and-swap.

Output-storage failure releases the lease and leaves a retryable
`ready-to-finalize` head. Invalid reachable evidence or a core finalization
blocker clears the lease and commits terminal `blocked` with no final output.

## Core Contract Repair

Finalized heading-page maps include a compact fingerprint. The core parser now
accepts both pre-finalization facts and a finalized retained map, recomputes the
fingerprint, and blocks drift. This matches the existing page-plan reopen
contract and makes finalization replay fully verifiable.

## Verification

Focused tests cover early and expired lease recovery, retry gating, atomic
cancellation, pinned expiry, source-aware progress, exact chain publication,
finalization replay/conflict, transition-zero finalization, one concurrent
finalizer, missing-chain terminal blocking, output-storage retryability, and
immutable fingerprint alias rejection.

## PASS

- Recovery, retry timing, cancellation, expiry, and progress are explicit.
- Finalization verifies all reachable retained evidence before calling core.
- Page-plan and heading-map publication is one completed-head transaction.
- Exact finalization replay reopens and validates immutable outputs.
- Transition-zero and concurrent-finalizer paths are covered.

## FAIL / BLOCKER

- No production database/object-store transaction adapter or queue worker.
- No HTTP route, auth, tenancy, renderer/export, or editor progress consumer.
- No retained-byte quota enforcement or unreachable-record garbage collector.

## RISK

- A production adapter must atomically commit head and request indexes.
- Fingerprint lookup needs a durable unique index scoped by job and kind.
- Full chain reads are linear in retained chunks and receipts at finalization.
- Retry/backoff values remain caller policy rather than a queue policy module.

## UNKNOWN

- Production storage and transaction-isolation choice.
- Worker lease duration, backoff curve, queue visibility, and cleanup policy.
- Measured chunk count, retained bytes, and finalization latency at 200-300
  pages with mixed families.

## Files Changed

- scheduler lifecycle, chain reader, finalization, advancement retry gate, and
  repository modules;
- scheduler lifecycle/finalization/repository tests and public exports;
- backend README and this phase record; and
- core heading-map parser regression plus cross-repo phase records.

## Behavior Changed

Backend package consumers can explicitly drive an in-memory composition job
through recovery and terminal finalization. No server route or deployed worker
behavior is activated.

## Tests Run

- focused backend scheduler lifecycle, repository, initialization,
  advancement, finalization, and documentation tests;
- backend full check and build;
- focused core parser and cross-repo tests; and
- core full check.

## Risks Left

Production retention, quotas, garbage collection, queue orchestration,
large-document profiling, routes, consumers, renderer/export, and deployment.

## Intentionally Not Changed

- core composition transition or pagination semantics;
- existing backend HTTP, package, artifact, and file-storage routes;
- editor source, selection, viewport, WYSIWYG, and progress UI;
- renderer, PDF, DOCX, and artifact bytes; and
- auth, tenancy, queue, or deployment policy.

## Next Recommended Direction

Phase 391 should exercise the whole scheduler at representative 200-300 page
scale, measure chunk/receipt/byte and finalization costs, enforce retained-byte
limits, define cleanup ownership, and close production-readiness decisions
before selecting a concrete storage or worker adapter.
