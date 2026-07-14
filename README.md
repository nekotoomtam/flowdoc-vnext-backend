# FlowDoc vNext Backend

Backend service boundary for FlowDoc vNext.

This package owns API transport, revision gates, package persistence boundaries,
and calls into `@flowdoc/vnext-core` for document semantics. The frontend should
talk to this service contract instead of calling core mutations directly.

Current slice:

- in-memory package repository
- mutation request/response envelope
- `GET /capabilities/versions` reporting active read/mutation pairs separately
  from core migration-target support and revision-gated migration persistence
- package 3/document 4 document reads advertised for the isolated editor
  partial consumer
- editor migration consumers can submit explicit revisioned intent and verify
  accepted/replayed targets through the normal document read route
- package 3/document 4 supports revision-gated generic `node.delete`,
  `node.duplicate`, `node.reorder`, and policy-aware
  `text-block.rich-inline.replace`; capability reporting lists kinds per
  version pair
- migrated v4 drafts receive backend-owned structure identity, field contract,
  and structure policy context; clients submit rich children, not permissions
- mutation receipts provide exact replay without advancing revision and reject
  a reused request id carrying a different payload
- `POST /documents/:id/migrations/package-v3-document-v4` with stale gates,
  idempotent request replay, source snapshot retention, and strict core planning
- core-backed `node.delete`, `node.duplicate`, and `node.reorder`
- stale revision rejection before core mutation
- read transport envelope for mutation results
- dev server seed documents for `product-report-vnext-minimal` and
  `reorder-blocked-target-qa`
- backend-owned file JSON storage adapter for internal-alpha records
- route-shaped storage binding for session and artifact record requests
- backend-owned generation and artifact route parity contracts that call core
  readiness/manifest contracts without importing core route helpers
- backend-owned session and rich-inline storage records over retained core facts
- backend-owned submission route contract over core identity/status facts
- artifact job execution that owns storage lifecycle and accepts an injected renderer
- filesystem artifact byte store with manifest consistency checks
- Phase 385 locks the durable composition scheduler architecture around pinned
  source revisions, immutable chunks, a compare-and-swap job head, exact core
  demand/window transitions, and terminal finalization; runtime starts in the
  later contract/repository phases documented in
  `docs/DURABLE_COMPOSITION_SCHEDULER_ARCHITECTURE_LOCK.md`
- Phase 386 adds strict durable composition records for source pins, bounded job
  heads, immutable page chunks, transition receipts, and redacted progress;
  repository writes and scheduler execution remain closed in
  `docs/DURABLE_COMPOSITION_SCHEDULER_CONTRACTS.md`
- Phase 387 adds the durable composition repository boundary and in-memory
  conformance adapter for immutable records, head creation, CAS, replay,
  concurrent-winner, and orphan-staging behavior; initialization remains next
  in `docs/DURABLE_COMPOSITION_SCHEDULER_REPOSITORY.md`
- Phase 388 adds revision-gated durable composition initialization with pinned
  immutable source/manifest evidence, exact core outcome mapping, create replay,
  and transition-zero initial page chunks in
  `docs/DURABLE_COMPOSITION_SCHEDULER_INITIALIZATION.md`
- Phase 389 adds exact-window durable composition advancement with short lease
  CAS, immutable family/window/page/receipt staging, atomic head commit, exact
  replay, one concurrent winner, null-window structural continuation, and
  failure isolation in `docs/DURABLE_COMPOSITION_SCHEDULER_ADVANCEMENT.md`
- Phase 390 adds explicit expired-lease recovery, retry timing, cancellation,
  expiry, source-aware progress, reachable-chain verification, immutable final
  output publication, and exact finalization replay in
  `docs/DURABLE_COMPOSITION_SCHEDULER_RECOVERY_FINALIZATION.md`
- Phase 391 proves a 240-page mixed-family scheduler run, adds exact committed
  retention accounting and hard byte limits, repairs repeated owner-validation
  cost, covers resume/accounting failures, and records production blockers in
  `docs/DURABLE_COMPOSITION_SCHEDULER_SCALE_READINESS.md`
- Phase 392 defines the production repository extension and strict conformance
  gate for atomic head/request commits, immutable indexes, bounded batch reads,
  independent-process CAS, crash/restart recovery, physical quota admission,
  and reachability-safe cleanup; concrete storage remains unselected in
  `docs/DURABLE_COMPOSITION_SCHEDULER_REPOSITORY_CONFORMANCE.md`
- Phase 393 implements a dynamically gated Node SQLite transactional candidate,
  passes all twelve conformance scenarios through real child processes and
  commit-boundary crashes, and completes the 240-page workload across a real
  connection restart; production activation and admitted batch writes remain
  blocked in `docs/DURABLE_COMPOSITION_SCHEDULER_SQLITE_CANDIDATE.md`
- Phase 394 adds bounded atomic admitted staging for initialization,
  advancement, and finalization, preserves repository V1 compatibility, proves
  whole-batch crash/replay/quota behavior, and reduces the exact 240-page SQLite
  workload to 481 immutable transactions in
  `docs/DURABLE_COMPOSITION_SCHEDULER_ATOMIC_BATCH.md`
- Phase 395 runs four independent composition processes against one SQLite
  database, proves per-job correctness, fairness, restart isolation, and
  bounded immutable busy errors, but fails the provisional throughput target
  and exposes the missing typed head-availability contract in
  `docs/DURABLE_COMPOSITION_SCHEDULER_CONCURRENCY_QUALIFICATION.md`

Not yet included:

- auth or tenancy
- database persistence
- queue/job workers
- production durable composition storage, scheduler worker/queue, cleanup,
  quota enforcement, and routes
- production export renderer
- generation/artifact route wiring into the concrete HTTP server
- submission workflow execution
- real deployment config

See `docs/MIGRATION_PERSISTENCE.md` for the migration route, retained snapshot,
idempotency, and remaining production-storage boundaries.
