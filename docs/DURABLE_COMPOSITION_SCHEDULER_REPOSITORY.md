# Durable Composition Scheduler Repository

Status: Phase 387 repository boundary and in-memory conformance adapter
implemented. Scheduler services, routes, workers, and production storage remain
inactive.

## Outcome

The backend now exposes a repository contract for immutable composition
records, idempotent head creation, validated head reads, and atomic
compare-and-swap head commits. A deterministic in-memory adapter proves the
contract without being treated as production persistence.

## Immutable Records

`putImmutable(...)` requires a strict content ref, exact value fingerprint, and
exact canonical JSON byte length. The first write succeeds, an identical write
replays, and reuse of one job/record id with different content conflicts.

Reads return deep clones. Staged records may exist without being committed;
only reachability from the current job head is authoritative.

## Head Creation

`createHead(...)` reparses the source pin, core manifest, and backend job head.
Creation requires revision zero, transition zero, one request id, and one
request fingerprint. Exact replay returns the current retained head; a
different creation identity conflicts.

Job initialization orchestration and source/manifest staging remain Phase 388.

## Compare And Swap

`compareAndSwapHead(...)` requires the exact current revision and fingerprint.
The next head must:

- pass the complete Phase 386 parser against retained source/manifest context;
- advance exactly one head revision;
- preserve source and manifest owners;
- keep or advance transition number by one;
- not leave a terminal state; and
- when committing a transition request, reference a retained immutable receipt
  that becomes the exact next receipt-chain tip.

Stale callers receive the current head. Two concurrent callers against one
revision produce one commit and one stale result.

## Idempotency

A committed transition request stores its request fingerprint, receipt ref, and
exact committed head snapshot atomically with the head update. Exact replay
returns that snapshot even after the request's expected revision is stale.
Reusing the request id with another fingerprint conflicts.

The request index is an acceleration structure; the head receipt chain remains
the authority and can rebuild it.

## Failure Isolation

Immutable writes happen before a head commit. If compare-and-swap loses, those
records remain unreachable staging data while cursor, open page, demand, chain,
counts, and head fingerprint remain unchanged. A later retention policy may
garbage-collect them.

## Adapter Boundary

The in-memory adapter performs no file, database, object-storage, queue,
network, auth, or tenancy work. It is a conformance implementation for tests.
The existing file JSON adapter remains unsuitable because it declares no
multi-record transaction and does not implement this repository contract.

## Verification

Focused tests prove immutable replay/conflict and clone isolation, idempotent
head creation, lease then transition CAS, committed-request replay/conflict,
one winner under concurrent CAS, orphan staging isolation, stale current-head
return, and rejection of missing/unreachable receipt commits.

## PASS

- Repository responsibilities are separated from core and scheduler policy.
- Every head read/write is contract-validated.
- CAS provides the single logical commit point.
- Immutable staging cannot masquerade as accepted output.
- Exact create/transition replay and conflicting identity are distinct.

## FAIL / BLOCKER

- No initialization or advancement service calls this repository yet.
- No production database/object-store adapter exists.
- No lease-expiry recovery, cancellation, finalization, route, queue, auth,
  tenancy, editor, or renderer integration exists.

## RISK

- Production implementations must commit head plus request-index acceleration
  atomically or rebuild the index from the receipt chain.
- Canonical JSON byte accounting must stay identical across adapters.
- Unreachable staging requires bounded retention and garbage collection.
- In-memory process safety is not database concurrency evidence.

## UNKNOWN

- Production transaction/database technology and isolation level.
- Object-store staging and garbage-collection policy.
- Index shape and retention period for committed requests.
- Production write throughput and chunk-size distribution.

## Files Changed

- `src/composition/compositionSchedulerRepository.ts`
- `src/tests/compositionSchedulerRepository.test.ts`
- `src/tests/durableCompositionSchedulerRepositoryDoc.test.ts`
- `src/index.ts`
- `README.md`
- core cross-repo map, phase ledger, and Phase 387 documentation test

## Behavior Changed

Backend package consumers can now retain composition records and perform
in-memory CAS through a transport-neutral repository. No product/runtime route
or persistent storage behavior changes.

## Tests Run

- focused repository and documentation tests;
- backend type-check, full suite, and build;
- focused core cross-repo test; and
- core type-check and full suite.

## Risks Left

Initialization, advancement, recovery, finalization, scale, and production
storage/policy remain open.

## Intentionally Not Changed

- core composition behavior;
- existing file JSON/package/artifact repositories;
- HTTP server, routes, workers, deployment, auth, or tenancy;
- editor source or UI; and
- renderer/export/artifact bytes.

## Next Recommended Direction

Implement Phase 388 source-pinned initialization: canonical request parsing,
base-revision gate, immutable source/manifest staging, core initialization,
initial job-head creation, and exact create replay.
