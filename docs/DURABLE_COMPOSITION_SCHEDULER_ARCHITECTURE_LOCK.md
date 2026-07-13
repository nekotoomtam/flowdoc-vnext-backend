# Durable Composition Scheduler Architecture Lock

Status: Phase 385 architecture locked. No composition route, worker, durable
repository, or consumer activation is added by this phase.

## Outcome

The backend durable composition scheduler coordinates the pure sequential
composer exported by `@flowdoc/vnext-core`. It pins one immutable source
revision and manifest, requests one exact family window at a time, commits
accepted transitions through one compare-and-swap job head, retains immutable
family evidence and closed-page chunks, and finalizes one authoritative page
plan plus heading-page map.

The scheduler does not measure content, paginate a family, reinterpret a core
demand, edit document structure, render an artifact, or expose editor command
policy. Core remains the semantic authority; backend owns orchestration,
identity, concurrency, persistence, retry, expiry, and progress facts.

## Existing Evidence

This lock is grounded in current implementation evidence:

- core `initializeVNextDocumentCompositionV1(...)` and
  `advanceVNextDocumentCompositionV1(...)` accept strict retained state and at
  most one exact family window in
  `flowdoc-vnext-core/src/composition/documentCompositionTransitionV1.ts`;
- core `finalizeVNextDocumentCompositionV1(...)` validates the complete page
  chain and emits the authoritative plan and heading map in
  `flowdoc-vnext-core/src/composition/documentCompositionFinalizerV1.ts`;
- backend `executeBackendMutation(...)` already proves request fingerprint,
  exact replay, stale revision, and lost-write-race behavior in
  `src/service/mutationService.ts` and `src/tests/mutationService.test.ts`;
- backend file JSON storage exposes exact revision and idempotency checks but
  explicitly reports `multiRecordTransactions: false` in
  `src/storage/fileJsonStorage.ts` and `src/tests/fileJsonStorage.test.ts`; and
- backend artifact execution performs several ordered record writes and also
  reports no multi-record transaction in
  `src/artifacts/artifactJobExecution.ts` and
  `src/tests/artifactJobExecution.test.ts`.

The existing file JSON and artifact paths are useful evidence, not a durable
composition transaction implementation.

## Responsibility Boundary

Core owns:

- manifest, demand, cursor, open-page, closed-page, transition, and finalizer
  contracts;
- exact family-window acceptance and canonical section/root order;
- pure complete, partial, fresh-page, blocked, and limit behavior;
- page geometry, prefix fingerprints, exact work, and deterministic retry; and
- authoritative page-plan and heading-page-map validation.

Backend owns:

- source revision and immutable package/projection/manifest pins;
- job, request, attempt, lease, transition, chunk, and output identities;
- exact-demand family scheduling without duplicating family semantics;
- compare-and-swap job-head commits and immutable blob retention;
- idempotency, concurrent-worker exclusion, retry, backoff, cancellation,
  expiry, authorization, tenancy, quotas, and garbage collection; and
- transport-neutral progress and blocker envelopes.

Editor later owns progress presentation, cancellation intent, viewport page
loading, selection/caret behavior, and authoring UX. Renderer/export later
consumes retained authoritative output and family evidence without relayout.

## Source Pin

Job creation requires the exact source document id, package version, document
version, base revision, package fingerprint, resolved projection fingerprint,
composition manifest fingerprint, profile identities, and transition limits.
The backend checks the base revision before core initialization and stores an
immutable source snapshot reference.

Later edits do not rebase, mutate, or silently restart an existing job. The
job continues against its pinned source and reports whether that source is
still current. A caller that wants current content creates a new job. This
preserves the page-plan owner and prevents mixed-revision output.

## Identity Model

The scheduler keeps these identities separate:

- `jobId`: one pinned composition lifecycle;
- `createRequestId`: idempotent job creation intent;
- `transitionRequestId`: one exact demand/window submission and replay key;
- `attemptId`: one worker execution attempt, including failed infrastructure
  attempts;
- `leaseToken`: short exclusive commit authority for one head revision;
- `manifestFingerprint`: immutable core manifest owner;
- `demandFingerprint`: exact requested family work;
- `windowFingerprint`: immutable supplied family evidence;
- `transitionFingerprint`: core transition result identity;
- `chunkFingerprint`: immutable accepted window/page/receipt chunk identity;
  and
- `compositionFingerprint`: final shared page-plan/heading-map owner.

Request ids are opaque caller identities, not timestamps or semantic ids.
Reusing one request id with a different canonical request fingerprint is an
idempotency conflict.

## Durable Job Head

One backend-owned job head is the logical commit record. It retains bounded
control state only:

- source, manifest, profile, limits, and expiry pins;
- monotonically increasing head revision and transition number;
- durable status and optional short lease;
- current core cursor and open-page checkpoint;
- exact next demand or terminal state;
- committed transition/chunk chain tip and cumulative counts;
- final output references when complete;
- latest bounded retry/blocker summary; and
- deterministic head fingerprint.

