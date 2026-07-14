# Durable Composition Scheduler Worker Reconciliation

Status: Phase 397 worker storage-attempt reconciliation passes. Queue,
provider, and route activation remain blocked.

## Outcome

Phase 397 consumes the Phase 396 transient head-availability contract without
adding blind retries, sleeps, a queue, or an HTTP route. Backend now owns a
fingerprinted state machine that reconciles one exact head mutation before it
permits another write attempt.

The state machine separates storage write attempts from reconciliation read
failures. A failed read never consumes a write attempt, and a retry-ready state
never changes the mutation it was created for.

## State Contract

`FlowDocBackendCompositionWorkerStorageAttemptStateV1` has two phases:

- `reconcile` requires exact retained evidence before another write;
- `retry-ready` records the exact next write attempt and `retryNotBefore`.

Every state retains:

- exact job and mutation fingerprints;
- a fingerprint over the complete state itself;
- completed write-attempt count;
- reconciliation-failure count;
- the Phase 396 availability and reconciliation lane;
- the time the unknown write outcome occurred; and
- the next permitted reconciliation or write time when deferred.

JSON round-trip preserves the state. Editing its attempt count, timing,
availability policy, lane, or mutation invalidates the fingerprint or exact
mutation binding and blocks execution.

## Creation Identity Read

Repository V1 gains the additive `readHeadCreation(jobId)` method. It returns
the retained create request id, request fingerprint, and validated head without
performing another create.

This read is required at the write-attempt limit. Replaying create merely to
discover whether attempt three committed could perform an accidental fourth
write when attempt three rolled back. Both in-memory and SQLite repositories
implement the read, and the production conformance inventory now contains
thirteen scenarios including `head-creation-identity-read`.

## Reconciliation Matrix

| Lane | Exact evidence | Committed result | Retry condition |
| --- | --- | --- | --- |
| `create-request` | retained create id, request fingerprint, and head identity | all exact facts match | no head exists |
| `head-read` | current head revision and fingerprint | current head equals proposed next head | current head still equals expected head |
| `committed-request` | request fingerprint, receipt ref, and committed head | all exact facts match | request index is absent |
| `committed-finalization` | request fingerprint, both output refs, and completed head | all exact facts match | finalization index is absent |

A current head different from both expected and proposed is `superseded`.
Retained request identity with different exact evidence is `conflict`.
Invalid retained evidence is `failed`; it is never guessed into success.

Head identity uses validated `jobId`, `headRevision`, and canonical
`fingerprint`. Content-ref identity uses job, kind, record id, record
fingerprint, and byte length. Object property order is not semantic evidence.

## Attempt And Backoff Rules

- Head writes remain bounded to three total attempts.
- Attempt two cannot start before 250 ms after attempt one became unknown.
- Attempt three cannot start before 500 ms after attempt two became unknown.
- The final unavailable write is reconciled once more before exhaustion is
  asserted, so an after-commit exception is not misreported as failure.
- Reconciliation reads have a separate three-failure budget with 250/500 ms
  deferral; exhaustion remains unresolved rather than issuing another write.
- The module returns timestamps and decisions but never sleeps or schedules.

The exact proposed lease-acquisition mutation cannot retry before its acquired
time or at/after its expiry. The worker does not silently mint a new lease or
release a lease whose original CAS may already have committed.

## SQLite Restart Evidence

All four lanes inject faults at both transaction boundaries:

- before commit leaves the exact prior evidence, then one permitted retry
  commits the mutation;
- after commit retains the exact evidence, then reconciliation returns
  committed without another write.

Each case closes and reopens the SQLite connection before reconciliation.
Transition evidence uses the retained committed-request index and receipt.
Finalization evidence is produced through the real finalization service and
retains its exact page-plan and heading-page-map refs. Both crash sides finish
with one logical committed outcome.

## PASS

