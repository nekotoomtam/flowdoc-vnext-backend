import type { Pool, PoolClient } from "pg"
import {
  calculateFlowDocBackendPdfExportArtifactProjectionFingerprintV1,
  createFlowDocBackendPdfExportArtifactPersistenceReceiptV1,
  parseFlowDocBackendPdfExportArtifactPersistenceReceiptV1,
  FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_REPOSITORY_V1_SOURCE,
  type FlowDocBackendPdfExportArtifactPersistenceReadResultV1,
  type FlowDocBackendPdfExportArtifactPersistenceReceiptV1,
  type FlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  type FlowDocBackendPdfExportArtifactProjectionCommitResultV1,
  type FlowDocBackendPdfExportArtifactProjectionRequestV1,
} from "./pdfExportArtifactPersistence.js"
import {
  flowDocBackendPdfExportFingerprintV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
} from "./pdfExportOperation.js"
import {
  beginFlowDocBackendPdfExportPostgresTransactionV1,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
  isFlowDocBackendPdfExportPostgresUnavailableErrorV1,
  type FlowDocBackendPdfExportPostgresQueryableV1,
} from "./pdfExportLocalPostgresSupport.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_POSTGRES_V1_SOURCE =
  "flowdoc-backend-pdf-export-artifact-persistence-postgres" as const

export type FlowDocBackendPdfExportPersistencePostgresFaultPointV1 =
  | "after-manifest-cas"
  | "after-job-cas"
  | "before-commit"
  | "after-commit"

export interface FlowDocBackendPdfExportPersistencePostgresFaultContextV1 {
  transactionKind: "artifact-projection"
  point: FlowDocBackendPdfExportPersistencePostgresFaultPointV1
  operationId: string
  persistenceId: string
}

export interface FlowDocBackendPdfExportPersistencePostgresOptionsV1 {
  pool: Pool
  lockTimeoutMs: number
  faultInjector?: (context: FlowDocBackendPdfExportPersistencePostgresFaultContextV1) => void | Promise<void>
}

export interface FlowDocBackendPdfExportPersistencePostgresRepositoryV1
extends FlowDocBackendPdfExportArtifactPersistenceRepositoryV1 {
  postgresSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_POSTGRES_V1_SOURCE
  localPostgresSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE
  productionBinding: false
}

interface StoredProjectionRowV1 {
  persistence_id: string
  operation_id: string
  tenant_id: string
  principal_id: string
  operation_fingerprint: string
  render_execution_fingerprint: string
  completion_fingerprint: string
  projection_fingerprint: string
  storage_key: string
  byte_length: number
  sha256: string
  artifact_id: string
  manifest_revision: number
  manifest_fingerprint: string
  manifest_json: string
  job_id: string
  job_revision: number
  job_fingerprint: string
  job_json: string
  committed_at: string
  receipt_fingerprint: string
  receipt_json: string
}

const SELECT_PROJECTION = `
  SELECT r.persistence_id, r.operation_id, r.tenant_id, r.principal_id,
    r.operation_fingerprint, r.render_execution_fingerprint, r.completion_fingerprint,
    r.projection_fingerprint, r.storage_key, r.byte_length, r.sha256,
    m.artifact_id, m.revision AS manifest_revision,
    m.record_fingerprint AS manifest_fingerprint, m.record_json AS manifest_json,
    j.job_id, j.revision AS job_revision,
    j.record_fingerprint AS job_fingerprint, j.record_json AS job_json,
    r.committed_at, r.receipt_fingerprint, r.receipt_json
  FROM flowdoc_pdf_export_artifact_receipts_v1 r
  JOIN flowdoc_pdf_export_artifact_manifests_v1 m ON m.operation_id = r.operation_id
  JOIN flowdoc_pdf_export_artifact_jobs_v1 j ON j.operation_id = r.operation_id
`

