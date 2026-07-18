import type { DatabaseSync } from "node:sqlite"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  parseFlowDocBackendPdfExportOperationV1,
  type FlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_REPOSITORY_V1_SOURCE,
  type FlowDocBackendPdfExportOperationAdmitResultV1,
  type FlowDocBackendPdfExportOperationReadResultV1,
  type FlowDocBackendPdfExportOperationRepositoryV1,
  type FlowDocBackendPdfExportOperationScopeV1,
} from "./pdfExportOperationRepository.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_SQLITE_V1_SOURCE =
  "flowdoc-backend-pdf-export-operation-sqlite" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_SQLITE_MINIMUM_NODE = "24.15.0"

export type FlowDocBackendPdfExportOperationSqliteFaultPointV1 = "before-commit" | "after-commit"

export interface FlowDocBackendPdfExportOperationSqliteFaultContextV1 {
  transactionKind: "operation-admit"
  point: FlowDocBackendPdfExportOperationSqliteFaultPointV1
  operationId: string
}

export interface FlowDocBackendPdfExportOperationSqliteOptionsV1 {
  databasePath: string
  busyTimeoutMs?: number
  faultInjector?: (context: FlowDocBackendPdfExportOperationSqliteFaultContextV1) => void
}

export interface FlowDocBackendPdfExportOperationSqliteRepositoryV1
  extends FlowDocBackendPdfExportOperationRepositoryV1 {
  sqliteSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_SQLITE_V1_SOURCE
  databasePath: string
  close(): void
}

interface StoredOperationRow {
  operation_id: string
  tenant_id: string
  principal_id: string
  caller_key: string
  payload_fingerprint: string
  admission_fingerprint: string
  operation_fingerprint: string
  accepted_at: string
  operation_json: string
}

function parseNodeVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value)
  return match == null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function versionAtLeast(
  actual: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  for (let index = 0; index < actual.length; index += 1) {
    const current = actual[index] ?? 0
    const required = minimum[index] ?? 0
    if (current > required) return true
    if (current < required) return false
  }
  return true
}

export function supportsFlowDocBackendPdfExportOperationSqliteV1(
  nodeVersion = process.versions.node,
): boolean {
  const actual = parseNodeVersion(nodeVersion)
  const minimum = parseNodeVersion(FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_SQLITE_MINIMUM_NODE)
  return actual != null && minimum != null && versionAtLeast(actual, minimum)
}

function isBusyError(error: unknown): boolean {
  return error instanceof Error && /database(?: table)? is locked/iu.test(error.message)
}

function validScope(input: FlowDocBackendPdfExportOperationScopeV1): boolean {
  return isFlowDocBackendPdfExportBoundedStringV1(input.tenantId)
    && isFlowDocBackendPdfExportBoundedStringV1(input.principalId)
}

function unavailableAdmit(): FlowDocBackendPdfExportOperationAdmitResultV1 {
  return {
    status: "storage-unavailable",
    operation: null,
    existingOperationId: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-sqlite-busy",
      "repository",
      "SQLite PDF export operation admission exceeded its bounded writer wait",
    )],
  }
}

function unavailableRead(): FlowDocBackendPdfExportOperationReadResultV1 {
  return {
    status: "storage-unavailable",
    operation: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-sqlite-busy",
      "repository",
      "SQLite PDF export operation read exceeded its bounded wait",
    )],
  }
}

function invalidRead(path: string): FlowDocBackendPdfExportOperationReadResultV1 {
  return {
    status: "invalid",
    operation: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-read-identity-invalid",
      path,
      "PDF export operation reads require bounded tenant, principal, and lookup identities",
    )],
  }
}

