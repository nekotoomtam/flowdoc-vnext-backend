# Durable Composition Scheduler SQLite Candidate

Status: Phase 393 SQLite candidate and trusted local conformance runner pass.
Production scheduler activation remains blocked.

## Outcome

Phase 393 implements the first concrete transactional repository candidate for
the durable composition scheduler. It uses the Node `node:sqlite` API behind a
dynamic runtime gate, keeps the existing file JSON adapter unchanged, and
implements the V1 repository plus the Phase 392 production extension.

The candidate passes all twelve mandatory conformance scenarios through a
trusted Vitest runner that launches independent Node child processes, kills
workers immediately before and after SQLite commit, reopens the database from
disk, and assesses a persisted fingerprinted conformance report.

This is candidate evidence, not production activation. Node documents
`node:sqlite` as release-candidate stability beginning in Node 24.15, so the
factory requires Node 24.15 or newer while using a type-only import and dynamic
runtime import to avoid breaking the existing backend module surface on older
runtimes: <https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html>.

## Candidate Decision

SQLite was selected for the first candidate because this workspace can run it
without an external database service and can open the same durable file from
independent processes. Docker CLI exists locally, but no Docker engine was
available during this phase, so a containerized PostgreSQL gate would not have
been repeatable evidence.

The candidate does not change the backend package engine declaration or add a
native npm dependency. Calling its factory below Node 24.15 returns an explicit
runtime error; ordinary backend imports remain available.

## SQLite Configuration

Every connection applies:

- WAL journal mode;
- `synchronous = FULL` durability;
- foreign-key enforcement;
- extension loading disabled;
- defensive database defaults; and
- a bounded busy timeout, defaulting to five seconds.

Schema initialization creates strict tables for immutable records, physical
usage, job heads, transition replay entries, and finalization replay entries.
Immutable identity has both `(job_id, record_id)` primary uniqueness and
`(job_id, kind, record_fingerprint)` uniqueness.

## Transaction Boundary

`BEGIN IMMEDIATE` protects every first immutable write, head creation, head
CAS, and cleanup batch. Head CAS writes the head plus either transition replay
or finalization replay in the same transaction. Conditional revision and
fingerprint columns provide a final stale guard even after the current head was
validated.

The fault injector exposes only `before-commit` and `after-commit` around named
transaction kinds. A before-commit process exit leaves the prior head and no
replay row. An after-commit process exit retains the next head and exact replay
row after reopening.

## Repository Parity

The candidate retains strict source/manifest/head parsing, immutable byte and
fingerprint validation, create replay/conflict, stale CAS, terminal-state
guards, transition receipt reachability, output reachability, and exact
retention deltas. Focused parity tests use the same real core-backed fixture as
the in-memory repository.

Stored context rejects unknown properties. Cleanup aborts its transaction if
physical usage cannot be reduced exactly, preventing record deletion with a
drifted usage counter.

## Production Operations

`putImmutableWithPhysicalAdmission(...)` updates the unique record and physical
usage counter atomically. Concurrent first writes under one exact byte ceiling
produce one admitted write and one quota rejection.

`readImmutableBatch(...)` validates and returns exact refs in request order and
blocks the whole result on a missing or mismatched ref. Cleanup is terminal-job
only, checks the expected head fingerprint, protects the supplied reachable
set through a temporary table, applies an age cutoff, and deletes no more than
the bounded budget.

The scheduler V1 compatibility `putImmutable(...)` remains unbounded. Production
scheduler activation must be kept closed until initialization, advancement,
and finalization call the physical-admission path rather than the compatibility
method.

## Trusted Runner

`compositionSchedulerSqliteConformanceRunner.test.ts` launches separate Node
processes through the checked-in TSX dev runtime. Worker commands are limited
to head creation, head CAS, and admitted immutable writes. The runner proves:

- one atomic create and exact replay under independent processes;
- immutable record-id and fingerprint uniqueness;
- ordered all-or-blocked batch reads;
- one independent-process CAS winner;
- atomic transition head plus request replay;
- rollback on process exit before commit;
- durable replay on process exit after commit;
- process restart recovery of head, immutable record, and replay index;
- concurrent physical quota admission;
- terminal reachability-safe cleanup; and
- atomic finalization head plus both output replay refs.

The resulting report contains every Phase 392 scenario exactly once and passes
`assessFlowDocBackendCompositionRepositoryReadinessV1(...)` after being written
to disk and reopened.

## Scale Evidence

The SQLite candidate executes the same 240-page mixed-family workload as Phase
391:

- 479 accepted transitions across all six composition families;
- 240 pages, 240 placements, and 40 headings;
- 1,202 immutable records totaling 3,224,446 canonical JSON bytes;
- one real connection close and reopen before continuation;
- exact equality between physical usage and completed-head retention; and
- a maximum serialized head of 5,364 bytes.

