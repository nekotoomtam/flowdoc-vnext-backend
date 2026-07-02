import {
  createVNextSubmissionIdentityStatus,
  type VNextSubmissionIdentityStatusRecord,
  type VNextSubmissionStateInput,
  type VNextSubmissionStateIssue,
  type VNextSubmissionWorkflowStatus,
} from "@flowdoc/vnext-core"

export const FLOWDOC_BACKEND_SUBMISSION_ROUTE_SOURCE = "flowdoc-backend-submission-route"
export const FLOWDOC_BACKEND_SUBMISSION_ROUTE_MODE = "backend-submission-route-contract"
export const FLOWDOC_BACKEND_SUBMISSION_ROUTE_ACTION = "submission.assess"

export type FlowDocBackendSubmissionRouteMethod = "POST"
export type FlowDocBackendSubmissionRouteHttpStatus = 200 | 400 | 405
export type FlowDocBackendSubmissionPermissionScope = "submission:assess"

export interface FlowDocBackendSubmissionRouteRequest {
  method?: string
  body?: unknown
}

export interface FlowDocBackendSubmissionPermissionContext {
  principalId: string | null
  tenantId: string | null
  scope: FlowDocBackendSubmissionPermissionScope
  checked: false
}

export interface FlowDocBackendSubmissionRouteIssue {
  severity: "error"
  category: "request" | "permission" | "submission"
  code: string
  path: string
  message: string
}

export interface FlowDocBackendSubmissionRouteResult {
  action: typeof FLOWDOC_BACKEND_SUBMISSION_ROUTE_ACTION
  status: "ready" | "blocked"
  requestId: string | null
  idempotencyKey: string | null
  workflowStatus: VNextSubmissionWorkflowStatus
  permission: {
    required: true
    checked: false
    context: FlowDocBackendSubmissionPermissionContext
  }
  workflow: {
    engine: "not-run"
    approvalGates: "not-run"
    notificationAudit: "not-written"
  }
  storage: {
    reads: false
    writes: false
    reason: "backend-route-contract-only"
  }
}

export interface FlowDocBackendSubmissionRouteResponseBody {
  source: typeof FLOWDOC_BACKEND_SUBMISSION_ROUTE_SOURCE
  mode: typeof FLOWDOC_BACKEND_SUBMISSION_ROUTE_MODE
  action: typeof FLOWDOC_BACKEND_SUBMISSION_ROUTE_ACTION
  result: FlowDocBackendSubmissionRouteResult | null
  identityStatus: VNextSubmissionIdentityStatusRecord | null
  issues: FlowDocBackendSubmissionRouteIssue[]
}

export interface FlowDocBackendSubmissionRouteContracts {
  backendOwnedModule: true
  importsCoreAsPublicPackage: true
  usesCoreSubmissionIdentityStatus: true
  serverRoute: false
  storageReads: false
  storageWrites: false
  workflowEngine: false
  permissionsExecution: false
  approvalGates: false
  notificationAudit: false
  productionRouteReady: false
  packageSchemaChange: false
}

export interface FlowDocBackendSubmissionRouteResponse {
  ok: boolean
  source: typeof FLOWDOC_BACKEND_SUBMISSION_ROUTE_SOURCE
  mode: typeof FLOWDOC_BACKEND_SUBMISSION_ROUTE_MODE
  action: typeof FLOWDOC_BACKEND_SUBMISSION_ROUTE_ACTION
  method: string
  allowedMethods: FlowDocBackendSubmissionRouteMethod[]
  httpStatus: FlowDocBackendSubmissionRouteHttpStatus
  headers: Record<string, string>
  body: FlowDocBackendSubmissionRouteResponseBody
  contracts: FlowDocBackendSubmissionRouteContracts
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
}

function contracts(): FlowDocBackendSubmissionRouteContracts {
  return {
    backendOwnedModule: true,
    importsCoreAsPublicPackage: true,
    usesCoreSubmissionIdentityStatus: true,
    serverRoute: false,
    storageReads: false,
    storageWrites: false,
    workflowEngine: false,
    permissionsExecution: false,
    approvalGates: false,
    notificationAudit: false,
    productionRouteReady: false,
    packageSchemaChange: false,
  }
}