function issue(code: string, path: string, message: string) {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function unavailableCommit(): FlowDocBackendPdfExportArtifactProjectionCommitResultV1 {
  return {
    status: "storage-unavailable",
    receipt: null,
    issues: [issue(
      "pdf-export-persistence-postgres-unavailable",
      "repository",
      "local PostgreSQL artifact projection is unavailable within its bounded wait",
    )],
  }
}

function unavailableRead(): FlowDocBackendPdfExportArtifactPersistenceReadResultV1 {
  return {
    status: "storage-unavailable",
    receipt: null,
    issues: [issue(
      "pdf-export-persistence-postgres-unavailable",
      "repository",
      "local PostgreSQL artifact persistence read is unavailable within its bounded wait",
    )],
  }
}

function conflict(
  message: string,
  receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null = null,
): FlowDocBackendPdfExportArtifactProjectionCommitResultV1 {
  return {
    status: "conflict",
    receipt,
    issues: [issue("pdf-export-persistence-cas-conflict", "projection", message)],
  }
}

async function projectionRowByOperationId(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  operationId: string,
): Promise<StoredProjectionRowV1 | undefined> {
  const result = await queryable.query<StoredProjectionRowV1>(`${SELECT_PROJECTION}
    WHERE r.operation_id = $1
  `, [operationId])
  return result.rows[0]
}

async function projectionRowByPersistenceId(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  persistenceId: string,
): Promise<StoredProjectionRowV1 | undefined> {
  const result = await queryable.query<StoredProjectionRowV1>(`${SELECT_PROJECTION}
    WHERE r.persistence_id = $1
  `, [persistenceId])
  return result.rows[0]
}

function parseStoredProjection(row: StoredProjectionRowV1): FlowDocBackendPdfExportArtifactPersistenceReadResultV1 {
  let value: unknown
  try {
    value = JSON.parse(row.receipt_json) as unknown
  } catch (error) {
    return {
      status: "invalid",
      receipt: null,
      issues: [issue(
        "pdf-export-persistence-storage-json-invalid",
        "receiptJson",
        error instanceof Error ? error.message : "stored receipt JSON is invalid",
      )],
    }
  }
  const parsed = parseFlowDocBackendPdfExportArtifactPersistenceReceiptV1(value)
  if (parsed.status === "blocked") return { status: "invalid", receipt: null, issues: parsed.issues }
  const receipt = parsed.receipt
  const columnsMatch = receipt.persistenceId === row.persistence_id
    && receipt.operationId === row.operation_id
    && receipt.scope.tenantId === row.tenant_id
    && receipt.scope.principalId === row.principal_id
    && receipt.operationFingerprint === row.operation_fingerprint
    && receipt.renderExecutionFingerprint === row.render_execution_fingerprint
    && receipt.core.completion.completionFingerprint === row.completion_fingerprint
    && receipt.projection.projectionFingerprint === row.projection_fingerprint
    && receipt.bytes.storageKey === row.storage_key
    && receipt.bytes.byteLength === row.byte_length
    && receipt.bytes.sha256 === row.sha256
    && receipt.projection.manifest.artifactId === row.artifact_id
    && receipt.projection.manifestRevision === row.manifest_revision
    && flowDocBackendPdfExportFingerprintV1(receipt.projection.manifest) === row.manifest_fingerprint
    && JSON.stringify(receipt.projection.manifest) === row.manifest_json
    && receipt.projection.job.jobId === row.job_id
    && receipt.projection.jobRevision === row.job_revision
    && flowDocBackendPdfExportFingerprintV1(receipt.projection.job) === row.job_fingerprint
    && JSON.stringify(receipt.projection.job) === row.job_json
    && receipt.committedAt === row.committed_at
    && receipt.persistenceReceiptFingerprint === row.receipt_fingerprint
  if (!columnsMatch) return {
    status: "invalid",
    receipt: null,
    issues: [issue(
      "pdf-export-persistence-storage-projection-mismatch",
      "repository",
      "stored projection columns must match the exact retained receipt, manifest, and job",
    )],
  }
  return { status: "found", receipt, issues: [] }
}

function validateRequest(request: FlowDocBackendPdfExportArtifactProjectionRequestV1):
  | { status: "ready"; receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 }
  | { status: "invalid"; result: FlowDocBackendPdfExportArtifactProjectionCommitResultV1 } {
  if (request.expectedManifestRevision !== null || request.expectedJobRevision !== null) return {
    status: "invalid",
    result: {
      status: "invalid",
      receipt: null,
      issues: [issue(
        "pdf-export-persistence-cas-revision-invalid",
        "expectedRevision",
        "V-E creates manifest and job from an absent CAS revision",
      )],
    },
  }
  const calculated = calculateFlowDocBackendPdfExportArtifactProjectionFingerprintV1({
    operation: request.operation,
    attempt: request.rendererAttempt,
    content: request.storedContent,
    manifest: request.manifest,
    job: request.job,
    committedAt: request.committedAt,
  })
  if (calculated !== request.projectionFingerprint) return {
    status: "invalid",
    result: {
      status: "invalid",
      receipt: null,
      issues: [issue(
        "pdf-export-persistence-projection-fingerprint-invalid",
        "projectionFingerprint",
        "projection fingerprint must bind exact bytes, manifest, and job",
      )],
    },
  }
  const receipt = createFlowDocBackendPdfExportArtifactPersistenceReceiptV1(request)
  const parsed = parseFlowDocBackendPdfExportArtifactPersistenceReceiptV1(receipt)
  return parsed.status === "ready"
    ? { status: "ready", receipt: parsed.receipt }
    : { status: "invalid", result: { status: "invalid", receipt: null, issues: parsed.issues } }
}

async function lockProjectionIdentities(
  client: PoolClient,
  request: FlowDocBackendPdfExportArtifactProjectionRequestV1,
): Promise<void> {
  const identities = [
    request.operation.operationId,
    request.persistenceId,
    request.manifest.artifactId,
    request.job.jobId,
  ].sort()
  for (const identity of identities) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_POSTGRES_V1_SOURCE,
      identity,
    ])
  }
}

