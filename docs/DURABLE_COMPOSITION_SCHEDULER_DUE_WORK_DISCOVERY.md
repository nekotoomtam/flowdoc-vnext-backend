# Durable Composition Scheduler Due-Work Discovery

Status: Phase 400 bounded due-work discovery and runner observability pass.
Worker loop, external queue, provider, route, and production activation remain
blocked.

## Outcome

Phase 400 adds a read-only journal discovery contract and one bounded batch
invocation boundary around the Phase 399 runner. A caller may:

1. observe one exact time;
2. list at most 64 due attempts in stable keyset order;
3. invoke those attempts sequentially through the one-step runner; and
4. retain a fingerprinted report of exact runner and terminal counts.

The batch never follows its own cursor, loops, sleeps, polls, or sends queue
messages. Listing never claims or changes a journal revision.

## Due Semantics

`dueAt` has one meaning per discoverable journal state:

- pending entry: the Phase 397 state `notBefore` time;
- claimed entry: active claim `expiresAt`, making only expired claims
  discoverable for reclaim; and
- completed entry: not discoverable.

This distinction prevents active workers from appearing as due while ensuring
that a crashed claimed attempt does not disappear permanently.

Discovery orders by `(dueAt, attemptId)` ascending. The optional cursor retains
that exact pair and selects values strictly after it. The result returns at
most the requested count and exposes another cursor only when an additional
row was observed. Request count is bounded from 1 through 64.

The cursor is a keyset continuation, not a durable queue offset or snapshot.
Concurrent claim/release/complete transitions may move entries between pages;
a later fresh scan from the beginning remains responsible for newly due work.

## Side-Effect Boundary

`listDueWorkerAttempts(...)` only returns cloned canonical entries. It does not:

- claim, reclaim, start, release, or complete an attempt;
- change journal revision, fingerprint, state, or timing;
- inspect or mutate a document head; or
- run the worker automatically.

In-memory tests compare exact entries before and after listing. SQLite listing
uses a read query and the same canonical row parser as direct journal reads.

## SQLite Projection And Migration

Canonical journal JSON remains source of truth. SQLite adds two checked/indexed
projections:

- `discoverable`: 1 for pending/claimed and 0 for completed;
- `due_at`: pending `notBefore`, claimed `expiresAt`, or retained state schedule
  for a completed non-discoverable row.

Every journal transition updates these columns in the same exact transaction
as entry JSON, revision, status, and fingerprint. Row parsing rejects any
projection mismatch.

The index `(discoverable, due_at, attempt_id)` supports the bounded keyset
query without sorting pending and expired-claim lanes after the scan. Test
evidence checks SQLite `EXPLAIN QUERY PLAN` selects this index.

Opening a Phase 399 candidate table adds and backfills both projections from
structured JSON paths inside one migration transaction. Open fails if any row
cannot produce a complete schedule projection.

## Bounded Batch And Report

`runFlowDocBackendCompositionDueWorkerBatchV1(...)` lists one page and invokes
each selected attempt sequentially. Claim tokens are deterministic
fingerprints of run, worker, attempt, and listed-entry identity.

The report retains:

- run/worker identity, observation time, limit, listed/invoked counts, and
  optional next cursor;
- released, completed, terminal-replay, deferred, busy, ownership-lost,
  blocked, journal-unavailable, execution-interrupted, and not-found counts;
- committed, superseded, conflict, exhausted, failed, and reconciliation-
  exhausted terminal counts; and
- a fingerprint over every report fact.

Individual runner failures stay visible in the returned attempt results and
counts; they do not cause the batch to invent a successful aggregate outcome.

## PASS

- Pending `notBefore` and expired-claim `expiresAt` discovery are explicit.
- Active claims and completed attempts are excluded.
- Keyset ordering and cursor continuation are deterministic.
- Listing has a hard maximum of 64 returned attempts.
- Listing leaves journal entries byte-for-byte unchanged.
- SQLite projections update atomically through runner transitions and restart.
- Phase 399 schema backfill and indexed query-plan evidence pass.
- One bounded batch reports released and exhausted work exactly.
- Report counts and fingerprint are deterministic.

## FAIL / BLOCKER

- No process loop follows the cursor or requests a later batch.
- No wake-up, sleep, polling interval, cancellation, or graceful shutdown
  policy exists.
- No multi-process due-batch fairness/throughput qualification exists yet.
- No external queue, dead-letter policy, production provider, route, auth,
  tenancy, deployment, or worker process is activated.
- SQLite still fails the Phase 395 provisional concurrent throughput target.

## RISK

- Keyset pages are not one database snapshot. Concurrent state movement can
  postpone an entry until a later fresh scan, though it cannot make the entry
  semantically completed or claimed through listing.
- In-memory discovery sorts its complete map and is test evidence only; the
  SQLite candidate owns indexed bounded discovery evidence.
- Sequential batch execution bounds pressure but a slow attempt delays later
  entries in the same page.
- Discovery and runner clocks still require distributed skew policy before
  production activation.
- Candidate schema migration is locally tested but is not a production rollout
  or rollback plan.

## UNKNOWN

- Multi-process batch fairness, duplicate scan rate, and measured throughput.
- Production provider topology and index/claim primitives.
- Wake-up mechanism, idle delay, cancellation, shutdown, and deployment model.
- Queue visibility, jitter, redelivery, dead-letter, and operator workflow.

## Files Changed

- `src/composition/compositionSchedulerWorkerDueContract.ts`
- `src/composition/compositionSchedulerWorkerBatchRunner.ts`
- `src/composition/compositionSchedulerWorkerJournalRepository.ts`
- `src/composition/compositionSchedulerSqliteWorkerJournalStore.ts`
- `src/composition/compositionSchedulerSqliteRepository.ts`
- `src/composition/compositionSchedulerSqliteSupport.ts`
- `src/tests/compositionSchedulerWorkerDue.test.ts`
- `src/index.ts`, `README.md`, this document, and core cross-repo records

## Behavior Changed

Backend can list a bounded read-only page of pending or reclaimable attempts and
invoke that page through Phase 399 with exact aggregate observability. Existing
explicit one-attempt runner calls, composition semantics, HTTP behavior, core
packages, and editor behavior do not change.

## Tests Run

- pending ordering, equal-time tie break, cursor continuation, and hard limit;
- listing no-side-effect evidence;
- active versus expired claim discovery;
- SQLite schedule projection updates before/after retry timing and claim expiry;
- SQLite close/reopen, Phase 399 schema backfill, and due-index query plan;
- bounded sequential released/exhausted batch and exact report fingerprint;
- full backend, core, and editor gates before handoff.

## Risks Left

The backend can discover and invoke one explicit bounded page, but it is not a
running worker service. Production activation remains closed until concurrent
batch qualification and an explicit lifecycle/wake-up boundary pass.

## Intentionally Not Changed

- core document/composition semantics and package contracts;
- scheduler initialization, advancement, finalization, and lifecycle APIs;
- process loop, polling, wake-up, queue/provider selection, routes, and auth;
- editor, renderer, export, and artifact behavior; and
- SQLite durability settings or Phase 395 throughput qualification.

## Next Recommended Direction

Phase 401 should qualify multiple independent due-batch consumers against the
SQLite candidate. It should measure duplicate scans, one-owner execution,
fairness, expired-claim recovery, restart isolation, bounded page latency, and
throughput before any worker loop or external queue is selected.
