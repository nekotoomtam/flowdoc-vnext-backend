# PDF Export Local Readiness Audit

Status: `PDF-EXPORT-LOCAL-G` canonical local-integration readiness gate
accepted on 2026-07-19. This closes the LOCAL-A through LOCAL-G qualification
sequence. It does not mount the default Backend server, admit product documents,
select hosted providers, or change the production activation decision from
NO-GO.

## Accepted Scope

The accepted workload is exactly one Phase T canonical 13-page PDF execution
followed by one exact caller-key replay in a fresh operating-system process.
Both processes create independent HTTP and worker compositions over the same
temporary PostgreSQL 17.10 database and pinned MinIO object store. The replay
returns the same operation and byte identity while the second worker reports
zero listed and zero invoked work.

The retained artifact remains:

- 13 pages;
- `1212656` bytes; and
- SHA-256
  `c4d09f0dfd66e1e3983bc679602fdc7d397de30edcb4f93fac3a0fa0c422960b`.

## Exit-Gate Evidence

| Requirement | Accepted evidence |
| --- | --- |
| Restart identity and terminal replay | Two child Node processes execute and replay the exact HTTP-to-download path; only the first renders and persists. |
| Cancellation checkpoints | Actual HTTP cancellation closes before handoff with no object; focused workflow/renderer/persistence tests retain before-render, mid-render, and before-persist coverage. |
| Stale trusted facts | Source revision and renderer qualification tests remain closed; a copied canonical resource with one changed digest now fails before admission or renderer creation. |
| Competing ownership | Actual PostgreSQL tests retain one lifecycle claim/execution winner; persistence tests retain one terminal projection owner. |
| Missing or corrupt bytes | Actual MinIO bytes are deleted or replaced after write and before readback; both cases block with no receipt, manifest/job projection, or workflow completion. |
| Orphan cleanup | Actual MinIO continuation tests traverse every bounded page and do not starve later prefixes. |
| Editor gates | Exact eligibility/status parsers, document-revision invalidation, stale async-result suppression, no browser credential, and production-build proxy exclusion remain covered in Editor. |
| Closed runtime | Both process records retain loopback-only listener, remote-provider denial, default-server exclusion, dedicated worker start, and `productionBinding = false`. |

## Measured Envelope

The portable actual-provider run on 2026-07-19 produced the following
qualification record. The limit is a repeatable local guardrail, not a
production SLO, capacity forecast, or hosted-provider claim.

| Metric | Observed | LOCAL-G limit |
| --- | ---: | ---: |
| aggregate child-process workload time | 3315 ms | 120000 ms |
| aggregate child-process CPU time | 3110 ms | 120000 ms |
| peak child-process RSS | 370290688 bytes | 1610612736 bytes |
| maximum child-process RSS growth | 227958784 bytes | 536870912 bytes |
| PDF metadata rows | 16 | 64 |
| PDF metadata relation storage | 655360 bytes | 33554432 bytes |
| retained object count | 1 | exactly 1 |
| retained object bytes | 1212656 | exactly 1212656 |
| HTTP requests across execute/replay | 7 | 16 |

`qualifyFlowDocBackendPdfExportLocalReadinessV1` fails closed when any bound,
artifact identity, process/replay fact, listener fact, or production-closure
fact drifts. The readiness record contains no credential or caller identity.

## Provider Gate

`npm run pdf-export-local:test:portable` passed `24/24` actual-provider cases.
The Vitest portion completed in 40.90 seconds and the complete provider harness
in 58.7 seconds on the recorded run. The harness creates temporary providers,
binds them only to loopback, emits no credential, and removes its temporary
data after completion.

Primary evidence:

- `src/pdfExport/pdfExportLocalReadiness.ts`;
- `src/tests/pdfExportLocalReadiness.test.ts`;
- `src/tests/helpers/pdfExportLocalProcessEvidence.ts`;
- `src/tests/pdfExportLocalProviders.integration.test.ts`;
- `src/tests/pdfExportLocalComposition.test.ts`;
- `src/tests/pdfExportWorkflow.test.ts`;
- `src/tests/pdfExportRendererAttempt.test.ts`;
- `src/tests/pdfExportArtifactPersistence.test.ts`; and
- `../flowdoc-vnext-editor/src/tests/localPdfExport.test.ts`.

## Remaining Boundary

LOCAL-G proves one bounded canonical developer workload. It does not prove
arbitrary product-document eligibility, concurrent or sustained load, hosted
latency, backup/restore, disaster recovery, multi-region behavior, production
security, provider cost, or operational SLOs.

The next local product task is not to make the current Editor working-set
document eligible. REALDOC-E.3 now admits one exact Published Structure Version
plus caller-owned data through a bounded optional local route and retains a
protected canonical record. REALDOC-E.4 now binds that record to
source-neutral resolution and the existing local artifact lifecycle without
changing the default composition. REALDOC-E.5.0 now locks the local Library,
shared Design/Preview workspace, and generated-Form boundary without runtime
activation. REALDOC-E.5.1 now adds the bounded local Library read model and
metadata route without changing this readiness envelope; later E.5
phases expose the accepted admission and artifact lifecycle without canonical
fixture substitution.
Editor test import and an external API-shaped caller must still
converge before resolution. Production provider selection remains a separate
deferred review. See `docs/PDF_EXPORT_REALDOC_DOCGEN_HANDOFF.md`.
