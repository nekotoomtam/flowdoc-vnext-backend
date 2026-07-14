# Durable Composition Scheduler Transient Availability

Status: Phase 396 provider-neutral head availability contract passes.
Production provider and worker activation remain blocked.

## Outcome

Phase 396 closes the rejected-exception gap identified in Phase 395 without
adding blind repository retries. Backend scheduler initialization,
advancement, finalization, and lifecycle head writes now cross one availability
boundary that preserves repository V1 compatibility and returns explicit
transient-storage evidence when commit outcome is unknown.

The contract is provider-neutral. SQLite implements its known busy path, while
the boundary converts an unexpected adapter exception into the same safe result
with a distinct source marker. No raw exception text is returned to callers.

## Availability Contract

An unavailable head write returns:

- `status: unavailable`;
- operation `head-create` or `head-compare-and-swap`;
- `commitState: unknown`;
- source `provider-declared` or `adapter-exception`;
- `retryable: true`;
- a reconciliation lane;
- a 250 ms initial retry delay; and
- an exponential, reconcile-before-retry policy bounded to three total
  attempts and a 2,000 ms delay ceiling.

Commit state remains conservatively unknown even for a SQLite busy result. The
adapter does not claim rollback certainty from a provider message that may be
raised at different transaction stages.

## Reconciliation Matrix

| Head operation | Reconcile with | Reason |
| --- | --- | --- |
| Initial head create | `create-request` | Exact create request is idempotent and reveals created versus replay. |
| Lease acquire/release or lifecycle CAS | `head-read` | Read and compare the exact expected/next fingerprint before any retry. |
| Transition commit | `committed-request` | The retained request index and receipt reveal an accepted commit. |
| Finalization commit | `committed-finalization` | The retained finalization index and both output refs reveal an accepted commit. |

The scheduler does not issue a compensating lease release after an unavailable
CAS. The original CAS may already have committed; releasing from assumed state
would create a second ambiguous mutation.

## Retry And Exhaustion

`decideFlowDocBackendCompositionTransientRetryV1(...)` is a pure policy helper.
After completed attempt one it permits attempt two after 250 ms. After attempt
two it permits attempt three after 500 ms. After attempt three it returns
`exhausted` with no next attempt or delay.

The helper never performs I/O or sleeps. A future worker must first execute the
specified reconciliation lane, then use the decision. Invalid attempt counts
also return exhausted. Composition attempt counters and transient storage
attempt counters remain separate concerns.

## Lifecycle Integration

- Initialization returns `unavailable` with `create-request` reconciliation.
- Advancement lease and release uncertainty returns `unavailable` with no
  asserted current head.
- Transition commit uncertainty returns `committed-request` reconciliation and
  does not attempt a speculative release.
- Finalization follows the same rule with `committed-finalization`.
- Recovery, retry scheduling, cancellation, and expiry return `unavailable`
  from lifecycle CAS.

All ordinary created, committed, replay, stale, conflict, invalid, blocked, and
quota behavior remains unchanged.

## SQLite Evidence

SQLite exposes new `createHeadWithAvailability(...)` and
`compareAndSwapHeadWithAvailability(...)` methods while retaining the original
repository V1 methods for compatibility and conformance.

A held `BEGIN IMMEDIATE` with a 100 ms contender timeout returns a
provider-declared unavailable create result. The original V1 method still
rejects, proving the production scheduler is using the explicit availability
surface rather than changing V1 semantics.

Injected before/after-commit evidence proves:

- head create before commit reopens absent and exact retry creates it;
- head create after commit reopens present and exact retry is idempotent replay;
- head CAS before commit reopens the old exact head; and
- head CAS after commit reopens the exact next head.

Injected faults remain adapter exceptions rather than being mistaken for a
SQLite busy declaration. Existing independent-process conformance and exact
240-page scale evidence remain green.

## PASS

