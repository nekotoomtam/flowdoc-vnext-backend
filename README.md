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
- PDF export V-B wraps exact Core production admission in an immutable
  backend operation and durably binds caller idempotency keys by tenant and
  principal through in-memory and SQLite repository adapters; worker, terminal
  receipt, auth, route, and production activation remain closed in
  `docs/PDF_EXPORT_DURABLE_OPERATION_IDEMPOTENCY.md`
- PDF export V-C adds a separate revisioned lifecycle head and atomic
  transition journal with bounded claim/reclaim, attempts, exact replay,
  deadline and three checkpoint-cancellation decisions, plus a process-local
  shutdown-drain gate. Renderer execution, PDF bytes, terminal receipt,
  cluster coordination, routes, auth, and activation remain closed in
  `docs/PDF_EXPORT_LIFECYCLE_WORKER_CONTROL.md`
- PDF export V-D binds the exact Core handoff, receipt, and render completion
  to a qualified-candidate renderer SPI with bounded asynchronous cancellation
  checkpoints and V-C before-render/before-persist transitions. It returns
  validated bytes only in memory; concrete production renderer selection,
  persistence, routes, auth, and activation remain closed in
  `docs/PDF_EXPORT_RENDERER_ADAPTER_QUALIFICATION.md`
- PDF export V-E publishes SHA-256-addressed PDF bytes atomically, verifies
  physical bytes by readback, then CAS-projects the rendered Core manifest and
  job in one SQLite transaction with terminal restart replay and bounded
  orphan recovery. Production storage/provider selection, post-commit worker
  finalization, observability, routes, auth, and activation remain closed in
  `docs/PDF_EXPORT_DURABLE_ARTIFACT_PERSISTENCE.md`
- PDF export V-F composes V-B through V-E into a restart-safe candidate,
  atomically journals a closed privacy-safe Core event chain with terminal
  workflow completion, and proves full SQLite recovery at every durable stage.
  Production event delivery/retention, worker hosting, storage/provider and
  renderer promotion, authenticated routes, deployment, and activation remain
  closed in `docs/PDF_EXPORT_PRIVACY_OBSERVABILITY_QUALIFICATION.md`
- PDF export V-G adds an unmounted concrete HTTP candidate for authenticated
  request/status/cancel/download, derives tenant/principal only from injected
  credentials, enforces authorization per action, redacts status, and returns
  bytes only after terminal and physical verification. SQLite restart evidence
  passes, but the production activation review is NO-GO in
  `docs/PDF_EXPORT_AUTHENTICATED_ROUTE_ACTIVATION_REVIEW.md`
- PDF export LOCAL-A keeps V-G unmounted and locks the next implementation lane
  to dedicated loopback-only HTTP/worker entry points, local PostgreSQL and
  S3-compatible storage adapters, canonical renderer evidence first, and later
  Editor development-proxy integration. It activates no runtime or production
  binding; the cross-repo lock lives in
  `../flowdoc-vnext-core/docs/PDF_EXPORT_LOCAL_FIRST_ARCHITECTURE_LOCK.md`
- PDF export LOCAL-B reuses the V-D generic renderer SPI, adds a local
  controlled pilot adapter with trusted resource resolution, and retains exact
  canonical 13-page bytes across 30 bounded checkpoints. It writes no storage,
  starts no worker/server, and selects no production renderer in
  `docs/PDF_EXPORT_LOCAL_RENDERER_ADAPTER.md`
- PDF export LOCAL-C adds explicit loopback-only PostgreSQL metadata adapters
  and an S3-compatible content-addressed byte store, pinned local Compose and
  portable provider harnesses, versioned migration/setup, competing-connection
  and restart/fault evidence, and resumable orphan enumeration. Worker hosting,
  route mounting, Editor integration, and production binding remain closed in
  `docs/PDF_EXPORT_LOCAL_POSTGRES_S3_ADAPTERS.md`
- PDF export LOCAL-D adds bounded PostgreSQL due-work discovery, one-owner
  execution with uncertain-commit reconciliation, expiry reclaim, stopped
  lifecycle finalization, an explicit-start concurrency-one worker host,
  graceful/forced drain, and bounded orphan-maintenance cadence. The dedicated
  command remains fail-closed until a concrete composition factory is
  selected; routes, Editor, and production remain closed in
  `docs/PDF_EXPORT_LOCAL_DURABLE_WORKER.md`
