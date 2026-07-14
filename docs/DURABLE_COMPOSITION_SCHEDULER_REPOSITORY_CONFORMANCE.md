# Durable Composition Scheduler Repository Conformance

Status: Phase 392 production repository conformance gate implemented. No
concrete database, object store, worker, route, or production activation is
selected by this phase.

## Outcome

Phase 392 defines the technology-neutral gate that a durable composition
repository must pass before scheduler production activation. The existing V1
repository remains the scheduler's logical contract. A separate production
extension adds bounded batch reads, atomic physical-byte admission, physical
usage inspection, and head-guarded unreachable-record cleanup.

A strict fingerprinted conformance report records independently executed
atomicity, concurrency, crash, restart, quota, and cleanup evidence. Structural
report validity does not imply readiness: the readiness assessor requires all
mandatory scenarios exactly once and checks minimum independent-process,
restart, batch, quota-rejection, and cleanup facts.

## Ownership Boundary

Core still owns composition semantics, cursor transitions, finalization, and
authoritative output validation. Backend owns repository transactions,
physical storage accounting, crash behavior, retention maintenance, and the
conformance runner. A storage adapter must not reinterpret a core demand,
repair a retained record, or infer document semantics.

The scheduler V1 interface remains usable by deterministic in-memory tests.
Production-only operations live in
`FlowDocBackendCompositionProductionRepositoryV1`; no optional capability flag
can promote a V1 adapter.

## Production Adapter Contract

A production candidate must preserve every V1 behavior and implement:

- `putImmutableWithPhysicalAdmission(...)`: atomically admit the first unique
  immutable record and increase physical usage only when the configured byte
  ceiling permits it. Exact replay consumes no additional quota.
- `readImmutableBatch(...)`: return up to 256 exact records in request order or
  fail the batch without exposing a partial chain as complete evidence.
- `inspectPhysicalUsage(...)`: report physical record and JSON-byte counts,
  including committed, staged, and currently unreachable records.
- `cleanupUnreachable(...)`: compare the exact current head fingerprint,
  preserve the supplied reachable set, honor the storage-age cutoff, and
  delete at most 1,000 records per call.

The admitted physical limit is distinct from the job head's committed
`maximumRetainedByteCount`. The first bounds actual storage consumption,
including losing-attempt staging; the second bounds authoritative committed
content. Production scheduler writes must use physical admission rather than
fall back to unrestricted `putImmutable(...)`.

## Atomic Commit Rules

Head creation must atomically retain context and create-request identity. A
transition commit must atomically update the job head and committed-request
index. A finalization commit must atomically update the completed head and both
output replay refs. A crash may expose the complete before-state or complete
after-state, never a mixed state.

The request index remains an acceleration structure. Its transaction must
match the head commit, while reachable receipt/output chains remain the
authority used to reject corrupt replay entries.

## Failure Matrix

Every conformance run must execute these scenarios through real adapter
operations:

| Scenario | Required evidence |
|---|---|
| `atomic-head-create` | Concurrent create exposes one exact context/head and one replay or conflict. |
| `atomic-transition-request-commit` | Head and transition request index become visible together. |
| `atomic-finalization-request-commit` | Completed head and finalization replay refs become visible together. |
| `immutable-record-id-uniqueness` | One record id cannot own different content. |
| `immutable-fingerprint-uniqueness` | One job/kind fingerprint cannot acquire an alias record id. |
| `ordered-batch-read-integrity` | Multiple exact refs return in request order and missing/corrupt input blocks the batch. |
| `independent-handle-cas` | Independent repository handles produce one CAS winner. |
| `crash-before-commit-recovery` | A fault before commit preserves the complete prior head and no replay entry. |
| `crash-after-commit-replay` | Acknowledged commit survives restart and replays without duplicate advance. |
| `process-restart-recovery` | A new process reconstructs head, context, indexes, and immutable reads. |
| `physical-quota-admission` | Concurrent first writes cannot exceed the physical byte ceiling. |
| `unreachable-record-cleanup` | Old unreachable staging is deleted while every reachable record remains readable. |

Failure injection must target transaction boundaries rather than mock only the
scheduler service. Independent-handle CAS must use separately opened clients;
two JavaScript objects sharing one in-memory map are insufficient evidence.

## Batch Read Contract

Batch reads are an adapter capability, not a change to core chain order. The
caller still derives exact refs from retained tips and verifies each digest and
prefix. An adapter may optimize one bounded group, but it must not return a
reordered set, silently omit a missing ref, or accept a cross-job record.

The current finalization reader remains linear until a conforming adapter is
selected. This keeps production optimization out of the semantic path while
the storage implementation is unknown.

## Physical Quota Contract

Physical usage counts unique retained records and their exact canonical JSON
bytes. Admission and the usage counter update must share one transaction or
equivalent atomic primitive. Failed, conflicting, and idempotent writes must
not increase usage. Cleanup decrements usage only for records actually removed.

