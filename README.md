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

Not yet included:

- auth or tenancy
- database persistence
- queue/job workers
- export rendering
- real deployment config
