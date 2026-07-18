import type { Pool, PoolClient } from "pg"
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
import {
  beginFlowDocBackendPdfExportPostgresTransactionV1,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
  isFlowDocBackendPdfExportPostgresUnavailableErrorV1,
  type FlowDocBackendPdfExportPostgresQueryableV1,
} from "./pdfExportLocalPostgresSupport.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_POSTGRES_V1_SOURCE =
  "flowdoc-backend-pdf-export-operation-postgres" as const

export type FlowDocBackendPdfExportOperationPostgresFaultPointV1 = "before-commit" | "after-commit"

export interface FlowDocBackendPdfExportOperationPostgresFaultContextV1 {
  transactionKind: "operation-admit"
  point: FlowDocBackendPdfExportOperationPostgresFaultPointV1
  operationId: string
}

export interface FlowDocBackendPdfExportOperationPostgresOptionsV1 {
  pool: Pool
  lockTimeoutMs: number
  faultInjector?: (context: FlowDocBackendPdfExportOperationPostgresFaultContextV1) => void | Promise<void>
}

export interface FlowDocBackendPdfExportOperationPostgresRepositoryV1
extends FlowDocBackendPdfExportOperationRepositoryV1 {
  postgresSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_POSTGRES_V1_SOURCE
  localPostgresSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE
  productionBinding: false
}

interface StoredOperationRowV1 {
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

const SELECT_OPERATION = `
  SELECT operation_id, tenant_id, principal_id, caller_key,
    payload_fingerprint, admission_fingerprint, operation_fingerprint,
    accepted_at, operation_json
  FROM flowdoc_pdf_export_operations_v1
`

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
      "pdf-export-operation-postgres-unavailable",
      "repository",
      "local PostgreSQL operation admission is unavailable within its bounded wait",
    )],
  }
}

function unavailableRead(): FlowDocBackendPdfExportOperationReadResultV1 {
  return {
    status: "storage-unavailable",
    operation: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-postgres-unavailable",
      "repository",
      "local PostgreSQL operation read is unavailable within its bounded wait",
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

function parseStoredRow(row: StoredOperationRowV1): FlowDocBackendPdfExportOperationReadResultV1 {
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
  if (parsed.status === "blocked") return { status: "invalid", operation: null, issues: parsed.issues }
  const operation = parsed.operation
  if (
    operation.operationId !== row.operation_id
    || operation.scope.tenantId !== row.tenant_id
    || operation.scope.principalId !== row.principal_id
    || operation.idempotency.callerKey !== row.caller_key
    || operation.idempotency.payloadFingerprint !== row.payload_fingerprint
    || operation.admission.admissionFingerprint !== row.admission_fingerprint
    || operation.operationFingerprint !== row.operation_fingerprint
    || operation.acceptedAt !== row.accepted_at
  ) return {
    status: "invalid",
    operation: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-storage-projection-mismatch",
      "repository",
      "stored operation columns must match the exact retained operation JSON",
    )],
  }
  return { status: "found", operation: cloneFlowDocBackendPdfExportJsonV1(operation), issues: [] }
}

async function rowByCallerKey(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  input: FlowDocBackendPdfExportOperationScopeV1 & { callerIdempotencyKey: string },
): Promise<StoredOperationRowV1 | undefined> {
  const result = await queryable.query<StoredOperationRowV1>(`${SELECT_OPERATION}
    WHERE tenant_id = $1 AND principal_id = $2 AND caller_key = $3
  `, [input.tenantId, input.principalId, input.callerIdempotencyKey])
  return result.rows[0]
}

async function rowByOperationId(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  operationId: string,
): Promise<StoredOperationRowV1 | undefined> {
  const result = await queryable.query<StoredOperationRowV1>(`${SELECT_OPERATION}
    WHERE operation_id = $1
  `, [operationId])
  return result.rows[0]
}