- Provider-neutral typed head availability exists.
- Repository V1 signatures and direct behavior remain compatible.
- Unknown commit state never triggers blind retry or speculative lease release.
- All four reconciliation lanes are deterministic.
- Retry delay, maximum attempts, and exhausted outcome are pinned.
- Initialization, advancement, finalization, and lifecycle expose unavailable.
- SQLite busy and before/after-commit reconciliation evidence passes.
- Existing scale and twelve-scenario conformance gates pass.

## FAIL / BLOCKER

- No queue worker consumes the retry decision or reconciliation lanes yet.
- SQLite still fails the Phase 395 provisional concurrency throughput target.
- No production provider is qualified or activated.
- Read-path transient availability is not unified in this phase.
- Worker, queue, and HTTP routes remain closed.

## RISK

- An adapter exception may represent a programming defect; the source marker
  must remain observable and alertable rather than treated as ordinary busy.
- Incorrect worker reconciliation could duplicate work despite safe repository
  semantics.
- Retry storms remain possible until worker-level jitter and concurrency caps
  are pinned.
- Returning no asserted head on unavailable requires consumers to respect the
  reconciliation contract.

## UNKNOWN

- Queue retry scheduling, jitter, and dead-letter policy.
- Production SLA and provider topology.
- Which read and immutable operations need the same availability envelope.
- Telemetry, alerting, and operator workflow for exhausted attempts.
- Final database/provider selection.

## Files Changed

- `src/composition/compositionSchedulerProductionRepository.ts`
- `src/composition/compositionSchedulerHeadPersistence.ts`
- `src/composition/compositionSchedulerSqliteRepository.ts`
- `src/composition/compositionSchedulerInitialization.ts`
- `src/composition/compositionSchedulerAdvancement.ts`
- `src/composition/compositionSchedulerFinalization.ts`
- `src/composition/compositionSchedulerLifecycle.ts`
- `src/tests/compositionSchedulerHeadPersistence.test.ts`
- `src/tests/compositionSchedulerInitialization.test.ts`
- `src/tests/compositionSchedulerAdvancement.test.ts`
- `src/tests/compositionSchedulerFinalization.test.ts`
- `src/tests/compositionSchedulerLifecycle.test.ts`
- `src/tests/compositionSchedulerSqliteRepository.test.ts`
- `src/tests/compositionSchedulerSqliteConcurrency.test.ts`
- `src/tests/helpers/compositionSchedulerScaleFixture.ts`
- `src/tests/durableCompositionSchedulerTransientAvailabilityDoc.test.ts`
- `src/index.ts`, `README.md`, this document, and core cross-repo records

## Behavior Changed

Scheduler head writes now return typed unavailable results with reconciliation
and bounded retry facts instead of leaking transient adapter exceptions. No
automatic retry is performed. Direct repository V1 calls remain unchanged.

## Tests Run

- pure availability/reconciliation/retry/exhaustion tests;
- initialization, advancement, finalization, and lifecycle unavailable tests;
- SQLite busy and before/after-commit create/CAS reconciliation tests;
- exact 240-page scale and independent-process conformance regressions; and
- full backend, core, and editor gates before handoff.

## Risks Left

The contract can safely inform a worker, but production activation remains
blocked until a worker-level reconciliation and retry state machine consumes it
and provider qualification passes.

## Intentionally Not Changed

- repository V1 method signatures and result unions;
- core composition or canonical document semantics;
- queue, worker, route, auth, tenancy, deployment, and provider selection;
- editor, renderer, export, and artifact behavior; and
- SQLite durability settings or Phase 395 throughput decision.

## Next Recommended Direction

Phase 397 should implement a backend-owned worker-attempt reconciliation state
machine that consumes these availability facts without activating a queue or
route. It should prove create-request, exact-head, committed-request, and
committed-finalization recovery, bounded backoff/exhaustion, lease safety, and
one logical outcome across before/after-commit process loss.
