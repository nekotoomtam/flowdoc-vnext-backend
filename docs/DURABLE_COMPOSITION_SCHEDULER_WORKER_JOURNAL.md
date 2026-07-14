# Durable Composition Scheduler Worker Journal

Status: Phase 398 durable worker-attempt journal and atomic ownership pass.
Runner, queue, provider, route, and production activation remain blocked.

## Outcome

Phase 398 persists the exact Phase 397 mutation and fingerprinted storage-
attempt state as one backend-owned journal entry. The journal survives process
restart and gives one worker an atomic, expiring claim before reconciliation or
retry work can begin.

The journal is a separate repository responsibility from document heads. It
does not move scheduling, queue transport, HTTP, or concrete storage behavior
into core.

## Entry Contract

Each `composition-worker-journal-entry` retains:

- one stable attempt id and idempotent creation request identity;
- exact job and mutation fingerprints plus the complete mutation;
- the complete Phase 397 `reconcile` or `retry-ready` state;
- a monotonic journal revision;
- `pending`, `claimed`, or `completed` status;
- an optional bounded active claim or immutable terminal outcome; and
- canonical creation/update times and a fingerprint over every entry fact.

One mutation fingerprint can belong to only one attempt id. Exact creation is
an idempotent replay; reused attempt or mutation identity with different facts
is a conflict. Parsing rejects edited state, mutation drift, index mismatch,
invalid times, and fingerprint drift.

## Atomic Ownership

Claim uses expected journal revision, claim token, worker id, claim time, and
expiry. A claim lasts at most five minutes and cannot begin before the exact
state `notBefore` time.

- one active claimant wins;
- exact claim redelivery replays without another revision;
- a competing worker receives `busy` or `stale`;
- an expired claim may be reclaimed with a new token and revision; and
- the expired owner cannot release or complete the reclaimed entry.

Release requires the exact live claim and one valid Phase 397 state transition.
It returns the entry to `pending` with a new revision. Completion requires the
same ownership proof and records one immutable terminal status and result
fingerprint. Exact release/completion redelivery is idempotent.

## SQLite Candidate

SQLite stores canonical entry JSON beside indexed attempt id, job id, mutation
fingerprint, journal revision, status, and entry fingerprint. Every create,
claim, release, and complete transition runs under `BEGIN IMMEDIATE` and updates
the prior row by exact revision and fingerprint.

Tests prove:

- two repository handles admit one claimant;
- close/reopen retains the active claim;
- before/after-commit claim failure retains pending or claimed respectively;
- before/after-commit release failure retains claimed or pending respectively;
- before/after-commit completion retains claimed or completed respectively; and
- replay after every crash side reaches one logical transition.

The SQLite table is local candidate evidence, not production provider approval.

## PASS

- Exact mutation and Phase 397 state are durable together.
- Duplicate creation and operation delivery have deterministic replay.
- One mutation cannot fork into multiple attempt identities.
- Claim scheduling, maximum duration, revision, and token are enforced.
- Active competition, expiry reclaim, and stale-owner rejection pass.
- Terminal outcomes are immutable and ownership-bound.
- In-memory and SQLite repositories expose the same journal boundary.
- SQLite restart and both commit crash sides preserve one logical outcome.

## FAIL / BLOCKER

- No runner turns a claimed entry into reconcile/retry execution yet.
- No scan/notification API selects due pending entries.
- No external queue, dead-letter policy, provider, route, auth, or tenancy is
  selected or activated.
- SQLite still fails the Phase 395 provisional concurrent throughput target.

## RISK

- Claim times currently trust the backend worker clock; distributed activation
  needs a provider/server clock policy.
- There is no claim renewal. Work must finish within five minutes or a future
  runner must add a bounded renewal contract before long operations activate.
- Terminal status stores a result fingerprint, not an operator-readable result
  record; observability remains a later responsibility.
- A future due-work index must not turn polling order into document semantics.

## UNKNOWN

- Production database/provider and its atomic claim primitive.
- Queue visibility, redelivery, jitter, dead-letter, and wake-up policy.
- Claim duration and renewal policy under measured production workloads.
- Operator handling for failed, exhausted, and reconciliation-exhausted work.

## Files Changed

- `src/composition/compositionSchedulerWorkerAttempt.ts`
- `src/composition/compositionSchedulerWorkerJournalContract.ts`
- `src/composition/compositionSchedulerWorkerJournalRepository.ts`
- `src/composition/compositionSchedulerSqliteWorkerJournalStore.ts`
- `src/composition/compositionSchedulerSqliteSupport.ts`
- `src/composition/compositionSchedulerSqliteRepository.ts`
- `src/tests/compositionSchedulerWorkerJournal.test.ts`
- `src/index.ts`, `README.md`, this document, and core cross-repo records

## Behavior Changed

Backend can create, read, atomically claim, safely release, reclaim after
expiry, and terminally complete one durable worker attempt. Existing scheduler,
head repository, core semantics, HTTP behavior, and editor behavior do not
change.

## Tests Run

- exact creation replay and identity conflicts;
- scheduled/deferred claim and competing worker ownership;
- release replay, expiry reclaim, stale owner, completion, and terminal replay;
- SQLite two-handle contention and close/reopen persistence;
- SQLite claim, release, and completion faults before and after commit; and
- full backend, core, and editor gates before handoff.

## Risks Left

The journal can safely own work, but nothing executes that work or discovers
due entries yet. Production activation stays closed until a runner composes the
journal with the Phase 397 state machine and exposes bounded observability.

## Intentionally Not Changed

- core document/composition semantics and package contracts;
- scheduler initialization, advancement, finalization, and lifecycle results;
- queue/provider selection, worker process, routes, auth, and deployment;
- editor, renderer, export, and artifact behavior; and
- SQLite durability settings or Phase 395 throughput qualification.

## Next Recommended Direction

Phase 399 should add a backend-owned runner function that accepts one attempt
id, atomically claims it, invokes exactly one Phase 397 reconcile or retry step,
then releases or completes the journal entry. It should prove duplicate runner
delivery, stale claim loss, all terminal mappings, and crash-safe replay while
leaving due-work polling and external queue activation closed.
