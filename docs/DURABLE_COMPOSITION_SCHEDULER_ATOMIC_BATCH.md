# Durable Composition Scheduler Atomic Batch

Status: Phase 394 atomic admitted staging passes locally. Production scheduler
activation remains blocked.

## Outcome

Phase 394 adds one bounded atomic immutable batch to the production repository
extension and routes initialization, advancement, and finalization through it.
Each retained record remains independently content-addressed; the batch is only
the physical admission and transaction boundary for one scheduler event.

Repository V1 is unchanged. In-memory and other V1-only adapters retain their
existing sequential staging behavior, while a repository that exposes the
complete production marker and method set receives atomic admitted batches.

## Batch Contract

`putImmutableBatchWithPhysicalAdmission(...)` accepts 1 through 64 records,
one exact ISO storage time, and one positive bounded physical-byte ceiling.
Every record must belong to the same job. Duplicate record ids or duplicate
kind/fingerprint identities inside one request are invalid.

The adapter validates the complete request before opening a transaction. In
the transaction it resolves every record as an exact replay, conflict, or
first write before inserting anything. A conflict or quota rejection leaves
both immutable rows and physical usage unchanged.

Successful mixed replay/first-write batches insert only missing records,
report the exact first-write count, and update physical record/byte usage once.
An all-replay batch is idempotent and consumes no new quota.

## Lifecycle Wiring

- Initialization stages source snapshot, composition manifest, and optional
  transition-zero page chunk as one event.
- Advancement stages the accepted family window, optional page chunk, and
  transition receipt as one event.
- Finalization stages page plan and heading-page map as one event.

All three use the source-pinned `maximumRetainedByteCount` as the physical
admission ceiling. Their existing logical retention checks remain in place
before storage.

Physical quota rejection is terminal for advancement and finalization. The
job becomes explicitly blocked with a non-retryable blocker instead of looping
against usage that active-job cleanup is intentionally forbidden to mutate.

## Compatibility Boundary

The production type guard requires the explicit production source marker plus
single admission, batch admission, batch read, usage inspection, and cleanup
methods. A partially decorated V1 repository cannot accidentally enter the
production path.

The single-record production operation delegates to the same batch primitive,
so uniqueness, exact replay, quota, usage, and crash semantics have one SQLite
implementation. The unbounded V1 `putImmutable(...)` remains available only
for compatibility and direct conformance setup.

## Atomicity Evidence

Focused SQLite tests prove:

- a two-record quota rejection retains neither record and no usage row;
- a successful two-record batch increments usage exactly once;
- all-replay and mixed replay/first-write results preserve exact accounting;
- a later conflict rolls back an earlier pending record in the same batch;
- an injected failure before commit retains neither record after reopen; and
- an injected failure after commit retains both records and exact usage after
  reopen.

The independent-process twelve-scenario Phase 392 conformance runner still
passes without changing its report contract.

## Scale Evidence

The SQLite candidate repeats the exact Phase 391/393 workload:

- 240 pages across all six composition families;
- 479 accepted transitions;
- 1,202 immutable records and 3,224,446 canonical JSON bytes;
- 481 admitted immutable batch transactions;
- one real mid-run connection close and reopen;
- exact physical usage, logical retention, progress, and final output parity;
  and
- a maximum serialized head of 5,364 bytes.

Batching replaces 1,202 immutable transactions with 481 transactions, removing
721 full-durability commit boundaries. The focused local SQLite workload takes
about 57.7 seconds, down from about 67 seconds in Phase 393. The remaining cost
includes 960 lease/final head CAS operations and one head creation, so immutable
batching improves the identified bottleneck without weakening durability.

## Performance Decision

The candidate remains suitable as local transactional evidence, but this phase
does not establish a production deployment choice. SQLite still serializes
writers, and one single-job timing does not establish concurrent-job latency or
throughput. Durability settings were not lowered to manufacture a faster run.

Before activation, the same exact workload needs bounded multi-job contention
evidence and an explicit decision about whether the deployment target can use
SQLite or must qualify another transactional provider through the Phase 392
gate.

