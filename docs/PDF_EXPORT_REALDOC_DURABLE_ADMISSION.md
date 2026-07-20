# PDF Export REALDOC Durable Admission

Status: `PDF-EXPORT-REALDOC-E.6.1` accepted for the optional local Backend
runtime. Production remains NO-GO.

## Boundary

`createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1(...)` is the first
durable REALDOC-E generation boundary. It replaces only the protected
admission repository. Trusted Structure/mapping/asset registries, operation
repositories, lifecycle repositories, artifact persistence, and the optional
HTTP composition are not automatically rewired by this factory.

The repository requires Node `24.15.0` or newer and uses built-in
`node:sqlite`. Its storage facts are:

```text
kind: sqlite
durablePersistence: true
processRestartReplay: true
productionBinding: false
```

The existing in-memory repository remains valid, reports both durability and
process restart replay as false, and keeps unchanged local behavior.

## Stored Record

The strict `docgen_local_admissions` table retains scoped idempotency keys,
request and identity fingerprints, accepted time, and the complete protected
canonical admission record. It has unique constraints for admission id,
Document Instance id, and tenant/principal/caller key.

The stored JSON contains canonical snapshots needed by later materialization.
It does not retain adapted `payloadText`, the raw payload descriptor, mapper
credentials, or public business-value responses. E.6.1 tests include a
raw-only payload marker and prove that neither its key nor value reaches the
protected record.

## Integrity

Every read uses the strict protected-record schema and recomputes:

- diagnostics fingerprint and issue/warning counts;
- receipt fingerprint and admission/runtime facts;
- canonical input and canonical content fingerprints;
- media registry and Document Instance identity alignment; and
- complete protected record fingerprint.

Indexed SQLite columns are cross-checked against the parsed record. Any schema,
identity, fingerprint, or column drift throws at the repository boundary. The
admission service and PDF binding convert that failure to content-free
`unavailable` behavior; they do not remap, repair, or overwrite silently.

## Transaction And Replay

SQLite opens with WAL, foreign keys, `synchronous = FULL`, and a bounded busy
timeout. Insert uses `BEGIN IMMEDIATE` and one commit. Scoped caller-key and
instance uniqueness make competing or repeated inserts converge on the
original record.

The public admission receipt now reports `durablePersistence` from repository
facts. Its receipt fingerprint therefore truthfully distinguishes memory-only
from durable admission. A replay from a later process returns the stored
receipt unchanged rather than constructing a new one.

## Accepted Evidence

| Scenario | Accepted result |
| --- | --- |
| independent process restart | process A creates/maps once; process B replays with zero mapper calls and the same receipt/instance |
| request replay | same scoped key and strict request returns `replayed` |
| request drift | same scoped key and changed request returns `idempotency-conflict` before mapping |
| fault before commit | admission returns `unavailable`, database has no record, retry creates once |
| fault after commit | first response is uncertain `unavailable`, reopened retry returns `replayed` |
| record corruption | strict read rejects and admission fails closed without mapping |
| downstream binding fact | memory reports false; SQLite reports true from the repository storage contract |

## Remaining E.6

E.6.1 does not make the current optional REALDOC runtime fully restartable.

- `E.6.2`: durably compose operation, lifecycle, observability, artifact
  metadata, artifact bytes, worker reconstruction, status, and download.
- `E.6.3`: prove Editor reload/reconnect, cancel/retry reconciliation,
  diagnostics, stale rejection, and download over that composition.

## Explicitly Not Changed

- no default application-server mount or automatic worker startup;
- no production repository/provider qualification or migration policy;
- no hosted identity, tenancy, retention, deployment, SLO, or cost decision;
- no SQLite scheduler optimization or new 240-page measurement;
- no Module 2 expansion or complete 200-page run; and
- no production activation.

## Verification

```text
npm test -- --run src/tests/docGenLocalAdmissionSqliteRepository.test.ts
npm test -- --run src/tests/docGenLocalAdmission.test.ts src/tests/docGenLocalPdfExport.test.ts
npm run type-check
```

## Next Phase

`PDF-EXPORT-REALDOC-E.6.2` owns durable operation and artifact restart.
Production remains NO-GO.