function normalizeMethod(method: string | undefined): string {
  return (method ?? "POST").trim().toUpperCase()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function issue(
  category: FlowDocBackendSubmissionRouteIssue["category"],
  code: string,
  path: string,
  message: string,
): FlowDocBackendSubmissionRouteIssue {
  return { severity: "error", category, code, path, message }
}

function submissionIssue(entry: VNextSubmissionStateIssue): FlowDocBackendSubmissionRouteIssue {
  return issue("submission", entry.code, `submission.${entry.path}`, entry.message)
}

function optionalString(input: Record<string, unknown>, path: string): string | null {
  const value = input[path]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function permissionContext(input: Record<string, unknown> | null): FlowDocBackendSubmissionPermissionContext {
  return {
    principalId: input == null ? null : optionalString(input, "principalId"),
    tenantId: input == null ? null : optionalString(input, "tenantId"),
    scope: "submission:assess",
    checked: false,
  }
}

function response(input: {
  ok: boolean
  method: string
  httpStatus: FlowDocBackendSubmissionRouteHttpStatus
  result: FlowDocBackendSubmissionRouteResult | null
  identityStatus: VNextSubmissionIdentityStatusRecord | null
  issues?: FlowDocBackendSubmissionRouteIssue[]
}): FlowDocBackendSubmissionRouteResponse {
  return {
    ok: input.ok,
    source: FLOWDOC_BACKEND_SUBMISSION_ROUTE_SOURCE,
    mode: FLOWDOC_BACKEND_SUBMISSION_ROUTE_MODE,
    action: FLOWDOC_BACKEND_SUBMISSION_ROUTE_ACTION,
    method: input.method,
    allowedMethods: ["POST"],
    httpStatus: input.httpStatus,
    headers: {
      ...JSON_HEADERS,
      allow: "POST",
    },
    body: {
      source: FLOWDOC_BACKEND_SUBMISSION_ROUTE_SOURCE,
      mode: FLOWDOC_BACKEND_SUBMISSION_ROUTE_MODE,
      action: FLOWDOC_BACKEND_SUBMISSION_ROUTE_ACTION,
      result: input.result,
      identityStatus: input.identityStatus,
      issues: input.issues ?? [],
    },
    contracts: contracts(),
  }
}

function result(input: {
  requestId: string | null
  idempotencyKey: string | null
  identityStatus: VNextSubmissionIdentityStatusRecord
  permission: FlowDocBackendSubmissionPermissionContext
}): FlowDocBackendSubmissionRouteResult {
  return {
    action: FLOWDOC_BACKEND_SUBMISSION_ROUTE_ACTION,
    status: input.identityStatus.facts.status,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    workflowStatus: input.identityStatus.facts.workflowStatus,
    permission: {
      required: true,
      checked: false,
      context: input.permission,
    },
    workflow: {
      engine: "not-run",
      approvalGates: "not-run",
      notificationAudit: "not-written",
    },
    storage: {
      reads: false,
      writes: false,
      reason: "backend-route-contract-only",
    },
  }
}

export function createFlowDocBackendSubmissionRouteResponse(
  request: FlowDocBackendSubmissionRouteRequest,
): FlowDocBackendSubmissionRouteResponse {
  const method = normalizeMethod(request.method)
  if (method !== "POST") {
    return response({
      ok: false,
      method,
      httpStatus: 405,
      result: null,
      identityStatus: null,
      issues: [issue("request", "method-not-allowed", "method", `backend submission route accepts POST, received ${method}`)],
    })
  }

  if (!isPlainObject(request.body)) {
    return response({
      ok: false,
      method,
      httpStatus: 400,
      result: null,
      identityStatus: null,
      issues: [issue("request", "invalid-body", "body", "request body must be an object")],
    })
  }

  const body = request.body
  const submission = body.submission
  if (!isPlainObject(submission)) {
    return response({
      ok: false,
      method,
      httpStatus: 400,
      result: null,
      identityStatus: null,
      issues: [issue("request", "invalid-submission", "submission", "submission must be an object")],
    })
  }

  const permission = isPlainObject(body.permission) ? body.permission : null
  const identityStatus = createVNextSubmissionIdentityStatus(submission as unknown as VNextSubmissionStateInput)
  const mappedIssues = identityStatus.issues.map(submissionIssue)
  const ok = identityStatus.facts.status === "ready" && mappedIssues.length === 0

  return response({
    ok,
    method,
    httpStatus: ok ? 200 : 400,
    result: result({
      requestId: optionalString(body, "requestId"),
      idempotencyKey: optionalString(body, "idempotencyKey"),
      identityStatus,
      permission: permissionContext(permission),
    }),
    identityStatus,
    issues: mappedIssues,
  })
}