- PDF export LOCAL-E adds the concrete digest-pinned canonical resolver,
  local credential/authorization composition, dedicated loopback-only HTTP
  process, and in-checkout worker factory over PostgreSQL and S3-compatible
  providers. Separate HTTP/worker connections pass the exact 13-page
  request-to-download and no-render replay lane; Editor, readiness, and
  production remain closed in `docs/PDF_EXPORT_LOCAL_HTTP_COMPOSITION.md`
- PDF export LOCAL-F adds an authenticated, no-store exact-pin eligibility
  endpoint to the separate local listener. The Editor uses it with the
  existing request/status/cancel/download routes through a development-only
  same-origin proxy; the browser receives no local credential, unsupported
  product documents are not substituted, and readiness/production remain
  closed in `../flowdoc-vnext-editor/docs/PDF_EXPORT_LOCAL_EDITOR_INTEGRATION.md`
- PDF export LOCAL-G passes the canonical local readiness audit across two
  operating-system processes, actual PostgreSQL 17.10 and pinned MinIO,
  no-work terminal replay, HTTP cancellation, missing/corrupt readback,
  digest drift, bounded cleanup, and a measured CPU/memory/time/database/object
  envelope. Local qualification is accepted while product-document eligibility
  and every production binding remain closed in
  `docs/PDF_EXPORT_LOCAL_READINESS_AUDIT.md`
- PDF export REALDOC-E.0 keeps the next lane API-driven: one exact Published
  Structure Version plus caller-owned data enters a direct-data or versioned
  mapping contract before Core resolution. Editor test import must share that
  Backend path; the current document-pin eligibility route remains canonical
  evidence only and production remains NO-GO in
  `docs/PDF_EXPORT_REALDOC_DOCGEN_HANDOFF.md`
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
- Phase 396 adds provider-neutral typed head availability, reconciliation lanes,
  bounded reconcile-before-retry decisions, and scheduler-wide unavailable
  outcomes while preserving repository V1 behavior in
  `docs/DURABLE_COMPOSITION_SCHEDULER_TRANSIENT_AVAILABILITY.md`
- Phase 397 adds a fingerprinted worker storage-attempt state machine, exact
  creation/head/request/finalization reconciliation, separate bounded write and
  read-failure budgets, lease-window safety, and four-lane SQLite restart
  evidence in `docs/DURABLE_COMPOSITION_SCHEDULER_WORKER_RECONCILIATION.md`
- Phase 398 adds a durable worker-attempt journal with exact mutation/state
  retention, atomic expiring claims, duplicate-delivery replay, expiry reclaim,
  terminal completion, and SQLite restart/crash evidence in
  `docs/DURABLE_COMPOSITION_SCHEDULER_WORKER_JOURNAL.md`
- Phase 399 adds a one-step durable worker runner with atomic execution-start
  evidence, exact reconcile/retry release and terminal mapping, duplicate-
  delivery exclusion, interrupted-retry reconciliation, and SQLite restart
  evidence in `docs/DURABLE_COMPOSITION_SCHEDULER_WORKER_RUNNER.md`
- Phase 400 adds bounded due-work discovery for pending schedules and expired
  claims, a side-effect-free keyset cursor, indexed SQLite projections with
  Phase 399 schema backfill, and fingerprinted one-page runner observability in
  `docs/DURABLE_COMPOSITION_SCHEDULER_DUE_WORK_DISCOVERY.md`
- Phase 401 qualifies four independent SQLite due-batch consumers under one
  forced shared page, exact duplicate-observation versus one-owner execution
  accounting, expiry reclaim, restart, and bounded fairness/latency evidence in
  `docs/DURABLE_COMPOSITION_SCHEDULER_DUE_BATCH_QUALIFICATION.md`

Not yet included:

- auth execution or production tenancy policy
- production application database selection and deployment
- queue/job workers
- production durable composition storage, scheduler worker/queue, cleanup,
  quota enforcement, and routes
- production export renderer
- generation/artifact route wiring into the concrete HTTP server
- submission workflow execution
- real deployment config

See `docs/MIGRATION_PERSISTENCE.md` for the migration route, retained snapshot,
idempotency, and remaining production-storage boundaries.
