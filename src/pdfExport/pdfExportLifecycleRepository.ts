import {
  applyFlowDocBackendPdfExportLifecycleTransitionV1,
  createFlowDocBackendPdfExportLifecycleHeadV1,
  inspectFlowDocBackendPdfExportLifecycleTransitionRequestV1,
  lifecycleOperationMatchesV1,
  type FlowDocBackendPdfExportLifecycleHeadV1,
  type FlowDocBackendPdfExportLifecycleTransitionReceiptV1,
  type FlowDocBackendPdfExportLifecycleTransitionRequestV1,
} from "./pdfExportLifecycle.js"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  parseFlowDocBackendPdfExportOperationV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"
import type { FlowDocBackendPdfExportOperationScopeV1 } from "./pdfExportOperationRepository.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_REPOSITORY_V1_SOURCE =
  "flowdoc-backend-pdf-export-lifecycle-repository" as const

export type FlowDocBackendPdfExportLifecycleInitializeResultV1 =
  | {
      status: "created" | "idempotent-replay"
      head: FlowDocBackendPdfExportLifecycleHeadV1
      issues: []
    }
  | {
      status: "conflict" | "invalid" | "storage-unavailable"
      head: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportLifecycleReadResultV1 =
  | { status: "found"; head: FlowDocBackendPdfExportLifecycleHeadV1; issues: [] }
  | { status: "not-found"; head: null; issues: [] }
  | {
      status: "invalid" | "storage-unavailable"
      head: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportLifecycleTransitionResultV1 =
  | {
      status: "applied" | "idempotent-replay"
      head: FlowDocBackendPdfExportLifecycleHeadV1
      receipt: FlowDocBackendPdfExportLifecycleTransitionReceiptV1
      issues: []
    }
  | {
      status: "blocked" | "stale" | "conflict"
      head: FlowDocBackendPdfExportLifecycleHeadV1
      receipt: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }
  | {
      status: "not-found"
      head: null
      receipt: null
      issues: []
    }
  | {
      status: "invalid" | "storage-unavailable"
      head: null
      receipt: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportLifecycleRepositoryV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_REPOSITORY_V1_SOURCE
  initializeLifecycle(operation: unknown): Promise<FlowDocBackendPdfExportLifecycleInitializeResultV1>
  readLifecycle(input: FlowDocBackendPdfExportOperationScopeV1 & {
    operationId: string
  }): Promise<FlowDocBackendPdfExportLifecycleReadResultV1>
  applyLifecycleTransition(input: unknown): Promise<FlowDocBackendPdfExportLifecycleTransitionResultV1>
}

interface StoredLifecycleV1 {
  scope: FlowDocBackendPdfExportOperationScopeV1
  head: FlowDocBackendPdfExportLifecycleHeadV1
}

interface StoredTransitionV1 {
  requestFingerprint: string
  receipt: FlowDocBackendPdfExportLifecycleTransitionReceiptV1
  resultHead: FlowDocBackendPdfExportLifecycleHeadV1
}

function validScope(input: FlowDocBackendPdfExportOperationScopeV1): boolean {
  return isFlowDocBackendPdfExportBoundedStringV1(input.tenantId)
    && isFlowDocBackendPdfExportBoundedStringV1(input.principalId)
}

function invalidRead(path: string): FlowDocBackendPdfExportLifecycleReadResultV1 {
  return {
    status: "invalid",
    head: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-read-identity-invalid",
      path,
      "lifecycle reads require bounded tenant, principal, and operation identities",
    )],
  }
}

function transitionKey(request: FlowDocBackendPdfExportLifecycleTransitionRequestV1): string {
  return JSON.stringify([request.operationId, request.transitionId])
}

function sameScope(
  left: FlowDocBackendPdfExportOperationScopeV1,
  right: FlowDocBackendPdfExportOperationScopeV1,
): boolean {
  return left.tenantId === right.tenantId && left.principalId === right.principalId
}