function parseStoredRow(row: StoredOperationRow): FlowDocBackendPdfExportOperationReadResultV1 {
  let value: unknown
  try {
    value = JSON.parse(row.operation_json) as unknown
  } catch (error) {
    return {
      status: "invalid",
      operation: null,
      issues: [flowDocBackendPdfExportOperationIssueV1(
        "pdf-export-operation-storage-json-invalid",
        "operationJson",
        error instanceof Error ? error.message : "stored operation JSON is invalid",
      )],
    }
  }
  const parsed = parseFlowDocBackendPdfExportOperationV1(value)
  if (parsed.status === "blocked") return {
    status: "invalid",
    operation: null,
    issues: parsed.issues,
  }
  const operation = parsed.operation
  const matchesColumns = operation.operationId === row.operation_id
    && operation.scope.tenantId === row.tenant_id
    && operation.scope.principalId === row.principal_id
    && operation.idempotency.callerKey === row.caller_key
    && operation.idempotency.payloadFingerprint === row.payload_fingerprint
    && operation.admission.admissionFingerprint === row.admission_fingerprint
    && operation.operationFingerprint === row.operation_fingerprint
    && operation.acceptedAt === row.accepted_at
  if (!matchesColumns) return {
    status: "invalid",
    operation: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-storage-projection-mismatch",
      "repository",
      "stored operation columns must match the exact retained operation JSON",
    )],
  }
  return {
    status: "found",
    operation: cloneFlowDocBackendPdfExportJsonV1(operation),
    issues: [],
  }
}

function rowByCallerKey(
  database: DatabaseSync,
  input: FlowDocBackendPdfExportOperationScopeV1 & { callerIdempotencyKey: string },
): StoredOperationRow | undefined {
  return database.prepare(`
    SELECT operation_id, tenant_id, principal_id, caller_key,
      payload_fingerprint, admission_fingerprint, operation_fingerprint,
      accepted_at, operation_json
    FROM pdf_export_operations
    WHERE tenant_id = ? AND principal_id = ? AND caller_key = ?
  `).get(input.tenantId, input.principalId, input.callerIdempotencyKey) as StoredOperationRow | undefined
}

function rowByOperationId(database: DatabaseSync, operationId: string): StoredOperationRow | undefined {
  return database.prepare(`
    SELECT operation_id, tenant_id, principal_id, caller_key,
      payload_fingerprint, admission_fingerprint, operation_fingerprint,
      accepted_at, operation_json
    FROM pdf_export_operations
    WHERE operation_id = ?
  `).get(operationId) as StoredOperationRow | undefined
}