It must not embed the complete source package, all closed pages, every family
window, the complete attempt log, artifact bytes, page plan, or heading map.
Document-length evidence is retained in immutable content-addressed records.

## Immutable Records

The durable repository retains separate immutable records for:

- pinned source snapshot and canonical composition manifest;
- accepted family-window evidence;
- emitted closed-page chunks chained by previous chunk fingerprint;
- transition receipts containing exact before/after fingerprints and work;
- rejected/retry attempt diagnostics with no committed core state; and
- terminal page plan and heading map sharing the composition fingerprint.

The job head stores chain tips and counts, not an ever-growing array of every
record reference. Finalization walks the committed chain, verifies each digest
and prefix, restores canonical order, and passes the complete closed pages to
the core finalizer exactly once.

## State Machine

Persisted job statuses are:

- `waiting-window`: an exact core demand is available;
- `ready-to-finalize`: the terminal cursor is committed and output is pending;
- `completed`: authoritative plan and heading map references are committed;
- `blocked`: a terminal semantic, integrity, or configured-limit blocker;
- `cancelled`: explicit accepted cancellation before completion; and
- `expired`: retention or execution lifetime ended before completion.

An active worker is represented by a short lease on the current head, not a
separate durable `running` truth. Infrastructure retry/backoff is metadata on
`waiting-window` or `ready-to-finalize`; it does not invent a core state.
Terminal states never return to an active state. There is no automatic rebase
or automatic recomposition.

## Atomic Transition Protocol

One accepted family-window transition follows this order:

1. Read the job head and require `waiting-window` plus an exact demand.
2. Produce or obtain a family window outside the commit lease.
3. Canonicalize the request and reject stale head revision, demand mismatch,
   source mismatch, request-id conflict, or expired/cancelled job.
4. Acquire a short lease by compare-and-swap on the same head revision.
5. Call core with the pinned manifest, cursor-before, open-page-before, exact
   window, and pinned limits.
6. For an accepted core result, write and read-verify immutable window,
   closed-page, and transition-receipt records.
7. Compare-and-swap the leased job head to cursor-after, open-page-after,
   demand-after or `ready-to-finalize`, new chain tips, and exact counts.
8. Clear the lease as part of that same head commit and return committed facts.

Step 7 is the logical commit point. A compare-and-swap loss commits no new
cursor, open page, closed-page prefix, demand, or work. Content-addressed blobs
written by a losing attempt are unreachable staging records and may be safely
deduplicated or garbage-collected.

The production repository must implement atomic compare-and-swap for the job
head. The current file JSON adapter is not promoted to production composition
storage merely because it can write individual revisioned records.

## Idempotency And Concurrency

Exact replay of a committed create or transition request returns its retained
receipt and committed head revision without calling core or advancing counts.
A reused request id with a different canonical payload blocks as conflict.

The lease reduces duplicate work; head compare-and-swap provides correctness.
Workers may prepare the same demanded family window concurrently, but only one
head commit can win. Losing workers receive the current head revision and may
re-read progress. An expired lease may be replaced through compare-and-swap;
the old lease token cannot commit afterward.

Receipt authority comes from the committed transition chain. A staged receipt
that is not reachable from the current job head is not accepted output.

## Family Window Scheduling

The scheduler dispatches by the core demand family:

- `text-flow`, `columns-flow`, `table-flow`, `generated-flow`,
  `utility-flow`, or `media-flow`.

A family provider receives the exact demand, pinned source/evidence owners,
and configured limits. It returns one common fragment window. The scheduler
does not combine windows, infer another capacity, alter family cursors, clip
fragments, or repair blocked evidence.

Provider execution may be local or queued later. The scheduler contract stays
transport-neutral and does not require an HTTP route or queue implementation.

## Failure And Recovery

Failures are classified without mutating accepted core state:

- storage/network/provider errors are retryable with bounded attempts and
  backoff while the exact demand remains current;
- core `window-rejected` permits a corrected window for the same demand;
- core `family-blocked`, integrity failure, invalid retained state, or hard
  limit exhaustion moves the job to terminal `blocked`;
- stale head, lost lease, and compare-and-swap loss are concurrency outcomes,
  not semantic failures;
- cancellation and expiry require compare-and-swap against the current head;
  and
- process restart resumes only from the committed head and reachable immutable
  chain, never from in-memory work.

Blocked or rejected attempts retain diagnostics but no cursor-after,
open-page-after, closed-page commit, or cumulative-work advance.

## Finalization Protocol

When core returns `document-complete`, the accepted transition commits the
terminal cursor and status `ready-to-finalize`. A finalizer worker then:

1. acquires the current head lease;
2. loads the pinned manifest and complete reachable closed-page chain;
3. verifies immutable record digests, transition order, prefix chain, counts,
   and terminal cursor owner;
