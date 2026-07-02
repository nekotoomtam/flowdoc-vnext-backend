# FlowDoc vNext Backend

Backend service boundary for FlowDoc vNext.

This package owns API transport, revision gates, package persistence boundaries,
and calls into `@flowdoc/vnext-core` for document semantics. The frontend should
talk to this service contract instead of calling core mutations directly.

Current slice:

- in-memory package repository
- mutation request/response envelope
- core-backed `node.delete`, `node.duplicate`, and `node.reorder`
- stale revision rejection before core mutation
- read transport envelope for mutation results
- backend-owned file JSON storage adapter for internal-alpha records
- route-shaped storage binding for session and artifact record requests
- artifact job execution that owns storage lifecycle and accepts an injected renderer
- filesystem artifact byte store with manifest consistency checks

Not yet included:

- auth or tenancy
- database persistence
- queue/job workers
- production export renderer
- real deployment config