The gate requires at least one proven over-limit rejection. Logical committed
quota evidence from Phase 391 cannot substitute for physical admission
evidence.

## Cleanup Contract

Cleanup is reachability-safe maintenance, not semantic garbage collection. A
caller supplies refs derived from one validated head and that head's exact
fingerprint. The adapter must reject a stale fingerprint before deletion,
apply an age cutoff longer than active lease exposure, preserve all reachable
refs, and obey the deletion budget.

Terminal jobs are the first supported cleanup target. Cleanup of active jobs
must remain closed until the selected implementation proves that the grace
period, lease expiry, and atomic head guard cannot delete content that a live
worker may still commit.

## Conformance Evidence

`finalizeFlowDocBackendCompositionRepositoryConformanceReportV1(...)` creates a
strict fingerprinted report. Parsing detects unknown properties, invalid
bounds, and edited facts. Readiness additionally requires:

- at least two independent processes and repository handles;
- at least one storage-backed restart;
- at least two records in ordered batch-read evidence;
- at least one rejected physical-quota write;
- at least one orphan candidate and one deleted orphan; and
- every mandatory scenario exactly once with `passed` status.

The report is engineering evidence, not an authentication envelope. Production
activation must load it from a trusted test/deployment provenance path rather
than accept caller-supplied JSON over HTTP.

## Adapter Exclusions

The in-memory scheduler repository does not survive process restart and has no
physical quota or cleanup methods. The backend file JSON adapter declares no
multi-record transaction and performs read-then-write replacement without
cross-process CAS. Both are explicitly rejected as conformance reports and
remain non-production evidence.

## PASS

- Production-only repository operations are separate from scheduler V1.
- Atomic head/request and finalization replay expectations are explicit.
- Immutable id and fingerprint indexes have mandatory conflict scenarios.
- Batch reads, physical quota, and cleanup are bounded contracts.
- Crash, independent-handle, and process-restart evidence is mandatory.
- Strict report fingerprints and readiness rules block partial evidence.
- Existing in-memory and file JSON adapters remain non-production.

## FAIL / BLOCKER

- No concrete storage adapter has run the gate.
- No trusted multi-process/fault-injection runner is wired into CI yet.
- Production scheduler writes do not call the physical-admission extension.
- Finalization does not consume batch reads yet.
- Cleanup execution, worker queues, routes, auth, tenancy, and deployment stay
  inactive.

## RISK

- A report from an untrusted caller could fabricate evidence; provenance must
  remain deployment-owned.
- Cleanup of active jobs can race staged commits unless lease/grace/head guards
  are proven by the selected adapter.
- A database transaction can pass logical tests while weak durability settings
  still lose acknowledged data after host failure.
- Batch optimization can increase peak memory if callers ignore the 256-record
  bound.

## UNKNOWN

- Concrete transactional database and immutable blob technology.
- Whether immutable records and heads share one store or coordinated stores.
- Production durability level, retry policy, cleanup grace period, and physical
  quota allocation per tenant.
- CI environment for real process kill/restart and fault injection.

## Files Changed

- `src/composition/compositionSchedulerRepositoryConformance.ts`
- `src/composition/compositionSchedulerProductionRepository.ts`
- `src/tests/compositionSchedulerRepositoryConformance.test.ts`
- `src/tests/durableCompositionSchedulerRepositoryConformanceDoc.test.ts`
- `src/index.ts`
- `docs/DURABLE_COMPOSITION_SCHEDULER_REPOSITORY_CONFORMANCE.md`
- `README.md`
- core cross-repository operating map, phase ledger, and documentation test

## Behavior Changed

Backend consumers can finalize, parse, and assess a strict production
repository conformance report. A production repository type now describes the
bounded operations required after adapter selection. Existing scheduler
execution and storage adapters are unchanged.

## Tests Run

- Strict positive report finalization, parse, and readiness assessment.
- Missing/failed scenario, insufficient independence/restart/batch/quota/
  cleanup, edited fingerprint, unknown property, and bounded-limit rejection.
- Explicit rejection of in-memory and file JSON adapter values as production
  evidence.
- Existing repository and 240-page scale regression tests.
- Full backend, core, and editor gates before handoff.

## Risks Left

The contract gate is ready; concrete adapter evidence and activation are not.
The first candidate must still prove real transactional, restart, physical
quota, and cleanup behavior under a trusted runner.

## Intentionally Not Changed

- core composition semantics or canonical package contracts;
- current scheduler V1 execution services and linear chain reader;
- existing file JSON/package/artifact storage;
- editor source, UI, progress, viewport, or WYSIWYG behavior;
- HTTP routes, queue workers, renderer/export, auth, tenancy, or deployment;
  and
- concrete database or object-storage selection.

## Next Recommended Direction

Phase 393 should implement a trusted isolated conformance runner and one
concrete transactional repository candidate against this locked contract. Keep
scheduler activation closed until the candidate produces a complete passing
report through independent processes, crash/restart injection, physical quota,
and cleanup evidence.