## PASS

- Bounded atomic admitted immutable batch contract exists.
- SQLite implements all-or-nothing validation, replay, quota, insert, and usage.
- Initialization, advancement, and finalization use production admission.
- Repository V1 and V1-only adapter behavior remain compatible.
- Before/after-commit batch crash boundaries pass after database reopen.
- Twelve-scenario repository conformance remains green.
- Exact 240-page physical/logical parity and real restart remain green.
- Physical quota cannot enter an unproductive retry loop.

## FAIL / BLOCKER

- No production worker, queue, route, or provider activation exists.
- No concurrent multi-job writer-contention evidence exists.
- `node:sqlite` remains a release-candidate Node API.
- No host power-loss, backup/restore, migration, corruption, or deployed
  filesystem evidence exists.
- No auth, tenancy, encryption, deletion audit, or operational observability is
  wired to composition storage.

## RISK

- Two head CAS transactions per accepted transition now dominate durable local
  write count.
- CAS losers can leave whole event batches unreachable until terminal cleanup.
- A physical quota block is safely terminal, but the current job cannot clean
  and resume itself automatically.
- SQLite writer serialization may degrade under concurrent composition jobs.
- V1-only adapters are compatibility/test paths and do not gain batch atomicity.

## UNKNOWN

- Accepted end-to-end composition SLA and concurrent job target.
- Final production database/provider and topology.
- Whether later payload sizes require object storage plus transactional indexes.
- Backup, restore, migration, retention, and disaster-recovery requirements.
- Whether blocked-job cleanup should support an audited replacement-job flow.

## Files Changed

- `src/composition/compositionSchedulerProductionRepository.ts`
- `src/composition/compositionSchedulerImmutableStaging.ts`
- `src/composition/compositionSchedulerSqliteImmutableStore.ts`
- `src/composition/compositionSchedulerSqliteRepository.ts`
- `src/composition/compositionSchedulerInitialization.ts`
- `src/composition/compositionSchedulerAdvancement.ts`
- `src/composition/compositionSchedulerFinalization.ts`
- `src/tests/compositionSchedulerSqliteRepository.test.ts`
- `src/tests/compositionSchedulerAdvancement.test.ts`
- `src/tests/helpers/compositionSchedulerScaleFixture.ts`
- `src/tests/compositionSchedulerScale.test.ts`
- `src/tests/compositionSchedulerSqliteScale.test.ts`
- `src/tests/durableCompositionSchedulerAtomicBatchDoc.test.ts`
- `src/index.ts`, `README.md`, this document, and core cross-repo records

## Behavior Changed

Complete production repositories now stage one scheduler event through exact
physical admission and one immutable transaction. V1-only repositories retain
the previous sequential writes. A production physical quota rejection blocks
the job terminally instead of publishing partial records or retrying forever.

## Tests Run

- focused initialization, advancement, finalization, repository, batch quota,
  replay, conflict, restart, and crash-boundary tests;
- independent-process twelve-scenario conformance runner;
- SQLite 240-page scale workload with a real connection reopen;
- backend type-check, build, and full test suite; and
- full core and editor gates before handoff.

## Risks Left

Atomic staging removes partial event batches and reduces immutable commit cost,
but does not prove concurrent production capacity or operational durability.
Production activation remains closed.

## Intentionally Not Changed

- core document/composition semantics and canonical package contracts;
- scheduler repository V1 method signatures;
- backend package engine floor or dependencies;
- current file JSON/package/artifact persistence;
- worker, queue, HTTP route, auth, tenancy, or deployment wiring;
- editor UI, progress, viewport, renderer, or export behavior; and
- final production storage selection.

## Next Recommended Direction

Phase 395 should run bounded concurrent multi-job SQLite evidence, measure busy
contention and fairness, and make an explicit provider qualification decision.
If SQLite misses the deployment target, reuse the Phase 392 conformance and
Phase 394 lifecycle workload against the selected transactional provider before
any worker or route activation.
