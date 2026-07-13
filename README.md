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

Not yet included:

- auth or tenancy
- database persistence
- queue/job workers
- durable composition scheduler contracts, repository, and worker execution
- production export renderer
- generation/artifact route wiring into the concrete HTTP server
- submission workflow execution
- real deployment config

See `docs/MIGRATION_PERSISTENCE.md` for the migration route, retained snapshot,
idempotency, and remaining production-storage boundaries.
