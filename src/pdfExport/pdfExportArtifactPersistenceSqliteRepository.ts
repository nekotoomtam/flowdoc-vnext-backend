import type { DatabaseSync } from "node:sqlite"
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
import { supportsFlowDocBackendPdfExportOperationSqliteV1 } from "./pdfExportOperationSqliteRepository.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_SQLITE_V1_SOURCE =
  "flowdoc-backend-pdf-export-artifact-persistence-sqlite" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_SQLITE_MINIMUM_NODE = "24.15.0"

export type FlowDocBackendPdfExportPersistenceSqliteFaultPointV1 =
  | "after-manifest-cas"
  | "after-job-cas"
  | "before-commit"
  | "after-commit"

export interface FlowDocBackendPdfExportPersistenceSqliteFaultContextV1 {
  transactionKind: "artifact-projection"
  point: FlowDocBackendPdfExportPersistenceSqliteFaultPointV1
  operationId: string
  persistenceId: string
}

export interface FlowDocBackendPdfExportPersistenceSqliteOptionsV1 {
  databasePath: string
  busyTimeoutMs?: number
  faultInjector?: (context: FlowDocBackendPdfExportPersistenceSqliteFaultContextV1) => void
}

export interface FlowDocBackendPdfExportPersistenceSqliteRepositoryV1
extends FlowDocBackendPdfExportArtifactPersistenceRepositoryV1 {
  sqliteSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_SQLITE_V1_SOURCE
  databasePath: string
  close(): void
}