- Worker storage-attempt state is fingerprinted and mutation-bound.
- Reconcile and retry-ready phases are explicit and JSON-safe.
- Creation reconciliation never needs an unbounded idempotent write probe.
- All four Phase 396 lanes produce deterministic outcomes.
- Write attempts, reconciliation failures, and backoff are separately bounded.
- Attempt three reconciles before write exhaustion is asserted.
- Mutation drift and edited state are blocked.
- Expired lease-acquisition retries are blocked without writing.
- SQLite before/after-commit restart evidence passes for all four lanes.
- The thirteen-scenario independent-process conformance gate passes.

## FAIL / BLOCKER

- No durable worker-state store or queue message envelope is selected.
- No runner schedules `retryNotBefore` or `reconcileNotBefore`.
- Reconciliation reads do not yet expose a provider-declared availability
  envelope; adapter exceptions are bounded by the worker state instead.
- SQLite still fails the Phase 395 provisional concurrent throughput target.
- No production provider, queue, worker process, or route is activated.

## RISK

- A future runner must persist the exact mutation beside its fingerprinted
  state; retaining only the state is insufficient to perform an exact retry.
- Treating every reconciliation read exception as transient can delay
  discovery of an adapter programming defect; exhaustion must be observable.
- Queue redelivery and worker ownership must not create parallel retry-ready
  consumers for one state.
- State time comes from the backend worker boundary and requires a consistent
  clock policy before distributed activation.

## UNKNOWN

- Durable state/journal technology and atomic claim protocol.
- Queue visibility timeout, jitter, redelivery, and dead-letter policy.
- Telemetry and operator workflow for reconciliation or write exhaustion.
- Production provider topology, SLA, and database choice.
- Which immutable/read operations should later share this availability model.

## Files Changed

- `src/composition/compositionSchedulerWorkerAttempt.ts`
- `src/composition/compositionSchedulerRepository.ts`
- `src/composition/compositionSchedulerSqliteHeadStore.ts`
- `src/composition/compositionSchedulerSqliteRepository.ts`
- `src/composition/compositionSchedulerRepositoryConformance.ts`
- `src/tests/compositionSchedulerWorkerAttempt.test.ts`
- `src/tests/compositionSchedulerSqliteRepository.test.ts`
- `src/tests/compositionSchedulerRepository.test.ts`
- `src/tests/compositionSchedulerSqliteConformanceRunner.test.ts`
- `src/tests/helpers/compositionSchedulerScaleFixture.ts`
- `src/index.ts`, `README.md`, this document, and core cross-repo records

## Behavior Changed

Backend can now turn one unavailable head write into a mutation-bound reconcile
state, inspect exact retained evidence, issue a time-gated retry-ready state,
perform at most one exact retry per transition, and stop on committed,
superseded, conflict, exhaustion, invalid state, or unavailable reads.

Repository V1 adds a read-only creation-identity method. Existing create, head
read, committed-request/finalization, and CAS behavior remains unchanged.

## Tests Run

- state creation, JSON round-trip, mutation/state drift, and policy tampering;
- create/head/request/finalization reconciliation and retry decisions;
- write and reconciliation-read exhaustion;
- early and expired lease retry rejection;
- SQLite before/after-commit close/reopen for all four lanes;
- in-memory creation identity and thirteen-scenario child-process conformance;
- exact 240-page scale and full backend, core, and editor gates before handoff.

## Risks Left

The state machine is safe to persist and drive, but production activation stays
blocked until one durable runner owns state claims, timing, redelivery, and
exhaustion observability without parallel execution.

## Intentionally Not Changed

- core composition and canonical document semantics;
- scheduler initialization, advancement, finalization, and lifecycle result
  envelopes;
- queue, worker process, routes, auth, tenancy, and deployment;
- provider selection or SQLite durability settings;
- editor, renderer, export, and artifact behavior; and
- Phase 395 SQLite throughput qualification.

## Next Recommended Direction

Phase 398 should define a backend-owned durable worker-attempt journal and
atomic claim/complete protocol around the exact mutation plus fingerprinted
state. It should prove process restart, duplicate delivery, expired ownership,
one active claimant, scheduled timing, and terminal exhaustion without choosing
or activating an external queue yet.
