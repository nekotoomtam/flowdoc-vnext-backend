# Durable Composition Scheduler Due-Batch Qualification

Status: Phase 401 independent-process SQLite candidate qualification. Worker
lifecycle, wake-up policy, provider selection, route, and production activation
remain blocked.

## Outcome

Phase 401 qualifies the Phase 400 bounded due batch against four independent
Node processes and four separately opened SQLite connections. All consumers
intentionally read the same 12-attempt page before any runner may claim work.
This forced shared-page case distinguishes two different facts:

- duplicate observation is expected because discovery is read-only; and
- duplicate execution is forbidden because journal claim ownership is atomic.

The existing Phase 398-400 runtime contracts pass this gate without production
source changes. Qualification adds child-process evidence and documentation,
not a polling loop or a new claim primitive.

## Qualification Fixture

The test creates 12 journal attempts over distinct mutation identities. Each
attempt is first advanced from `reconcile` to `retry-ready`, leaving the shared
composition head absent. One attempt then receives a claim from a process that
disappears before execution; that claim expires exactly at the qualification
observation time.

The seeding repository closes before worker processes start. One of the four
workers also closes and reopens its own connection immediately before listing.
This gives explicit parent restart and worker-handle restart evidence without
sharing in-memory journal or repository state.

Each child process:

1. opens the same SQLite file with its own connection;
2. waits at a process start barrier;
3. lists one bounded 12-attempt due page;
4. waits at a post-list barrier until all four pages are retained;
5. invokes the exact Phase 400 batch once; and
6. returns its fingerprinted batch report and attempt outcomes as JSON.

A test-only 100 ms delay wraps availability-aware head writes. It represents
non-zero storage work and gives competing owners time to advance to later
attempts. It does not alter claim, journal, due-list, or composition semantics.

## Correctness Gate

The forced page produces exactly 48 list observations: 12 unique attempts
observed by four processes. Therefore 36 observations are duplicates by
design. Across those observations:

- exactly 12 runner outcomes own completion, one per attempt;
- the other 36 outcomes are only terminal replay, busy, or ownership loss;
- no released, deferred, blocked, unavailable, interrupted, or missing outcome
  is accepted;
- owner terminals are exactly one `committed` and 11 `conflict` outcomes;
- report terminal observations may be higher because terminal replay retains
  the immutable terminal status; and
- a fresh restart scan returns no completed attempt.

Normal attempts finish at journal revision 6: preparation claim/start/release,
then qualification claim/start/complete. The expired-claim attempt finishes at
revision 7 because reclaim adds one ownership transition. Exact revisions and
the final completed status prove that no hidden second execution transition was
accepted.

## Fairness And Bounded Work

Every process must own at least one completion in the delayed contention
fixture. The difference between the largest and smallest owner count is bounded
to three. This is qualification fairness under one controlled workload, not a
general scheduler guarantee.

The gate additionally requires:

- one page and 12 invocations per process;
- no cursor following, loop, sleep policy, or later-page fetch;
- wall time below 20 seconds; and
- effective unique completion throughput above 0.5 attempts per second while
  the test injects 100 ms of storage delay per owning action.

The test fingerprints process count, attempt count, list and duplicate
observations, completion owners, per-worker owner counts, owner terminals,
terminal observations, and wall time. Runtime batch reports retain their own
independently verified fingerprints.

## PASS

- Four real child processes use independent SQLite handles.
- All four retain the same due page before claims begin.
- Duplicate discovery remains read-only and bounded.
- Atomic claim ownership admits one execution owner per attempt.
- One expired unstarted claim is reclaimed and completed exactly once.
- Parent close/reopen and one worker close/reopen retain exact journal state.
- Owner terminal facts remain separate from terminal replay observations.
- Every process wins work in the controlled fairness fixture.
- Latency and effective throughput stay inside explicit candidate bounds.
- Two consecutive focused qualification runs pass.

## FAIL / BLOCKER

- No lifecycle loop requests a later page or fresh scan.
- No wake-up, polling interval, backoff, jitter, cancellation, drain, or
  graceful shutdown contract exists.
- No process-crash injection occurs after a real multi-process execution start;
  Phase 399 retains bounded single-runner interrupted-execution evidence.
- No production provider, queue, route, auth, tenancy, deployment, or operator
  workflow is activated.
- SQLite remains a candidate and still does not satisfy the Phase 395
  provisional concurrent throughput target.

## RISK

- The post-list barrier forces a worst-case duplicate page but is test
  coordination, not a production worker topology.
- Fairness depends on non-zero task duration. Near-instant work may let one
  process win most attempts without violating correctness.
- Batch reports count terminal replay terminal statuses for observability;
  operators must not interpret those counts as unique executions.
- The broad latency and throughput bounds prevent hangs and major regressions;
  they are not capacity planning or an SLA.
- All process clocks use one exact timestamp. Distributed clock skew remains a
  production design requirement.

## UNKNOWN

- Fairness and duplicate observation rate under real document workloads.
- Production database/provider atomic-claim and index behavior.
- Wake-up topology, idle delay, jitter, cancellation, draining, and deployment.
- Multi-process crash timing after execution start and before release/complete.
- Hardware-specific saturation, queue depth, and operational alert thresholds.

## Files Changed

- `src/tests/helpers/compositionSchedulerDueBatchWorker.ts`
- `src/tests/compositionSchedulerDueBatchConcurrency.test.ts`
- `src/tests/durableCompositionSchedulerDueBatchQualificationDoc.test.ts`
- `README.md`, this document, and core cross-repo records

## Behavior Changed

No production runtime behavior changes. The backend now has committed evidence
that independent SQLite due-batch consumers retain one execution owner under a
forced shared-page race, expiry reclaim, and restart.

## Tests Run

- two consecutive focused child-process qualification runs;
- exact 48-observation/12-owner/36-non-owner outcome accounting;
- exact one committed and 11 conflict owner terminals;
- controlled fairness, latency, and effective throughput guards;
- expired-claim revision and normal revision evidence;
- post-completion restart scan; and
- full backend, core, and editor gates before handoff.

## Risks Left

The candidate has bounded multi-process correctness evidence, but it is not a
continuously running worker. Production activation remains closed until worker
lifecycle and wake-up/shutdown policy are explicit and provider qualification
is addressed.

## Intentionally Not Changed

- due-list, batch-runner, worker-journal, and composition runtime contracts;
- core document/composition semantics and package contracts;
- process loop, polling, queue/provider selection, routes, auth, and tenancy;
- editor, renderer, export, and artifact behavior; and
- SQLite durability settings or Phase 395 throughput thresholds.

## Next Recommended Direction

Phase 402 should lock the worker lifecycle and wake-up boundary around one
bounded batch invocation. Define fresh-scan versus cursor rules, idle delay,
jitter, cancellation, drain, graceful shutdown, clock policy, and observable
stop reasons before implementing any automatic loop.
