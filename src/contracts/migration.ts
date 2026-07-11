export type BackendMigrationSource = "editor" | "system"
export type BackendMigrationStatus = "applied" | "rejected" | "stale"

export interface BackendMigrationRequest {
  baseRevision: number
  documentId: string
  reason?: string
  requestId: string
  source: BackendMigrationSource
}

export interface BackendMigrationIssue {
  code: string
  message: string
  path: string
  severity: "error" | "warning"
}

export interface BackendMigrationResultEnvelope {
  baseRevision: number
  documentId: string
  idempotency: "new" | "replayed" | null
  issues: BackendMigrationIssue[]
  receivedAt: number
  requestId: string
  requestedAt: number
  revision: number | null
  sourceSnapshot: {
    retainedAt: string
    sourceRevision: number
    targetRevision: number
  } | null
  status: BackendMigrationStatus
  summary: {
    changeCount: number
    errorCount: number
    normalizedTextBlockCount: number
    warningCount: number
  } | null
  target: { packageVersion: 3; documentVersion: 4 } | null
}

export type BackendMigrationParseResult =
  | { issues: []; ok: true; request: BackendMigrationRequest }
  | { issues: BackendMigrationIssue[]; ok: false }

function issue(path: string, message: string): BackendMigrationIssue {
  return { code: "invalid-request", message, path, severity: "error" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseBackendMigrationRequest(value: unknown): BackendMigrationParseResult {
  if (!isRecord(value)) return { issues: [issue("", "migration request must be an object")], ok: false }
  const issues: BackendMigrationIssue[] = []
  const baseRevision = typeof value.baseRevision === "number" && Number.isInteger(value.baseRevision) && value.baseRevision >= 0
    ? value.baseRevision
    : null
  const documentId = typeof value.documentId === "string" && value.documentId.trim().length > 0 ? value.documentId : null
  const requestId = typeof value.requestId === "string" && value.requestId.trim().length > 0 ? value.requestId : null
  const source = value.source === "editor" || value.source === "system" ? value.source : null
  if (baseRevision == null) issues.push(issue("baseRevision", "baseRevision must be a non-negative integer"))
  if (!documentId) issues.push(issue("documentId", "documentId must be a non-empty string"))
  if (!requestId) issues.push(issue("requestId", "requestId must be a non-empty string"))
  if (!source) issues.push(issue("source", "source must be editor or system"))
  if (issues.length > 0 || baseRevision == null || !documentId || !requestId || !source) return { issues, ok: false }
  return {
    issues: [],
    ok: true,
    request: {
      baseRevision,
      documentId,
      requestId,
      source,
      ...(typeof value.reason === "string" && value.reason.trim().length > 0 ? { reason: value.reason } : {}),
    },
  }
}