async function operationResultAfterNoInsert(
  client: PoolClient,
  operation: FlowDocBackendPdfExportOperationV1,
): Promise<FlowDocBackendPdfExportOperationAdmitResultV1> {
  const callerOwner = await rowByCallerKey(client, {
    ...operation.scope,
    callerIdempotencyKey: operation.idempotency.callerKey,
  })
  if (callerOwner != null) {
    const current = parseStoredRow(callerOwner)
    if (current.status !== "found") return {
      status: "invalid",
      operation: null,
      existingOperationId: null,
      issues: current.issues,
    }
    if (current.operation.idempotency.payloadFingerprint === operation.idempotency.payloadFingerprint) return {
      status: "idempotent-replay",
      operation: current.operation,
      existingOperationId: current.operation.operationId,
      issues: [],
    }
    return {
      status: "conflict",
      operation: null,
      existingOperationId: current.operation.operationId,
      issues: [flowDocBackendPdfExportOperationIssueV1(
        "pdf-export-operation-idempotency-conflict",
        "idempotency.payloadFingerprint",
        "caller idempotency key is already bound to a different Core payload",
      )],
    }
  }
  const operationOwner = await rowByOperationId(client, operation.operationId)
  return {
    status: "conflict",
    operation: null,
    existingOperationId: operationOwner?.operation_id ?? null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-id-conflict",
      "operationId",
      "operation id is already retained under another caller-key binding",
    )],
  }
}

export function createFlowDocBackendPdfExportOperationPostgresRepositoryV1(
  options: FlowDocBackendPdfExportOperationPostgresOptionsV1,
): FlowDocBackendPdfExportOperationPostgresRepositoryV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_REPOSITORY_V1_SOURCE,
    postgresSource: FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_POSTGRES_V1_SOURCE,
    localPostgresSource: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
    productionBinding: false,

    async admitOperation(value) {
      const parsed = parseFlowDocBackendPdfExportOperationV1(value)
      if (parsed.status === "blocked") return {
        status: "invalid",
        operation: null,
        existingOperationId: null,
        issues: parsed.issues,
      }
      const operation = parsed.operation
      let client: PoolClient | null = null
      let committed = false
      try {
        client = await options.pool.connect()
        await beginFlowDocBackendPdfExportPostgresTransactionV1(client, options.lockTimeoutMs)
        const inserted = await client.query<{ operation_id: string }>(`
          INSERT INTO flowdoc_pdf_export_operations_v1 (
            operation_id, tenant_id, principal_id, caller_key,
            payload_fingerprint, admission_fingerprint, operation_fingerprint,
            accepted_at, operation_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT DO NOTHING
          RETURNING operation_id
        `, [
          operation.operationId,
          operation.scope.tenantId,
          operation.scope.principalId,
          operation.idempotency.callerKey,
          operation.idempotency.payloadFingerprint,
          operation.admission.admissionFingerprint,
          operation.operationFingerprint,
          operation.acceptedAt,
          JSON.stringify(operation),
        ])
        const created = inserted.rowCount === 1
        const result: FlowDocBackendPdfExportOperationAdmitResultV1 = created
          ? {
              status: "created",
              operation: cloneFlowDocBackendPdfExportJsonV1(operation),
              existingOperationId: operation.operationId,
              issues: [],
            }
          : await operationResultAfterNoInsert(client, operation)
        if (created) await options.faultInjector?.({
          transactionKind: "operation-admit",
          point: "before-commit",
          operationId: operation.operationId,
        })
        await client.query("COMMIT")
        committed = true
        if (created) await options.faultInjector?.({
          transactionKind: "operation-admit",
          point: "after-commit",
          operationId: operation.operationId,
        })
        return result
      } catch (error) {
        if (!committed && client != null) await client.query("ROLLBACK").catch(() => undefined)
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableAdmit()
        throw error
      } finally {
        client?.release()
      }
    },

    async readByOperationId(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)) {
        return invalidRead("operationId")
      }
      try {
        const row = await rowByOperationId(options.pool, input.operationId)
        if (row == null || row.tenant_id !== input.tenantId || row.principal_id !== input.principalId) {
          return { status: "not-found", operation: null, issues: [] }
        }
        return parseStoredRow(row)
      } catch (error) {
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableRead()
        throw error
      }
    },

    async readByCallerKey(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.callerIdempotencyKey)) {
        return invalidRead("callerIdempotencyKey")
      }
      try {
        const row = await rowByCallerKey(options.pool, input)
        return row == null ? { status: "not-found", operation: null, issues: [] } : parseStoredRow(row)
      } catch (error) {
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableRead()
        throw error
      }
    },
  }
}
