## FlowDoc vNext Backend Working Agreement

This repository is the FlowDoc vNext service boundary. Optimize for stable API
contracts, revision safety, package persistence, and clean delegation to
`@flowdoc/vnext-core`.

## Core Rules

1. Do not import editor runtime, React state, renderer state, or UI-only command
   policy.
2. Use `@flowdoc/vnext-core` as the document semantics engine; do not copy core
   operation logic into this repo.
3. Backend owns transport envelopes, stale gates, persistence records, request
   ids, and response status.
4. Keep storage, HTTP routing, contract parsing, and core mutation orchestration
   split by responsibility.
5. Treat in-memory storage as a replaceable adapter, not the canonical backend
   architecture.
6. Every mutation must include a base revision check before calling core.
7. Prefer small, reversible patches with focused tests.

## Cross-Repo Coordination

Before editor/API transport, mutation packet, or retained core contract
integration work, read
`../flowdoc-vnext-core/docs/CROSS_REPO_OPERATING_MAP.md`. The backend is the
service boundary between editor intent and `@flowdoc/vnext-core` semantics:
own transport envelopes, revision gates, persistence records, request ids, and
response status here while leaving canonical document semantics in core.

For broad delegated topics, follow the delegated major topic workflow in the
cross-repo map: split into phases, execute until complete or blocked, then hand
off with the required review output.

## Required Review Output

When handing off broad work, include:

- PASS
- FAIL / BLOCKER
- RISK
- UNKNOWN
- files changed
- behavior changed
- tests run
- risks left
- intentionally not changed
