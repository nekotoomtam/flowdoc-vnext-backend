# Durable Composition Scheduler Contracts

Status: Phase 386 strict backend contracts implemented. Repository writes,
compare-and-swap, orchestration, routes, and consumers remain inactive.

## Outcome

The backend now exports strict, fingerprinted contracts for a pinned
composition source, bounded durable job head, immutable closed-page chunk,
transition receipt, and transport-neutral progress projection. Embedded
manifest, cursor, open page, demand, and closed pages are accepted only through
the public `@flowdoc/vnext-core` parsers.

The contracts preserve demand-free core `partial/output-limit` as explicit
`ready-to-advance` state rather than inventing a family demand or losing the
resume path.

## Implemented Contracts

- `compositionSchedulerSourcePin.ts` owns immutable source/profile/limit pins
  and bounded content references.
- `compositionSchedulerJobHead.ts` owns the seven-state durable control record,
  lease/retry/blocker/output facts, and cross-envelope invariants.
- `compositionSchedulerTransitionRecords.ts` owns immutable page chunks and
  exact transition receipts.
- `compositionSchedulerProgress.ts` projects bounded client-safe progress
  without exposing retained core state or storage paths.
- `compositionSchedulerContractSupport.ts` owns compact SHA-256 identity,
  strict-object checks, bounded primitive readers, and contract issues.

All modules are backend-owned and exported through `src/index.ts`.

## Source Pin

The source pin fixes package 3/document 4, base revision, package/projection/
manifest owners, immutable source and manifest refs, profile ids, core
transition limits, backend execution limits, and one exact lifetime.

It rejects unknown properties, cross-job refs, wrong content kinds, manifest
ref drift, invalid dates, unbounded counts, and attempt limits below transition
limits. Parse verifies the retained fingerprint after semantic finalization.

## Job Head

The job head retains only source/manifest fingerprints, head revision, status,
transition number, current core cursor/open page/demand, bounded chain facts,
lease/retry/blocker summary, terminal output refs, and timestamps.

Its parser loads the exact source pin and manifest context, then calls core
`parseVNextDocumentCompositionStateV1(...)` and
`parseVNextDocumentCompositionDemandV1(...)`. It rejects source, manifest,
cursor, open-page, demand, active-root, lifetime, retry, lease, output, and
terminal-state mismatch.

Backend chunk identity and core page-prefix identity are deliberately separate:

- `closedPageChunkTipFingerprint` locates the latest backend immutable chunk;
- `closedPagePrefixFingerprint` must equal the exact core cursor prefix.

## State Invariants

- `waiting-window` requires incomplete active core state and one exact demand.
- `ready-to-advance` requires incomplete state with no active root or demand;
  the later scheduler must call core with `window: null`.
- `ready-to-finalize` requires a complete cursor and no output yet.
- `completed` requires terminal state, both output refs, and no lease.
- `blocked`, `cancelled`, and `expired` retain no demand, output, or lease.
- only `blocked` requires a non-retryable blocker; active states may retain only
  retryable diagnostics.

## Immutable Page Chunk

A non-empty bounded page chunk pins one job, manifest, transition number,
optional family-window ref, prior backend chunk, core prefix before/after,
counts before, strict core closed pages, and creation time.

Every page must continue the exact page index, page number, placement/heading
counts, and previous core prefix. The final page prefix must equal the chunk's
declared core prefix-after. The chunk receives its own independent backend
fingerprint.

## Transition Receipt

The receipt pins request/attempt identity, one before/after head revision,
manifest, demand/window pair or null structural continuation, core transition
and cursor fingerprints, optional chunk, prior receipt tip, accepted status/
reason, exact work, and creation time.

It rejects head revision gaps, cross-job refs, broken receipt order, mismatched
demand/window nullability, page-chunk/work mismatch, and invalid complete/
partial/reason/demand-after combinations.

## Progress Projection

`createFlowDocBackendCompositionProgressV1(...)` first parses the complete job
head context. It then returns source/head revisions, status, cumulative counts,
bounded demand identity, structural-continuation flag, lease expiry, retry,
blocker, final refs, and expiry.

It does not expose cursor, open page, family window, lease token, source
snapshot, storage key/path, renderer output, or editor command policy.

## Verification

The focused fixture builds a real core manifest, initial demand, accepted
text-flow window, terminal cursor, and final closed page before constructing
backend records. A second real page-break fixture reaches
`partial/output-limit` and proves `ready-to-advance` plus progress projection.

Tests cover exact parse/finalize, unknown properties, cross-job refs, stale
fingerprints, impossible waiting state, chunk/page prefix separation, malformed
page chains, receipt revision/demand/result drift, and progress redaction.

## PASS

- Backend source, job, chunk, receipt, and progress shapes are strict and
  fingerprinted.
- Core retained envelopes are reparsed by core instead of trusted or copied.
- Cross-job, stale-owner, state-machine, chain, and boundedness checks pass.
- Demand-free output-limit continuation is retained explicitly.
- Backend/core responsibility remains separate.

## FAIL / BLOCKER

- No repository interface or compare-and-swap implementation exists yet.
- No job initialization, lease acquisition, transition commit, replay lookup,
  recovery, or finalization service exists yet.
- No route, queue worker, database, auth, tenancy, editor, or renderer consumer
  is activated.

## RISK

- Repository implementation must validate records again on every read.
- Chunk and receipt refs are not committed merely because immutable blobs exist;
  job-head reachability remains authoritative.
- Lease-token storage must never leak through progress transport.
- Production retained-byte limits require repository accounting.

## UNKNOWN

- Concrete database/object-store representation and indexes.
- Production lease, retry, retention, and quota values.
- Queue topology and family-provider deployment.
- Production measured-content chunk distribution.

## Files Changed

- `src/composition/compositionSchedulerContractSupport.ts`
- `src/composition/compositionSchedulerSourcePin.ts`
- `src/composition/compositionSchedulerJobHead.ts`
- `src/composition/compositionSchedulerTransitionRecords.ts`
- `src/composition/compositionSchedulerProgress.ts`
- `src/tests/helpers/compositionSchedulerFixture.ts`
- `src/tests/compositionSchedulerContracts.test.ts`
- `src/tests/durableCompositionSchedulerContractsDoc.test.ts`
- `src/index.ts`
- `README.md`
- core cross-repo map, phase ledger, and Phase 386 documentation test

## Behavior Changed

Backend package consumers may now create and parse transport-neutral durable
composition records. No storage, scheduling, HTTP, rendering, or editor
behavior changes.

## Tests Run

- focused scheduler contract and documentation tests;
- backend type-check, full test suite, and build;
- core focused cross-repo documentation test; and
- core type-check and full test suite.

## Risks Left

Repository conformance, atomic compare-and-swap, orchestration, recovery,
finalization, scale, and production policy remain open.

## Intentionally Not Changed

- core composition schemas or transition/finalization behavior;
- existing backend package repository, file JSON storage, artifact jobs, and
  HTTP server;
- package/document canonical schemas;
- editor source, UI, canvas, viewport, or command runtime; and
- renderer, PDF, DOCX, or artifact bytes.

## Next Recommended Direction

Implement Phase 387 repository boundary with atomic compare-and-swap job heads,
immutable content put/get, committed receipt reachability, and a deterministic
in-memory conformance adapter. Do not add route or worker policy yet.