export function createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1():
FlowDocBackendPdfExportLifecycleRepositoryV1 {
  const lifecycleByOperationId = new Map<string, StoredLifecycleV1>()
  const transitionByKey = new Map<string, StoredTransitionV1>()

  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_REPOSITORY_V1_SOURCE,

    async initializeLifecycle(value) {
      const parsedOperation = parseFlowDocBackendPdfExportOperationV1(value)
      if (parsedOperation.status === "blocked") return {
        status: "invalid",
        head: null,
        issues: parsedOperation.issues,
      }
      const created = createFlowDocBackendPdfExportLifecycleHeadV1(parsedOperation.operation)
      if (created.status === "blocked") return { status: "invalid", head: null, issues: created.issues }
      const existing = lifecycleByOperationId.get(parsedOperation.operation.operationId)
      if (existing != null) {
        if (sameScope(existing.scope, parsedOperation.operation.scope)
          && lifecycleOperationMatchesV1({ operation: parsedOperation.operation, head: existing.head })) return {
          status: "idempotent-replay",
          head: cloneFlowDocBackendPdfExportJsonV1(existing.head),
          issues: [],
        }
        return {
          status: "conflict",
          head: null,
          issues: [flowDocBackendPdfExportOperationIssueV1(
            "pdf-export-lifecycle-operation-conflict",
            "operationId",
            "operation id already owns lifecycle facts from another immutable operation binding",
          )],
        }
      }
      lifecycleByOperationId.set(parsedOperation.operation.operationId, {
        scope: cloneFlowDocBackendPdfExportJsonV1(parsedOperation.operation.scope),
        head: cloneFlowDocBackendPdfExportJsonV1(created.head),
      })
      return { status: "created", head: cloneFlowDocBackendPdfExportJsonV1(created.head), issues: [] }
    },

    async readLifecycle(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)) {
        return invalidRead("operationId")
      }
      const stored = lifecycleByOperationId.get(input.operationId)
      if (stored == null || !sameScope(stored.scope, input)) return { status: "not-found", head: null, issues: [] }
      return { status: "found", head: cloneFlowDocBackendPdfExportJsonV1(stored.head), issues: [] }
    },

    async applyLifecycleTransition(value) {
      const inspected = inspectFlowDocBackendPdfExportLifecycleTransitionRequestV1(value)
      if (inspected.status === "blocked") return {
        status: "invalid",
        head: null,
        receipt: null,
        issues: inspected.issues,
      }
      const request = inspected.request
      const stored = lifecycleByOperationId.get(request.operationId)
      if (stored == null || !sameScope(stored.scope, request)) return {
        status: "not-found",
        head: null,
        receipt: null,
        issues: [],
      }
      const replay = transitionByKey.get(transitionKey(request))
      if (replay != null) {
        if (replay.requestFingerprint === inspected.requestFingerprint) return {
          status: "idempotent-replay",
          head: cloneFlowDocBackendPdfExportJsonV1(replay.resultHead),
          receipt: cloneFlowDocBackendPdfExportJsonV1(replay.receipt),
          issues: [],
        }
        return {
          status: "conflict",
          head: cloneFlowDocBackendPdfExportJsonV1(stored.head),
          receipt: null,
          issues: [flowDocBackendPdfExportOperationIssueV1(
            "pdf-export-lifecycle-transition-conflict",
            "transitionId",
            "transition id is already bound to a different request fingerprint",
          )],
        }
      }
      if (request.expectedHeadRevision !== stored.head.headRevision) return {
        status: "stale",
        head: cloneFlowDocBackendPdfExportJsonV1(stored.head),
        receipt: null,
        issues: [flowDocBackendPdfExportOperationIssueV1(
          "pdf-export-lifecycle-revision-stale",
          "expectedHeadRevision",
          "transition expected revision does not own the current head",
        )],
      }
      const applied = applyFlowDocBackendPdfExportLifecycleTransitionV1({ head: stored.head, request })
      if (applied.status === "blocked") return {
        status: "blocked",
        head: applied.head ?? cloneFlowDocBackendPdfExportJsonV1(stored.head),
        receipt: null,
        issues: applied.issues,
      }
      stored.head = cloneFlowDocBackendPdfExportJsonV1(applied.head)
      transitionByKey.set(transitionKey(request), {
        requestFingerprint: inspected.requestFingerprint,
        receipt: cloneFlowDocBackendPdfExportJsonV1(applied.receipt),
        resultHead: cloneFlowDocBackendPdfExportJsonV1(applied.head),
      })
      return {
        status: "applied",
        head: cloneFlowDocBackendPdfExportJsonV1(applied.head),
        receipt: cloneFlowDocBackendPdfExportJsonV1(applied.receipt),
        issues: [],
      }
    },
  }
}
