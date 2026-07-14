# Durable Composition Scheduler Worker Runner

Status: Phase 399 one-step durable worker runner passes. Due-work discovery,
queue, provider, route, and production activation remain blocked.

## Outcome

Phase 399 composes the Phase 397 storage-attempt state machine with the Phase
398 durable journal. A backend caller can run one exact attempt id through one
bounded step:

1. read the retained journal entry;
2. atomically claim it;
3. durably mark execution start;
4. perform one reconcile or retry action; and
5. release one next state or complete one terminal outcome.

The runner never scans, sleeps, schedules itself, creates a queue message, or
opens an HTTP route. Its clock, claim identity, journal repository, and
composition repository are explicit dependencies.

## Durable Execution Marker

Claim ownership alone cannot prove whether a crashed worker invoked a retry.
Phase 399 therefore adds an execution receipt to a claimed journal entry before
the runner touches composition storage. It retains:

- exact claim token and worker id;
- `reconcile` or `retry-ready` phase;
- the journal revision from which execution started; and
- exact execution-start time inside the claim window.

Start is an atomic journal transition with exact replay. Release and completion
now require this marker as well as the active claim. SQLite faults before and
after start commit retain either an unstarted claim or the complete execution
receipt; neither side creates a partial marker.

## Interrupted Retry Recovery

If a retry execution marker survives until claim expiry, the old worker may
have committed its head write even when no journal outcome exists. A reclaiming
runner does not invoke that write again. It conservatively converts the exact
retry-ready state into a reconcile state whose completed write count includes
the interrupted attempt, then releases it for evidence inspection.

This can consume an attempt when the old process failed after recording start
but before invoking storage. That conservative ambiguity is intentional: a
false bounded exhaustion is safer than an unproven duplicate write. A later
reconcile distinguishes committed, retryable, superseded, conflict, failed, or
exhausted evidence without guessing.

Interrupted reconcile reads are safe to repeat because they do not mutate the
head. Claims that expire before execution start can also be reclaimed without
converting the state.

## One-Step Mapping

| State/action result | Journal decision |
| --- | --- |
| reconcile `retry-ready` | release exact retry-ready state |
| reconcile `reconciliation-unavailable` | release deferred reconcile state |
| retry `unavailable` | release exact reconcile state |
| committed | complete `committed` |
| superseded | complete `superseded` |
| conflict | complete `conflict` |
| exhausted | complete `exhausted` |
| reconciliation-exhausted | complete `reconciliation-exhausted` |
| failed or blocked execution decision | complete `failed` |

Terminal result fingerprints bind attempt, mutation, action, outcome status,
state, observed head fingerprint, and exact issues. A completed entry replays
without claiming or touching the composition repository.

## Ownership And Timing

- One invocation performs no more than one reconcile read or one head write.
- Two workers admit one active claimant and one composition action.
- Duplicate delivery with the same claim token cannot execute in parallel.
- Claim and execution times must be exact ISO values inside a maximum
  five-minute claim.
- Release/completion at or after expiry is rejected as ownership loss.
- Unexpected execution interruption leaves the durable marker for later safe
  reclaim instead of inventing an outcome.

## SQLite Restart Evidence

The SQLite journal adds an atomic `worker-journal-start` transaction. Tests
fault this transition on both sides of commit. Runner-level evidence also
injects an after-commit completion failure, closes the connection, reopens the
database, and observes terminal replay without another composition write.

## PASS

- One attempt id drives one bounded runner step.
- Claim, execution start, release, and completion retain exact ownership.
- Reconcile and retry outcomes map to deterministic journal decisions.
- Duplicate and competing runners perform one composition action.
- Expired in-flight retry is reconciled before any later write.
- Successful retry followed by ownership loss is recovered with one total
  write and one terminal committed outcome.
- All terminal mappings are immutable and replayable.
- SQLite execution-start and terminal restart boundaries pass.

## FAIL / BLOCKER

- No due-work list, scan, notification, polling loop, or wake-up scheduler.
- No claim renewal for work approaching the five-minute limit.
- No external queue, dead-letter policy, production provider, route, auth,
  tenancy, deployment, or worker process is activated.
- SQLite still fails the Phase 395 provisional concurrent throughput target.

## RISK

- A start marker can commit immediately before a process dies without invoking
  storage. Recovery conservatively counts that attempt as possibly executed.
- Runner time trusts its injected backend clock; distributed activation still
  needs provider/server clock policy and skew evidence.
- Journal and composition storage may be different providers. The marker and
  reconcile protocol provide safety, but measured failure latency is unknown.
- Repeated unexpected execution interruption can leave work claimed until
  expiry; operator observability is not implemented yet.

## UNKNOWN

- Production provider topology and whether journal/head share a database.
- Due-work selection ordering, batch size, fairness, and wake-up mechanism.
- Claim duration/renewal values under measured large-document workloads.
- Queue visibility, jitter, redelivery, dead-letter, and operator workflow.

## Files Changed

- `src/composition/compositionSchedulerWorkerRunner.ts`
- `src/composition/compositionSchedulerWorkerAttempt.ts`
- `src/composition/compositionSchedulerWorkerJournalContract.ts`
- `src/composition/compositionSchedulerWorkerJournalRepository.ts`
- `src/composition/compositionSchedulerSqliteWorkerJournalStore.ts`
- `src/composition/compositionSchedulerSqliteRepository.ts`
- `src/composition/compositionSchedulerSqliteSupport.ts`
- `src/tests/compositionSchedulerWorkerRunner.test.ts`
- `src/tests/compositionSchedulerWorkerJournal.test.ts`
- `src/index.ts`, `README.md`, this document, and core cross-repo records

## Behavior Changed

Backend can execute one explicitly addressed durable worker attempt through one
reconcile/retry step and persist its exact next or terminal decision. Journal
release/completion now require a durable execution marker. Existing scheduler
semantics, HTTP behavior, core packages, and editor behavior do not change.

## Tests Run

- reconcile to retry-ready, one retry write, completion, and terminal replay;
- unavailable reconciliation through separate read-failure exhaustion;
- committed, exhausted, conflict, failed, superseded, and reconciliation-
  exhausted terminal mappings;
- different-token competition and same-token duplicate delivery;
- ownership expiry after a committed retry and reconcile-first recovery;
- SQLite start faults before/after commit and completion restart replay; and
- full backend, core, and editor gates before handoff.

## Risks Left

The runner is safe when explicitly invoked for one attempt id, but production
work cannot yet be discovered or dispatched. Activation remains closed until a
bounded due-work contract and observable invocation boundary exist.

## Intentionally Not Changed

- core document/composition semantics and package contracts;
- scheduler initialization, advancement, finalization, and lifecycle APIs;
- due-work polling, queue/provider selection, routes, auth, and deployment;
- editor, renderer, export, and artifact behavior; and
- SQLite durability settings or Phase 395 throughput qualification.

## Next Recommended Direction

Phase 400 should define bounded due-work discovery and runner observability:
ordered pending selection by exact not-before time, a hard batch limit, no
claim side effects during listing, and explicit counts for deferred, busy,
released, completed, ownership-lost, and exhausted work. It should remain an
injectable backend boundary without activating an external queue or route.
