# PDF Export Local PostgreSQL And S3-Compatible Adapters

Status: `PDF-EXPORT-LOCAL-C` provider adapters, explicit migration/setup,
restart/fault qualification, competing-connection evidence, and resumable
orphan enumeration accepted. Worker hosting, route mounting, Editor
integration, readiness, deployment, and production binding remain closed.

## Outcome

LOCAL-C implements the existing V-B through V-F provider-neutral repository
and content-store interfaces with real local providers:

- PostgreSQL owns operation admission, lifecycle heads/transitions, artifact
  manifests/jobs/receipts, and terminal observability/completion metadata;
- an S3-compatible store owns SHA-256-addressed PDF bytes; and
- one composition helper opens the four repositories over one bounded pool
  only after the explicit schema migration has been accepted.

Both providers require `runtimeProfile = local-integration` and loopback
targets. They retain `productionBinding = false`. Importing their modules does
not create a pool/client, migrate a schema, create a bucket, start a listener,
run a timer, launch a worker, or scan/delete content.

## PostgreSQL Boundary

Schema `flowdoc-pdf-export-local-postgres-v1` is installed only through
`migrateFlowDocBackendPdfExportLocalPostgresV1`. The migration uses a bounded
advisory lock and retains one migration identity plus SQL checksum; a changed
checksum for the same version fails closed. Normal repository creation only
asserts that the accepted schema already exists.

The versioned schema retains:

- immutable scoped caller-key operations;
- revisioned lifecycle heads and immutable transition receipts;
- artifact manifests, jobs, and terminal persistence receipts; and
- privacy-safe event batches and terminal workflow completions.

Every multi-record mutation uses one checked-out PostgreSQL client and one
transaction. Lifecycle mutation locks the current head and applies revision/
fingerprint compare-and-swap. Artifact persistence orders manifest before job
before receipt in one transaction. Terminal events and workflow completion
commit together. Provider failure and lock/statement waits are bounded and do
not fall back to SQLite or memory.

## Byte Store

The S3-compatible adapter requires an unauthenticated loopback HTTP origin,
path-style addressing, explicit local credentials, a bounded prefix, and a
pre-existing bucket. Bucket creation occurs only through the explicit setup
function used by the migration command.

Writes derive the object key from the PDF SHA-256, use a conditional create,
then read the physical bytes back and verify length and digest before returning
success. Reads and deletes revalidate the content-addressed identity. Provider
SDK fields, endpoint details, credentials, and bucket names do not enter Core
or public route contracts.

Orphan enumeration uses bounded `ListObjectsV2` pages. Its opaque cursor is
bound to the store identity and continuation token, so a cursor from another
endpoint/bucket/prefix fails closed. Reconciliation accepts and returns that
cursor, rechecks metadata immediately before deletion, and can advance beyond
the first prefix without starvation.

## Local Tooling

`docker-compose.pdf-export-local.yml` pins PostgreSQL 17.10 and MinIO release
images by digest, binds all ports to `127.0.0.1`, and stores data in named local
volumes. `.env.local` is ignored and generated once with random local-only
credentials.

```text
npm run pdf-export-local:env
npm run pdf-export-local:up
npm run pdf-export-local:migrate
npm run pdf-export-local:down
```

Reset is destructive and therefore requires the explicit local confirmation
command. It refuses a non-local profile, non-loopback PostgreSQL URL, or
non-loopback object-store endpoint before removing the named volumes.

```text
npm run pdf-export-local:reset
```

For machines without an available container daemon, the portable evidence
command runs an actual temporary PostgreSQL 17.10 process and a checksum-pinned
MinIO binary on random loopback ports, then removes its temporary data. It does
not substitute SQLite, filesystem storage, or mocked provider behavior.

```text
npm run pdf-export-local:test:portable
```

## Evidence

The real-provider integration suite proves:

- complete V-B through V-F execution and exact terminal replay after closing
  and reopening both providers;
- one scoped caller-key owner and one lifecycle claim owner across independent
  PostgreSQL pools;
- exact recovery around operation, lifecycle, artifact, and observability
  transaction commit boundaries, including internal multi-record cut points;
- physical S3 readback and content identity; and
- five objects traversed and deleted through bounded two-object pages without
  rescanning only the first prefix.

The LOCAL-C acceptance gate passed `15/15` integration cases. Follow-up
LOCAL-D extends the same portable real-provider gate to `19/19`, and LOCAL-E
extends it to `20/20` with separate HTTP/worker request-to-download evidence.
The default test suite keeps those cases explicitly skipped unless
`FLOWDOC_PDF_LOCAL_INTEGRATION=1`; provider validation and cursor contracts run
without external services.

Primary evidence:

- `src/pdfExport/pdfExportLocalPostgresSupport.ts`;
- `src/pdfExport/pdfExportLocalPostgresRepositories.ts`;
- `src/pdfExport/pdfExportOperationPostgresRepository.ts`;
- `src/pdfExport/pdfExportLifecyclePostgresRepository.ts`;
- `src/pdfExport/pdfExportArtifactPersistencePostgresRepository.ts`;
- `src/pdfExport/pdfExportObservabilityPostgresRepository.ts`;
- `src/pdfExport/pdfExportS3ContentAddressedStore.ts`;
- `src/pdfExport/pdfExportArtifactPersistence.ts`;
- `src/tests/pdfExportLocalProviderContracts.test.ts`; and
- `src/tests/pdfExportLocalProviders.integration.test.ts`.

## RISK

- PostgreSQL and MinIO evidence is local and single-machine. It does not prove
  hosted latency, failover, backup restore, multi-region behavior, or capacity.
- V-B through V-F intentionally span multiple transactions. LOCAL-D now owns
  bounded due-work discovery, reconciliation cadence, and shutdown drain;
  hosted operational monitoring remains unselected.
- The portable PostgreSQL package is development evidence only. The pinned
  Compose topology remains the canonical persistent local environment.
- Object listing cursors are resumable but provider-issued continuation tokens
  are not portable across bucket replacement or prefix reconfiguration; the
  store-identity binding intentionally rejects those changes.

## UNKNOWN

- Measured poll/backoff tuning under accepted local workloads.
- Hosted PostgreSQL, object storage, retention, backup, monitoring, and cost
  selections for a future production review.

## Intentionally Not Changed

- Core document, admission, lifecycle, handoff, receipt, completion, or commit
  ordering contracts.
- SQLite and filesystem adapters retained for unit and restart evidence.
- Renderer implementation or production renderer selection.
- Default Backend server, HTTP route mount, or import-time worker/cleanup loop.
- Editor source, development proxy, controls, or production configuration.
- Production provider, deployment, activation flag, or V-G NO-GO decision.

Follow-up `PDF-EXPORT-LOCAL-D` accepts durable due-work discovery and the
dedicated local worker lifecycle in
`docs/PDF_EXPORT_LOCAL_DURABLE_WORKER.md`. LOCAL-E accepts the concrete
composition and loopback HTTP process in
`docs/PDF_EXPORT_LOCAL_HTTP_COMPOSITION.md`; LOCAL-F remains responsible for the
Editor development-proxy and export-control integration.