4. calls core `finalizeVNextDocumentCompositionV1(...)` once;
5. writes and read-verifies content-addressed page-plan and heading-map records;
   and
6. compare-and-swaps the head to `completed` with both output references and
   their shared composition fingerprint.

Finalization failure exposes no partial authoritative output. Exact replay
returns the same retained output references.

## Progress Envelope

The later transport-neutral read model reports bounded facts only:

- job/source/head revision and durable status;
- source-current flag and expiry;
- transition, page, placement, heading, body-item, and work counts;
- exact current demand family/root identity when waiting;
- active lease expiry without exposing the lease token;
- retry availability, attempt count, retry-after time, and latest blocker; and
- final plan/map references only after `completed`.

It does not return the full cursor, open page, family window, source snapshot,
page chunks, or internal storage paths to an editor client.

## Limits And Retention

Creation pins hard transition, page, placement, heading, body-item, attempt,
wall-clock, and retained-byte limits. Limits cannot be raised silently during
one job because they participate in job identity.

Immutable staging records not reachable from a committed head may be removed
after a grace period. Completed output, failed diagnostics, source snapshots,
and transition receipts follow explicit backend retention policy. Authorization,
tenancy, quota, encryption, and deletion audit remain required before
production storage.

## Implementation Phases

1. **Phase 386, contracts:** strict backend-owned job head, source pin,
   immutable chunk, receipt, lease, blocker, progress, and result schemas.
2. **Phase 387, repository:** compare-and-swap head plus immutable content
   repository boundary and deterministic in-memory conformance adapter.
3. **Phase 388, initialization:** revision-gated idempotent job creation,
   source/manifest retention, core initialization, and first demand.
4. **Phase 389, advancement:** exact window acceptance, short lease, immutable
   staging, atomic head commit, replay, and concurrent-worker rejection.
5. **Phase 390, recovery/finalization:** retry, expiry, cancellation, complete
   chain loading, core finalization, output retention, and progress facts.
6. **Phase 391, scale/readiness:** adversarial restart/concurrency/storage
   tests, mixed 200-300 page execution, and all three repository gates.

## PASS

- Core and backend ownership are separated at the pure transition boundary.
- Source revision, manifest, profiles, and limits are pinned for one job.
- One bounded job head is the logical commit point.
- Immutable chunks avoid rewriting the complete page prefix per transition.
- Lease, compare-and-swap, idempotency, retry, and finalization rules are
  explicit before implementation.
- Existing file JSON and artifact execution are treated as evidence only.

## FAIL / BLOCKER

- Scheduler contracts and repository interfaces are not implemented yet.
- No composition job can be created, advanced, resumed, or finalized yet.
- No production transaction adapter, queue worker, route, auth, or tenancy
  exists.
- Editor and renderer consumers remain inactive.

## RISK

- A growing job-head array would recreate document-length rewrite cost.
- Treating staged blobs as committed without head reachability would expose
  losing concurrent attempts.
- Acquiring a lease before expensive family work would create avoidable expiry
  and worker contention.
- Continuing against current mutable document state would mix revisions.
- Reusing artifact multi-record writes would permit partial scheduler state.

## UNKNOWN

- Production database and object-storage technology.
- Final lease duration, retry schedule, retention period, and byte quotas.
- Production family-provider deployment and queue topology.
- Real measured-content throughput and chunk size distribution.
- Authorization, tenancy, encryption, and deletion-audit policy.

## Files Changed

- `docs/DURABLE_COMPOSITION_SCHEDULER_ARCHITECTURE_LOCK.md`
- `src/tests/durableCompositionSchedulerArchitectureLock.test.ts`
- `README.md`
- core `docs/CROSS_REPO_OPERATING_MAP.md`
- core `docs/PHASE_LEDGER.md`
- core `tests/backendDurableCompositionSchedulerArchitectureLock.test.ts`

## Behavior Changed

None. Phase 385 records architecture, evidence, and implementation order only.

## Tests Run

- focused backend Phase 385 documentation contract test;
- focused core cross-repo Phase 385 documentation contract test;
- backend type-check and full backend test/build gate; and
- core type-check and full core test gate.

## Risks Left

All runtime contracts, repository behavior, orchestration, recovery,
finalization, scale, and consumer integration remain later bounded phases.

## Intentionally Not Changed

- core composition contracts or semantics;
- backend package/document schemas and mutation routes;
- existing file JSON storage and artifact execution;
- concrete database, queue, object storage, auth, tenancy, or deployment;
- editor source, commands, canvas, viewport, or progress UI; and
- renderer, PDF, DOCX, preview, or artifact output.

## Next Recommended Direction

Implement Phase 386 strict backend scheduler contracts. Begin with the source
pin and bounded job head, then immutable chunk/receipt and progress envelopes;
do not implement storage or orchestration until those parsers reject malformed,
cross-job, stale-owner, and unbounded retained state.
