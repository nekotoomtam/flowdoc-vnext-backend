import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  parseFlowDocBackendPdfExportOperationV1,
  type FlowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_REPOSITORY_V1_SOURCE =
  "flowdoc-backend-pdf-export-operation-repository" as const

export interface FlowDocBackendPdfExportOperationScopeV1 {
  tenantId: string
  principalId: string
}

export type FlowDocBackendPdfExportOperationAdmitResultV1 =
  | {
      status: "created" | "idempotent-replay"
      operation: FlowDocBackendPdfExportOperationV1
      existingOperationId: string
      issues: []
    }
  | {
      status: "conflict"
      operation: null
      existingOperationId: string | null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }
  | {
      status: "invalid" | "storage-unavailable"
      operation: null
      existingOperationId: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportOperationReadResultV1 =
  | { status: "found"; operation: FlowDocBackendPdfExportOperationV1; issues: [] }
  | { status: "not-found"; operation: null; issues: [] }
  | {
      status: "invalid" | "storage-unavailable"
      operation: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportOperationRepositoryV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_REPOSITORY_V1_SOURCE
  admitOperation(operation: unknown): Promise<FlowDocBackendPdfExportOperationAdmitResultV1>
  readByOperationId(input: FlowDocBackendPdfExportOperationScopeV1 & {
    operationId: string
  }): Promise<FlowDocBackendPdfExportOperationReadResultV1>
  readByCallerKey(input: FlowDocBackendPdfExportOperationScopeV1 & {
    callerIdempotencyKey: string
  }): Promise<FlowDocBackendPdfExportOperationReadResultV1>
}

function callerKey(input: FlowDocBackendPdfExportOperationScopeV1 & {
  callerIdempotencyKey: string
}): string {
  return JSON.stringify([input.tenantId, input.principalId, input.callerIdempotencyKey])
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

function validScope(input: FlowDocBackendPdfExportOperationScopeV1): boolean {
  return isFlowDocBackendPdfExportBoundedStringV1(input.tenantId)
    && isFlowDocBackendPdfExportBoundedStringV1(input.principalId)
}

export function createInMemoryFlowDocBackendPdfExportOperationRepositoryV1():
FlowDocBackendPdfExportOperationRepositoryV1 {
  const byOperationId = new Map<string, FlowDocBackendPdfExportOperationV1>()
  const operationIdByCallerKey = new Map<string, string>()

  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_REPOSITORY_V1_SOURCE,

    async admitOperation(value) {
      const parsed = parseFlowDocBackendPdfExportOperationV1(value)
      if (parsed.status === "blocked") return {
        status: "invalid",
        operation: null,
        existingOperationId: null,
        issues: parsed.issues,
      }
      const operation = parsed.operation
      const key = callerKey({
        ...operation.scope,
        callerIdempotencyKey: operation.idempotency.callerKey,
      })
      const callerOperationId = operationIdByCallerKey.get(key)
      if (callerOperationId != null) {
        const existing = byOperationId.get(callerOperationId)
        if (existing == null) return {
          status: "invalid",
          operation: null,
          existingOperationId: null,
          issues: [flowDocBackendPdfExportOperationIssueV1(
            "pdf-export-operation-idempotency-index-invalid",
            "idempotency.callerKey",
            "caller-key index does not resolve to a retained operation",
          )],
        }
        if (existing.idempotency.payloadFingerprint === operation.idempotency.payloadFingerprint) {
          return {
            status: "idempotent-replay",
            operation: cloneFlowDocBackendPdfExportJsonV1(existing),
            existingOperationId: existing.operationId,
            issues: [],
          }
        }
        return {
          status: "conflict",
          operation: null,
          existingOperationId: existing.operationId,
          issues: [flowDocBackendPdfExportOperationIssueV1(
            "pdf-export-operation-idempotency-conflict",
            "idempotency.payloadFingerprint",
            "caller idempotency key is already bound to a different Core payload",
          )],
        }
      }
      const operationOwner = byOperationId.get(operation.operationId)
      if (operationOwner != null) return {
        status: "conflict",
        operation: null,
        existingOperationId: operationOwner.operationId,
        issues: [flowDocBackendPdfExportOperationIssueV1(
          "pdf-export-operation-id-conflict",
          "operationId",
          "operation id is already retained under another caller-key binding",
        )],
      }
      byOperationId.set(operation.operationId, cloneFlowDocBackendPdfExportJsonV1(operation))
      operationIdByCallerKey.set(key, operation.operationId)
      return {
        status: "created",
        operation: cloneFlowDocBackendPdfExportJsonV1(operation),
        existingOperationId: operation.operationId,
        issues: [],
      }
    },

    async readByOperationId(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)) {
        return invalidRead("operationId")
      }
      const operation = byOperationId.get(input.operationId)
      if (operation == null
        || operation.scope.tenantId !== input.tenantId
        || operation.scope.principalId !== input.principalId) {
        return { status: "not-found", operation: null, issues: [] }
      }
      return {
        status: "found",
        operation: cloneFlowDocBackendPdfExportJsonV1(operation),
        issues: [],
      }
    },

    async readByCallerKey(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.callerIdempotencyKey)) {
        return invalidRead("callerIdempotencyKey")
      }
      const operationId = operationIdByCallerKey.get(callerKey(input))
      if (operationId == null) return { status: "not-found", operation: null, issues: [] }
      const operation = byOperationId.get(operationId)
      if (operation == null) return {
        status: "invalid",
        operation: null,
        issues: [flowDocBackendPdfExportOperationIssueV1(
          "pdf-export-operation-idempotency-index-invalid",
          "callerIdempotencyKey",
          "caller-key index does not resolve to a retained operation",
        )],
      }
      return {
        status: "found",
        operation: cloneFlowDocBackendPdfExportJsonV1(operation),
        issues: [],
      }
    },
  }
}