With WAL and `synchronous = FULL`, the focused local run takes about 67 seconds,
compared with about 16 seconds for the in-memory Phase 391 path. Correctness and
durability are retained; the difference identifies transaction-per-record
fsync cost rather than a semantic failure.

## Performance Finding

One scheduler transition can stage a window, page chunk, and receipt through
three separate immutable transactions before the head CAS transaction. The
current production extension has bounded batch reads but no atomic admitted
batch-write operation. Lowering SQLite durability would hide this cost without
solving the contract shape.

The next optimization should add one bounded admitted immutable batch, keep
each record independently content-addressed, update physical usage once, and
retain the head CAS as the logical commit point. Its scale result must preserve
the exact Phase 391/393 record, byte, page, transition, and fingerprint facts.

## PASS

- Concrete SQLite candidate implements repository V1 and production methods.
- Dynamic runtime gating preserves the ordinary backend import boundary.
- Head/request and head/finalization transactions are atomic.
- Independent process CAS, crash-before, crash-after, and restart pass.
- Physical quota, ordered batch reads, and terminal cleanup pass.
- The persisted conformance report passes all twelve Phase 392 scenarios.
- The 240-page scheduler run survives a real connection restart with exact
  physical/logical accounting.

## FAIL / BLOCKER

- Production scheduler services still call compatibility `putImmutable(...)`.
- No admitted immutable batch-write contract or implementation exists.
- `node:sqlite` is still a release-candidate Node API.
- No host/power-loss, filesystem corruption, backup/restore, migration, or
  deployed database evidence exists.
- Worker queues, routes, auth, tenancy, encryption, and deletion audit remain
  inactive.

## RISK

- Transaction-per-record durability costs about four times the in-memory local
  scale baseline.
- A process-crash test does not prove host power-loss durability.
- SQLite serializes writers and may not fit later high-concurrency deployment.
- Cleanup still depends on a trusted reachable set derived from one validated
  terminal head.
- TSX is a development runner dependency, not a production worker runtime.

## UNKNOWN

- Final production database technology and horizontal scaling needs.
- Target storage latency, concurrent job count, and accepted composition SLA.
- Host filesystem durability, backup, restore, migration, and observability
  requirements.
- Whether large immutable payloads later move to object storage while SQLite or
  another transactional database retains indexes and heads.

## Files Changed

- `src/composition/compositionSchedulerSqliteSupport.ts`
- `src/composition/compositionSchedulerSqliteImmutableStore.ts`
- `src/composition/compositionSchedulerSqliteHeadStore.ts`
- `src/composition/compositionSchedulerSqliteMaintenance.ts`
- `src/composition/compositionSchedulerSqliteRepository.ts`
- `src/tests/compositionSchedulerSqliteRepository.test.ts`
- `src/tests/helpers/compositionSchedulerSqliteConformanceWorker.ts`
- `src/tests/compositionSchedulerSqliteConformanceRunner.test.ts`
- `src/tests/compositionSchedulerSqliteScale.test.ts`
- `src/tests/helpers/compositionSchedulerScaleFixture.ts`
- `src/tests/durableCompositionSchedulerSqliteCandidateDoc.test.ts`
- `src/index.ts`, `README.md`, this document, and core cross-repo records

## Behavior Changed

Backend callers on Node 24.15 or newer can explicitly create a SQLite
composition repository candidate. Existing in-memory, file JSON, scheduler,
HTTP, editor, renderer, and export behavior is unchanged.

## Tests Run

- SQLite runtime-floor, V1 parity, connection restart, replay, batch, quota,
  cleanup, and independent-handle tests.
- Trusted child-process twelve-scenario conformance runner with before/after
  commit process termination.
- SQLite 240-page mixed-family scale run with mid-run connection reopen.
- Existing scheduler repository/lifecycle/initialization/advancement/
  finalization focused regressions.
- Full backend, core, and editor gates before handoff.

## Risks Left

The candidate proves the locked contract locally but is not yet efficient or
operationally proven enough for production activation. Physical admission must
become part of scheduler writes before quotas can be claimed end to end.

## Intentionally Not Changed

- core composition or canonical document semantics;
- current file JSON/package/artifact adapters;
- backend package engine floor or npm dependencies;
- scheduler route/worker activation and provider deployment;
- editor source, UX, progress, viewport, or WYSIWYG behavior;
- renderer/export, artifact bytes, auth, tenancy, or deployment; and
- final production database selection.

## Next Recommended Direction

Phase 394 should add a bounded atomic admitted immutable batch and wire
initialization, advancement, and finalization to production admission without
changing repository V1 semantics. Re-run the twelve-scenario gate and 240-page
scale test before any route or worker activation; then decide whether SQLite's
writer model meets the deployment target or whether the same conformance suite
must qualify PostgreSQL or another transactional adapter.
