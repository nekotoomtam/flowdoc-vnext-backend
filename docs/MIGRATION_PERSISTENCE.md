# Package Migration Persistence

Status: Phase 259 backend revision-gated migration persistence complete for the
in-memory repository and concrete HTTP server slice.

## Route

```text
POST /documents/:documentId/migrations/package-v3-document-v4
```

The request requires `baseRevision`, `documentId`, `requestId`, and `source`.
The route validates path/body identity before service execution.

## Execution Order

```text
idempotency receipt lookup
  -> document read
  -> base-revision gate
  -> active package 2/document 3 gate
  -> core migration plan
  -> core migration apply and target validation
  -> atomic target write plus source snapshot retention
  -> applied/stale/rejected response
```

No target package is written when planning, apply, or strict target validation
is blocked.

## Revision And Snapshot Contract

An accepted migration:

- retains the exact package 2/document 3 source at its original revision;
- writes package 3/document 4 at `sourceRevision + 1`;
- records request id, source revision, target revision, retention timestamp, and
  migration summary in a receipt;
- exposes the new target through the normal document read route;
- advertises package 3/document 4 through `documentRead` while retaining only
  package 2/document 3 under `mutation`;
- rejects active mutations against the migrated record.

The snapshot and receipt reads return clones so callers cannot mutate retained
repository state.

## Idempotency

The repository keys receipts by document id and request id. The fingerprint
includes base revision, document id, request id, source, and reason.

- identical replay returns the original target revision with
  `idempotency: replayed`;
- reused request id with different payload returns `idempotency-conflict`;
- a different request racing after an accepted migration returns stale.

## HTTP Status

| Result | HTTP status |
|---|---:|
| applied or idempotent replay | 200 |
| stale revision | 409 |
| semantic/storage rejection | 422 |
| malformed JSON/request or path/body mismatch | 400 |

## PASS

- Base revision is checked before core planning.
- Core owns migration semantics and target validation.
- Backend owns request parsing, idempotency, revision write, snapshot retention,
  and transport results.
- Package 3/document 4 is persisted without enabling active v4 mutation.
- Capability reporting now advertises persistence and retention as available.

## FAIL / BLOCKER

- V4 supports same-parent `node.reorder`; remaining operations, pagination,
  exact renderer, and export remain unavailable.

## RISK

- The current repository is in-memory; process restart loses records,
  snapshots, and idempotency receipts.
- A production adapter needs one transaction across target record, source
  snapshot, and receipt.
- Retention expiry, authorization, audit identity, and storage quotas are not
  implemented.

## UNKNOWN

- Source snapshot retention duration and deletion policy.
- Production database transaction and indexing strategy.
- Whether migration requires elevated permission or document-owner permission.

## Intentionally Not Changed

- generation/artifact routes and storage;
- active mutation semantics for package 2/document 3;
- editor migration UI or state;
- v4 layout, rendering, and export;
- auth, tenancy, deployment, or production database behavior.

## Next Recommended Direction

Define v4 delete/duplicate ownership and reference-impact rules before widening
the operation list.