interface StoredProjectionRow {
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

function issue(code: string, path: string, message: string) {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function isBusyError(error: unknown): boolean {
  return error instanceof Error && /database(?: table)? is locked/iu.test(error.message)
}

function unavailableCommit(): FlowDocBackendPdfExportArtifactProjectionCommitResultV1 {
  return {
    status: "storage-unavailable",
    receipt: null,
    issues: [issue("pdf-export-persistence-sqlite-busy", "repository", "SQLite artifact projection exceeded its bounded writer wait")],
  }
}

function unavailableRead(): FlowDocBackendPdfExportArtifactPersistenceReadResultV1 {
  return {
    status: "storage-unavailable",
    receipt: null,
    issues: [issue("pdf-export-persistence-sqlite-busy", "repository", "SQLite artifact persistence read exceeded its bounded wait")],
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

function projectionRowByOperationId(database: DatabaseSync, operationId: string): StoredProjectionRow | undefined {
  return database.prepare(`
    SELECT r.persistence_id, r.operation_id, r.tenant_id, r.principal_id,
      r.operation_fingerprint, r.render_execution_fingerprint, r.completion_fingerprint,
      r.projection_fingerprint, r.storage_key, r.byte_length, r.sha256,
      m.artifact_id, m.revision AS manifest_revision,
      m.record_fingerprint AS manifest_fingerprint, m.record_json AS manifest_json,
      j.job_id, j.revision AS job_revision,
      j.record_fingerprint AS job_fingerprint, j.record_json AS job_json,
      r.committed_at, r.receipt_fingerprint, r.receipt_json
    FROM pdf_export_artifact_persistence_receipts r
    JOIN pdf_export_artifact_manifests m ON m.operation_id = r.operation_id
    JOIN pdf_export_artifact_jobs j ON j.operation_id = r.operation_id
    WHERE r.operation_id = ?
  `).get(operationId) as StoredProjectionRow | undefined
}

function projectionRowByPersistenceId(database: DatabaseSync, persistenceId: string): StoredProjectionRow | undefined {
  return database.prepare(`
    SELECT r.persistence_id, r.operation_id, r.tenant_id, r.principal_id,
      r.operation_fingerprint, r.render_execution_fingerprint, r.completion_fingerprint,
      r.projection_fingerprint, r.storage_key, r.byte_length, r.sha256,
      m.artifact_id, m.revision AS manifest_revision,
      m.record_fingerprint AS manifest_fingerprint, m.record_json AS manifest_json,
      j.job_id, j.revision AS job_revision,
      j.record_fingerprint AS job_fingerprint, j.record_json AS job_json,
      r.committed_at, r.receipt_fingerprint, r.receipt_json
    FROM pdf_export_artifact_persistence_receipts r
    JOIN pdf_export_artifact_manifests m ON m.operation_id = r.operation_id
    JOIN pdf_export_artifact_jobs j ON j.operation_id = r.operation_id
    WHERE r.persistence_id = ?
  `).get(persistenceId) as StoredProjectionRow | undefined
}

function parseStoredProjection(row: StoredProjectionRow): FlowDocBackendPdfExportArtifactPersistenceReadResultV1 {
  let value: unknown
  try {
    value = JSON.parse(row.receipt_json) as unknown
  } catch (error) {
    return {
      status: "invalid",
      receipt: null,
      issues: [issue("pdf-export-persistence-storage-json-invalid", "receiptJson", error instanceof Error ? error.message : "stored receipt JSON is invalid")],
    }
  }
  const parsed = parseFlowDocBackendPdfExportArtifactPersistenceReceiptV1(value)
  if (parsed.status === "blocked") return { status: "invalid", receipt: null, issues: parsed.issues }
  const receipt = parsed.receipt
  const manifestJson = JSON.stringify(receipt.projection.manifest)
  const jobJson = JSON.stringify(receipt.projection.job)
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
    && manifestJson === row.manifest_json
    && receipt.projection.job.jobId === row.job_id
    && receipt.projection.jobRevision === row.job_revision
    && flowDocBackendPdfExportFingerprintV1(receipt.projection.job) === row.job_fingerprint
    && jobJson === row.job_json
    && receipt.committedAt === row.committed_at
    && receipt.persistenceReceiptFingerprint === row.receipt_fingerprint
  if (!columnsMatch) return {
    status: "invalid",
    receipt: null,
    issues: [issue("pdf-export-persistence-storage-projection-mismatch", "repository", "stored projection columns must match the exact retained receipt, manifest, and job")],
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
      issues: [issue("pdf-export-persistence-cas-revision-invalid", "expectedRevision", "V-E creates manifest and job from an absent CAS revision")],
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
      issues: [issue("pdf-export-persistence-projection-fingerprint-invalid", "projectionFingerprint", "projection fingerprint must bind exact bytes, manifest, and job")],
    },
  }
  const receipt = createFlowDocBackendPdfExportArtifactPersistenceReceiptV1(request)
  const parsed = parseFlowDocBackendPdfExportArtifactPersistenceReceiptV1(receipt)
  return parsed.status === "ready"
    ? { status: "ready", receipt: parsed.receipt }
    : { status: "invalid", result: { status: "invalid", receipt: null, issues: parsed.issues } }
}

async function openDatabase(options: FlowDocBackendPdfExportPersistenceSqliteOptionsV1): Promise<DatabaseSync> {
  if (!supportsFlowDocBackendPdfExportOperationSqliteV1()) {
    throw new Error(`PDF export persistence SQLite requires Node ${FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_SQLITE_MINIMUM_NODE} or newer`)
  }
  const { DatabaseSync } = await import("node:sqlite")
  const database = new DatabaseSync(options.databasePath, {
    timeout: options.busyTimeoutMs ?? 5_000,
    enableForeignKeyConstraints: true,
    allowExtension: false,
  })
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS pdf_export_artifact_manifests (
      artifact_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      revision INTEGER NOT NULL CHECK (revision = 0),
      storage_key TEXT NOT NULL,
      record_fingerprint TEXT NOT NULL,
      record_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pdf_export_artifact_jobs (
      job_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      revision INTEGER NOT NULL CHECK (revision = 0),
      artifact_id TEXT NOT NULL,
      record_fingerprint TEXT NOT NULL,
      record_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pdf_export_artifact_persistence_receipts (
      persistence_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      operation_fingerprint TEXT NOT NULL,
      render_execution_fingerprint TEXT NOT NULL,
      completion_fingerprint TEXT NOT NULL,
      projection_fingerprint TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      sha256 TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      receipt_fingerprint TEXT NOT NULL,
      receipt_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS pdf_export_artifact_persistence_scope_idx
      ON pdf_export_artifact_persistence_receipts (tenant_id, principal_id, operation_id);
    CREATE INDEX IF NOT EXISTS pdf_export_artifact_persistence_storage_idx
      ON pdf_export_artifact_persistence_receipts (storage_key);
  `)
  return database
}

function createRepository(
  database: DatabaseSync,
  options: FlowDocBackendPdfExportPersistenceSqliteOptionsV1,
): FlowDocBackendPdfExportPersistenceSqliteRepositoryV1 {
  const fault = (point: FlowDocBackendPdfExportPersistenceSqliteFaultPointV1, request: FlowDocBackendPdfExportArtifactProjectionRequestV1) => options.faultInjector?.({
    transactionKind: "artifact-projection",
    point,
    operationId: request.operation.operationId,
    persistenceId: request.persistenceId,
  })
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_REPOSITORY_V1_SOURCE,
    sqliteSource: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_SQLITE_V1_SOURCE,
    databasePath: options.databasePath,

    async commitProjection(request) {
      const validated = validateRequest(request)
      if (validated.status === "invalid") return validated.result
      const receipt = validated.receipt
      try {
        database.exec("BEGIN IMMEDIATE")
        const persistenceOwner = projectionRowByPersistenceId(database, request.persistenceId)
        if (persistenceOwner != null && persistenceOwner.operation_id !== request.operation.operationId) {
          database.exec("COMMIT")
          return conflict("persistence id is already owned by another operation")
        }
        const existingRow = projectionRowByOperationId(database, request.operation.operationId)
        if (existingRow != null) {
          const existing = parseStoredProjection(existingRow)
          database.exec("COMMIT")
          if (existing.status !== "found") return {
            status: "invalid",
            receipt: null,
            issues: existing.issues,
          }
          return existing.receipt.projection.projectionFingerprint === request.projectionFingerprint
            ? { status: "idempotent-replay", receipt: existing.receipt, issues: [] }
            : conflict("operation already owns a different terminal artifact projection", existing.receipt)
        }
        const artifactOwner = database.prepare(`
          SELECT operation_id FROM pdf_export_artifact_manifests WHERE artifact_id = ?
        `).get(request.manifest.artifactId) as { operation_id: string } | undefined
        if (artifactOwner != null) {
          database.exec("COMMIT")
          return conflict("artifact id is already owned by another operation")
        }
        const jobOwner = database.prepare(`
          SELECT operation_id FROM pdf_export_artifact_jobs WHERE job_id = ?
        `).get(request.job.jobId) as { operation_id: string } | undefined
        if (jobOwner != null) {
          database.exec("COMMIT")
          return conflict("job id is already owned by another operation")
        }

        database.prepare(`
          INSERT INTO pdf_export_artifact_manifests (
            artifact_id, operation_id, revision, storage_key, record_fingerprint, record_json
          ) VALUES (?, ?, 0, ?, ?, ?)
        `).run(
          request.manifest.artifactId,
          request.operation.operationId,
          request.storedContent.storageKey,
          flowDocBackendPdfExportFingerprintV1(request.manifest),
          JSON.stringify(request.manifest),
        )
        fault("after-manifest-cas", request)
        database.prepare(`
          INSERT INTO pdf_export_artifact_jobs (
            job_id, operation_id, revision, artifact_id, record_fingerprint, record_json
          ) VALUES (?, ?, 0, ?, ?, ?)
        `).run(
          request.job.jobId,
          request.operation.operationId,
          request.manifest.artifactId,
          flowDocBackendPdfExportFingerprintV1(request.job),
          JSON.stringify(request.job),
        )
        fault("after-job-cas", request)
        database.prepare(`
          INSERT INTO pdf_export_artifact_persistence_receipts (
            persistence_id, operation_id, tenant_id, principal_id,
            operation_fingerprint, render_execution_fingerprint, completion_fingerprint,
            projection_fingerprint, storage_key, byte_length, sha256,
            committed_at, receipt_fingerprint, receipt_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
        )
        fault("before-commit", request)
        database.exec("COMMIT")
        fault("after-commit", request)
        return { status: "committed", receipt, issues: [] }
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK")
        if (isBusyError(error)) return unavailableCommit()
        throw error
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
        const row = projectionRowByOperationId(database, input.operationId)
        if (row == null || row.tenant_id !== input.tenantId || row.principal_id !== input.principalId) {
          return { status: "not-found", receipt: null, issues: [] }
        }
        return parseStoredProjection(row)
      } catch (error) {
        if (isBusyError(error)) return unavailableRead()
        throw error
      }
    },

    async inspectStorageReference(input) {
      if (typeof input.storageKey !== "string" || input.storageKey.trim().length === 0) return {
        status: "invalid",
        issues: [issue("pdf-export-persistence-storage-key-invalid", "storageKey", "storage reference lookup requires a non-empty key")],
      }
      try {
        const row = database.prepare(`
          SELECT 1 AS referenced FROM pdf_export_artifact_persistence_receipts WHERE storage_key = ? LIMIT 1
        `).get(input.storageKey) as { referenced: number } | undefined
        return { status: row == null ? "unreferenced" : "referenced", issues: [] }
      } catch (error) {
        if (isBusyError(error)) return {
          status: "storage-unavailable",
          issues: unavailableRead().issues,
        }
        throw error
      }
    },

    close() {
      database.close()
    },
  }
}

export function supportsFlowDocBackendPdfExportPersistenceSqliteV1(
  nodeVersion = process.versions.node,
): boolean {
  return supportsFlowDocBackendPdfExportOperationSqliteV1(nodeVersion)
}

export async function createFlowDocBackendPdfExportPersistenceSqliteRepositoryV1(
  options: FlowDocBackendPdfExportPersistenceSqliteOptionsV1,
): Promise<FlowDocBackendPdfExportPersistenceSqliteRepositoryV1> {
  const database = await openDatabase(options)
  return createRepository(database, options)
}
