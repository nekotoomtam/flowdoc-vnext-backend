# Durable Composition Scheduler Concurrency Qualification

Status: Phase 395 local concurrency evidence passes. SQLite production
activation qualification fails and remains closed.

## Outcome

Phase 395 runs independent composition processes against one SQLite database,
measures writer contention and fairness, verifies per-job accounting and
connection restart isolation, and exercises an explicit writer-timeout path.

The candidate preserves correctness under the tested load, but it does not meet
the provisional throughput target and its head-write contract cannot represent
a transient storage outage without a rejected exception. SQLite therefore
remains a local transactional candidate rather than an activated production
provider.

## Qualification Workload

The committed gate launches four independent Node child processes behind one
start barrier. Each process opens its own SQLite connection and composes 60
pages across all six composition families on one shared database file.

Combined evidence covers:

- 240 pages split across four independently owned jobs;
- 476 accepted transitions;
- 1,208 immutable records;
- 484 admitted immutable batch transactions;
- four distinct process ids and job ids;
- one real mid-run connection close and reopen while the other jobs continue;
  and
- exact per-job physical usage equal to each completed head's logical
  retention.

A separate single-process 60-page run provides the same-machine baseline.
The worker harness supports job-scoped manifest, package, and scheduler ids
without changing the existing Phase 391/394 default fixture or byte evidence.

## Correctness And Isolation

Every concurrent job completes 60 pages, 119 transitions, 302 retained records,
and 121 immutable batches. All six families occur in each job. No process shares
a job id, request owner, source pin, head, replay index, or usage counter.

One worker reopens its database connection at the midpoint and resumes from the
retained head while the other three keep writing. Final physical record/byte
usage remains exact for all four jobs.

## Fairness Evidence

Repeated local runs complete all workers without a busy failure or starvation.
Observed worker elapsed-time ratios ranged from about 1.10 to 1.35 between the
slowest and fastest worker. Completion spread ranged from about 1.6 to 4.5
seconds. The committed hard guard permits a ratio below 2 and a bounded
completion spread.

This proves bounded local fairness for four processes. It does not prove a
service-level objective, arbitrary process counts, cross-host access, or a
provider fairness guarantee.

## Throughput Evidence

The same-machine 60-page baseline takes about 2.28 seconds. Four simultaneous
60-page jobs on one SQLite file take about 17.4 to 17.8 seconds wall time, or
about 7.6 to 7.8 baseline multiples.

The provisional qualification target was at most six baseline multiples for
four jobs. The result fails that target. The automated safety guard remains ten
multiples so the correctness suite detects unbounded regressions without
misrepresenting the six-multiple provider decision as a pass.

SQLite serializes writers, and the observed shared-writer workload costs about
1.9 times the simple four-baseline serialized duration. Lowering FULL
synchronous durability was intentionally not used to improve this number.

## Busy Timeout Evidence

A dedicated child process holds `BEGIN IMMEDIATE` while a second connection has
a 100 ms busy timeout. Immutable batch admission returns a typed
`storage-error` with `composition-sqlite-busy`, retains zero records, and leaves
no physical usage after the bounded wait. SQLite busy detection is limited to
the provider-specific locked-database error and does not swallow injected crash
faults or unrelated storage failures.

The same lock forces `createHead(...)` to reject with `database is locked` after
the timeout. No partial head is retained. Repository V1 head create/CAS result
types have no transient storage status, so mapping that rejection to `invalid`,
`conflict`, or `stale` would be semantically false.

## Provider Decision

SQLite is **not qualified for production scheduler activation** in Phase 395.
It remains useful for deterministic local durability, crash, restart, and
conformance evidence.

Qualification is blocked by:

1. the failed provisional four-job throughput target; and
2. the missing provider-neutral transient availability contract around head
   create and compare-and-swap.

Worker queues and routes must remain closed. Selecting another provider before
fixing the availability contract would reproduce the same ambiguity whenever
that provider times out or loses a connection.

## PASS

- Four independent processes complete on one SQLite database.
- Every job retains exact pages, transitions, records, bytes, and families.
- Job identity, replay, head, and usage isolation pass.
- One connection restart during concurrent writes passes.
- Local fairness and no-starvation guards pass.
- Immutable busy timeout is bounded, typed, and partial-write free.
- Existing SQLite replay/crash/conformance behavior remains intact.

## FAIL / BLOCKER

- Four-job wall time is about 7.6 to 7.8 baseline multiples against a target of
  at most six.
- Head create/CAS busy timeout still rejects outside a typed repository result.
- SQLite production-provider qualification fails.
- Worker, queue, route, and provider activation remain blocked.
- No cross-host, deployed filesystem, power-loss, backup, or restore evidence
  exists.

## RISK

- Longer or more numerous jobs may amplify writer wait and completion spread.
- A head-write timeout currently requires an outer exception boundary to avoid
  terminating a worker invocation.
- SQLite's single-writer model cannot provide horizontal database access.
- Machine-local timing is evidence, not a production SLA.
- Aggressive retries could increase contention without a pinned backoff policy.

## UNKNOWN

- Required concurrent job count, latency percentile, throughput, and queue SLA.
- Final provider, topology, and deployment environment.
- Accepted transient retry budget and worker lease interaction.
- Backup, restore, migration, retention, and disaster-recovery requirements.
- Whether a tuned SQLite deployment could meet a later explicit low-concurrency
  target.

## Files Changed

- `src/composition/compositionSchedulerSqliteSupport.ts`
- `src/composition/compositionSchedulerSqliteRepository.ts`
- `src/tests/helpers/compositionSchedulerScaleFixture.ts`
- `src/tests/helpers/compositionSchedulerSqliteConcurrencyWorker.ts`
- `src/tests/helpers/compositionSchedulerSqliteLockWorker.ts`
- `src/tests/compositionSchedulerSqliteConcurrency.test.ts`
- `src/tests/durableCompositionSchedulerConcurrencyQualificationDoc.test.ts`
- `README.md`, this document, and core cross-repo records

## Behavior Changed

SQLite production immutable admission now converts a bounded locked-database
timeout into its declared `storage-error` result without hiding unrelated
exceptions. Existing repository V1 head behavior and default scale fixture
identities remain unchanged.

## Tests Run

- four-process shared-database 60-page workload plus single-process baseline;
- per-job family, transition, batch, record, byte, and usage assertions;
- concurrent mid-run connection reopen;
- 100 ms immutable and head-create writer-timeout evidence;
- focused SQLite repository, scale, crash, and conformance regressions; and
- full backend, core, and editor gates before handoff.

## Risks Left

The local candidate is safe under the bounded tested concurrency but is not
operationally or contractually ready for production activation.

## Intentionally Not Changed

- repository V1 head result statuses;
- core composition or canonical document semantics;
- backend engine floor, dependencies, queue, worker, and HTTP routes;
- auth, tenancy, encryption, deployment, backup, or restore;
- editor, renderer, export, and artifact behavior; and
- final production provider selection.

## Next Recommended Direction

Phase 396 should define a provider-neutral transient availability and retry
contract for head create/CAS and scheduler invocation boundaries. It must pin
retryability, lease safety, idempotency, backoff, and exhausted-retry outcomes.
Only after that contract passes should SQLite be retested against an explicit
low-concurrency SLA or another transactional provider enter the Phase 392/394/
395 qualification suite.