export function createFlowDocBackendPdfExportPersistencePostgresRepositoryV1(
  options: FlowDocBackendPdfExportPersistencePostgresOptionsV1,
): FlowDocBackendPdfExportPersistencePostgresRepositoryV1 {
  const fault = async (
    point: FlowDocBackendPdfExportPersistencePostgresFaultPointV1,
    request: FlowDocBackendPdfExportArtifactProjectionRequestV1,
  ) => options.faultInjector?.({
    transactionKind: "artifact-projection",
    point,
    operationId: request.operation.operationId,
    persistenceId: request.persistenceId,
  })
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_REPOSITORY_V1_SOURCE,
    postgresSource: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_POSTGRES_V1_SOURCE,
    localPostgresSource: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
    productionBinding: false,

    async commitProjection(request) {
      const validated = validateRequest(request)
      if (validated.status === "invalid") return validated.result
      const receipt = validated.receipt
      let client: PoolClient | null = null
      let committed = false
      try {
        client = await options.pool.connect()
        await beginFlowDocBackendPdfExportPostgresTransactionV1(client, options.lockTimeoutMs)
        await lockProjectionIdentities(client, request)
        const persistenceOwner = await projectionRowByPersistenceId(client, request.persistenceId)
        if (persistenceOwner != null && persistenceOwner.operation_id !== request.operation.operationId) {
          await client.query("COMMIT")
          committed = true
          return conflict("persistence id is already owned by another operation")
        }
        const existingRow = await projectionRowByOperationId(client, request.operation.operationId)
        if (existingRow != null) {
          const existing = parseStoredProjection(existingRow)
          await client.query("COMMIT")
          committed = true
          if (existing.status !== "found") return { status: "invalid", receipt: null, issues: existing.issues }
          return existing.receipt.projection.projectionFingerprint === request.projectionFingerprint
            ? { status: "idempotent-replay", receipt: existing.receipt, issues: [] }
            : conflict("operation already owns a different terminal artifact projection", existing.receipt)
        }
        const artifactOwner = await client.query<{ operation_id: string }>(`
          SELECT operation_id FROM flowdoc_pdf_export_artifact_manifests_v1 WHERE artifact_id = $1
        `, [request.manifest.artifactId])
        if (artifactOwner.rowCount !== 0) {
          await client.query("COMMIT")
          committed = true
          return conflict("artifact id is already owned by another operation")
        }
        const jobOwner = await client.query<{ operation_id: string }>(`
          SELECT operation_id FROM flowdoc_pdf_export_artifact_jobs_v1 WHERE job_id = $1
        `, [request.job.jobId])
        if (jobOwner.rowCount !== 0) {
          await client.query("COMMIT")
          committed = true
          return conflict("job id is already owned by another operation")
        }

        await client.query(`
          INSERT INTO flowdoc_pdf_export_artifact_manifests_v1 (
            artifact_id, operation_id, revision, storage_key, record_fingerprint, record_json
          ) VALUES ($1, $2, 0, $3, $4, $5)
        `, [
          request.manifest.artifactId,
          request.operation.operationId,
          request.storedContent.storageKey,
          flowDocBackendPdfExportFingerprintV1(request.manifest),
          JSON.stringify(request.manifest),
        ])
        await fault("after-manifest-cas", request)
        await client.query(`
          INSERT INTO flowdoc_pdf_export_artifact_jobs_v1 (
            job_id, operation_id, revision, artifact_id, record_fingerprint, record_json
          ) VALUES ($1, $2, 0, $3, $4, $5)
        `, [
          request.job.jobId,
          request.operation.operationId,
          request.manifest.artifactId,
          flowDocBackendPdfExportFingerprintV1(request.job),
          JSON.stringify(request.job),
        ])
        await fault("after-job-cas", request)
        await client.query(`
          INSERT INTO flowdoc_pdf_export_artifact_receipts_v1 (
            persistence_id, operation_id, tenant_id, principal_id,
            operation_fingerprint, render_execution_fingerprint, completion_fingerprint,
            projection_fingerprint, storage_key, byte_length, sha256,
            committed_at, receipt_fingerprint, receipt_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
          receipt.persistenceId,
          receipt.operationId,
          receipt.scope.tenantId,
          receipt.scope.principalId,
          receipt.operationFingerprint,
          receipt.renderExecutionFingerprint,
          receipt.core.completion.completionFingerprint,
          receipt.projection.projectionFingerprint,
          receipt.bytes.storageKey,
          receipt.bytes.byteLength,
          receipt.bytes.sha256,
          receipt.committedAt,
          receipt.persistenceReceiptFingerprint,
          JSON.stringify(receipt),
        ])
        await fault("before-commit", request)
        await client.query("COMMIT")
        committed = true
        await fault("after-commit", request)
        return { status: "committed", receipt, issues: [] }
      } catch (error) {
        if (!committed && client != null) await client.query("ROLLBACK").catch(() => undefined)
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableCommit()
        throw error
      } finally {
        client?.release()
      }
    },

    async readByOperationId(input) {
      if (
        !isFlowDocBackendPdfExportBoundedStringV1(input.tenantId)
        || !isFlowDocBackendPdfExportBoundedStringV1(input.principalId)
        || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)
      ) return {
        status: "invalid",
        receipt: null,
        issues: [issue("pdf-export-persistence-read-invalid", "operationId", "persistence read scope must be bounded")],
      }
      try {
        const row = await projectionRowByOperationId(options.pool, input.operationId)
        if (row == null || row.tenant_id !== input.tenantId || row.principal_id !== input.principalId) {
          return { status: "not-found", receipt: null, issues: [] }
        }
        return parseStoredProjection(row)
      } catch (error) {
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableRead()
        throw error
      }
    },

    async inspectStorageReference(input) {
      if (typeof input.storageKey !== "string" || input.storageKey.trim().length === 0) return {
        status: "invalid",
        issues: [issue(
          "pdf-export-persistence-storage-key-invalid",
          "storageKey",
          "storage reference lookup requires a non-empty key",
        )],
      }
      try {
        const result = await options.pool.query<{ referenced: number }>(`
          SELECT 1 AS referenced
          FROM flowdoc_pdf_export_artifact_receipts_v1
          WHERE storage_key = $1
          LIMIT 1
        `, [input.storageKey])
        return { status: result.rowCount === 0 ? "unreferenced" : "referenced", issues: [] }
      } catch (error) {
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return {
          status: "storage-unavailable",
          issues: unavailableRead().issues,
        }
        throw error
      }
    },
  }
}
