import type {
  FlowDocPackageV2DocumentVNext,
  VNextOperationIssue,
  VNextOperationRenderInvalidation,
} from "@flowdoc/vnext-core"

export type BackendMutationSource =
  | "canvas"
  | "keyboard"
  | "outline"
  | "system"
  | "toolbar"

export type BackendMutationStatus = "applied" | "rejected" | "stale"

export type BackendMutationOperation =
  | {
      kind: "node.delete"
      nodeId: string
    }
  | {
      kind: "node.duplicate"
      nodeId: string
    }
  | {
      kind: "node.reorder"
      nodeId: string
      toIndex: number
    }

export type BackendMutationOperationKind = BackendMutationOperation["kind"]

export interface BackendMutationRequest {
  baseRevision: number
  documentId: string
  operation: BackendMutationOperation
  reason?: string
  requestId: string
  source: BackendMutationSource
}

export interface BackendMutationIssue {
  code: string
  message: string
  nodeId?: string
  path: string
  severity: "error" | "info" | "warning"
}

export interface BackendReadTransportEnvelope {
  baseRevision: number
  documentId: string
  envelopeId: string
  packageValue: FlowDocPackageV2DocumentVNext
  purpose: "mutation-result"
  receivedAt: number
  requestedAt: number
  sourceKind: "mutation-result"
  sourceRevision: number
}

export interface BackendMutationCoreSummary {
  historyIntent: "content" | "layout" | "structure" | null
  renderInvalidation: VNextOperationRenderInvalidation | null
}

export interface BackendMutationResultEnvelope {
  baseRevision: number
  core: BackendMutationCoreSummary | null
  documentId: string
  issues: BackendMutationIssue[]
  operationKind: BackendMutationOperationKind
  readEnvelope?: BackendReadTransportEnvelope
  receivedAt: number
  requestId: string
  requestedAt: number
  revision: number | null
  status: BackendMutationStatus
  targetNodeIds: string[]
}

export type BackendMutationParseResult =
  | {
      issues: []
      ok: true
      request: BackendMutationRequest
    }
  | {
      issues: BackendMutationIssue[]
      ok: false
    }

function issue(path: string, message: string, code = "invalid-request"): BackendMutationIssue {
  return {
    code,
    message,
    path,
    severity: "error",
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: Record<string, unknown>, key: string, issues: BackendMutationIssue[]): string | null {
  const field = value[key]
  if (typeof field === "string" && field.trim().length > 0) return field
  issues.push(issue(key, `${key} must be a non-empty string`))
  return null
}

function readNumber(value: Record<string, unknown>, key: string, issues: BackendMutationIssue[]): number | null {
  const field = value[key]
  if (typeof field === "number" && Number.isInteger(field) && field >= 0) return field
  issues.push(issue(key, `${key} must be a non-negative integer`))
  return null
}

function readSource(value: unknown, issues: BackendMutationIssue[]): BackendMutationSource | null {
  if (
    value === "canvas"
    || value === "keyboard"
    || value === "outline"
    || value === "system"
    || value === "toolbar"
  ) {
    return value
  }

  issues.push(issue("source", "source must be canvas, keyboard, outline, system, or toolbar"))
  return null
}

function readOperation(value: unknown, issues: BackendMutationIssue[]): BackendMutationOperation | null {
  if (!isRecord(value)) {
    issues.push(issue("operation", "operation must be an object"))
    return null
  }

  const kind = value.kind
  const nodeId = typeof value.nodeId === "string" && value.nodeId.trim().length > 0
    ? value.nodeId
    : null

  if (!nodeId) {
    issues.push(issue("operation.nodeId", "operation.nodeId must be a non-empty string"))
  }

  if (kind === "node.delete" || kind === "node.duplicate") {
    return nodeId
      ? {
          kind,
          nodeId,
        }
      : null
  }

  if (kind === "node.reorder") {
    const toIndex = readNumber(value, "toIndex", issues)
    return nodeId && toIndex !== null
      ? {
          kind,
          nodeId,
          toIndex,
        }
      : null
  }

  issues.push(issue("operation.kind", "operation.kind is not supported by the backend mutation contract"))
  return null
}

export function operationTargetNodeIds(operation: BackendMutationOperation): string[] {
  return [operation.nodeId]
}

export function toBackendMutationIssue(issueValue: VNextOperationIssue): BackendMutationIssue {
  return {
    code: issueValue.code,
    message: issueValue.message,
    nodeId: issueValue.nodeId,
    path: issueValue.path,
    severity: issueValue.severity,
  }
}

export function parseBackendMutationRequest(value: unknown): BackendMutationParseResult {
  const issues: BackendMutationIssue[] = []
  if (!isRecord(value)) {
    return {
      issues: [issue("", "mutation request must be an object")],
      ok: false,
    }
  }

  const requestId = readString(value, "requestId", issues)
  const documentId = readString(value, "documentId", issues)
  const baseRevision = readNumber(value, "baseRevision", issues)
  const source = readSource(value.source, issues)
  const operation = readOperation(value.operation, issues)
  const reason = typeof value.reason === "string" && value.reason.trim().length > 0
    ? value.reason
    : undefined

  if (issues.length > 0 || !requestId || !documentId || baseRevision === null || !source || !operation) {
    return {
      issues,
      ok: false,
    }
  }

  return {
    issues: [],
    ok: true,
    request: {
      baseRevision,
      documentId,
      operation,
      reason,
      requestId,
      source,
    },
  }
}