async function openDatabase(
  options: FlowDocBackendPdfExportOperationSqliteOptionsV1,
): Promise<DatabaseSync> {
  if (!supportsFlowDocBackendPdfExportOperationSqliteV1()) {
    throw new Error(
      `PDF export operation SQLite requires Node ${FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_SQLITE_MINIMUM_NODE} or newer`,
    )
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
    CREATE TABLE IF NOT EXISTS pdf_export_operations (
      operation_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      caller_key TEXT NOT NULL,
      payload_fingerprint TEXT NOT NULL,
      admission_fingerprint TEXT NOT NULL,
      operation_fingerprint TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      operation_json TEXT NOT NULL,
      UNIQUE (tenant_id, principal_id, caller_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS pdf_export_operations_scope_idx
      ON pdf_export_operations (tenant_id, principal_id, operation_id);
  `)
  return database
}

function createRepository(
  database: DatabaseSync,
  options: FlowDocBackendPdfExportOperationSqliteOptionsV1,
): FlowDocBackendPdfExportOperationSqliteRepositoryV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_REPOSITORY_V1_SOURCE,
    sqliteSource: FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_SQLITE_V1_SOURCE,
    databasePath: options.databasePath,

    async admitOperation(value) {
      const parsed = parseFlowDocBackendPdfExportOperationV1(value)
      if (parsed.status === "blocked") return {
        status: "invalid",
        operation: null,
        existingOperationId: null,
        issues: parsed.issues,
      }
      const operation = parsed.operation
      try {
        database.exec("BEGIN IMMEDIATE")
        let created = false
        let result: FlowDocBackendPdfExportOperationAdmitResultV1
        const currentCallerRow = rowByCallerKey(database, {
          ...operation.scope,
          callerIdempotencyKey: operation.idempotency.callerKey,
        })
        if (currentCallerRow != null) {
          const current = parseStoredRow(currentCallerRow)
          if (current.status !== "found") result = {
            status: "invalid",
            operation: null,
            existingOperationId: null,
            issues: current.issues,
          }
          else if (current.operation.idempotency.payloadFingerprint
            === operation.idempotency.payloadFingerprint) result = {
            status: "idempotent-replay",
            operation: current.operation,
            existingOperationId: current.operation.operationId,
            issues: [],
          }
          else result = {
            status: "conflict",
            operation: null,
            existingOperationId: current.operation.operationId,
            issues: [flowDocBackendPdfExportOperationIssueV1(
              "pdf-export-operation-idempotency-conflict",
              "idempotency.payloadFingerprint",
              "caller idempotency key is already bound to a different Core payload",
            )],
          }
        } else {
          const operationOwnerRow = rowByOperationId(database, operation.operationId)
          if (operationOwnerRow != null) result = {
            status: "conflict",
            operation: null,
            existingOperationId: operation.operationId,
            issues: [flowDocBackendPdfExportOperationIssueV1(
              "pdf-export-operation-id-conflict",
              "operationId",
              "operation id is already retained under another caller-key binding",
            )],
          }
          else {
            database.prepare(`
              INSERT INTO pdf_export_operations (
                operation_id, tenant_id, principal_id, caller_key,
                payload_fingerprint, admission_fingerprint, operation_fingerprint,
                accepted_at, operation_json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              operation.operationId,
              operation.scope.tenantId,
              operation.scope.principalId,
              operation.idempotency.callerKey,
              operation.idempotency.payloadFingerprint,
              operation.admission.admissionFingerprint,
              operation.operationFingerprint,
              operation.acceptedAt,
              JSON.stringify(operation),
            )
            created = true
            result = {
              status: "created",
              operation: cloneFlowDocBackendPdfExportJsonV1(operation),
              existingOperationId: operation.operationId,
              issues: [],
            }
          }
        }
        if (created) options.faultInjector?.({
          transactionKind: "operation-admit",
          point: "before-commit",
          operationId: operation.operationId,
        })
        database.exec("COMMIT")
        if (created) options.faultInjector?.({
          transactionKind: "operation-admit",
          point: "after-commit",
          operationId: operation.operationId,
        })
        return result
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK")
        if (isBusyError(error)) return unavailableAdmit()
        throw error
      }
    },

    async readByOperationId(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)) {
        return invalidRead("operationId")
      }
      try {
        const row = rowByOperationId(database, input.operationId)
        if (row == null || row.tenant_id !== input.tenantId || row.principal_id !== input.principalId) {
          return { status: "not-found", operation: null, issues: [] }
        }
        return parseStoredRow(row)
      } catch (error) {
        if (isBusyError(error)) return unavailableRead()
        throw error
      }
    },

    async readByCallerKey(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.callerIdempotencyKey)) {
        return invalidRead("callerIdempotencyKey")
      }
      try {
        const row = rowByCallerKey(database, input)
        return row == null ? { status: "not-found", operation: null, issues: [] } : parseStoredRow(row)
      } catch (error) {
        if (isBusyError(error)) return unavailableRead()
        throw error
      }
    },

    close() {
      database.close()
    },
  }
}

export async function createFlowDocBackendPdfExportOperationSqliteRepositoryV1(
  options: FlowDocBackendPdfExportOperationSqliteOptionsV1,
): Promise<FlowDocBackendPdfExportOperationSqliteRepositoryV1> {
  const database = await openDatabase(options)
  return createRepository(database, options)
}
