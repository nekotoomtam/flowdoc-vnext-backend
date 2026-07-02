import {
  createVNextArtifactManifestPlan,
  type VNextArtifactManifestIssue,
  type VNextArtifactManifestRecord,
  type VNextArtifactManifestStatus,
} from "@flowdoc/vnext-core"

export const FLOWDOC_BACKEND_ARTIFACT_ROUTE_SOURCE = "flowdoc-backend-artifact-route"
export const FLOWDOC_BACKEND_ARTIFACT_ROUTE_MODE = "backend-artifact-route-contract"

export type FlowDocBackendArtifactRouteAction =
  | "artifact.request"
  | "artifact.status"
  | "artifact.listSession"
  | "artifact.downloadMetadata"

export type FlowDocBackendArtifactRouteMethod = "GET" | "POST"
export type FlowDocBackendArtifactRouteHttpStatus = 200 | 202 | 400 | 405
export type FlowDocBackendArtifactPermissionScope =
  | "artifact:generate"
  | "artifact:read"
  | "artifact:list"
  | "artifact:download"

export interface FlowDocBackendArtifactRouteRequest {
  method?: string
  body?: unknown
}

export interface FlowDocBackendArtifactPermissionContext {
  principalId: string
  tenantId: string | null
  scope: FlowDocBackendArtifactPermissionScope
  checked: false
}

export interface FlowDocBackendArtifactRouteIssue {
  severity: "error"
  category: "request" | "permission" | "artifact"
  code: string
  path: string
  message: string
}

export interface FlowDocBackendArtifactRetryPolicy {
  safe: true
  idempotencyKey: string | null
  retryAfterMs: number | null
}

export interface FlowDocBackendArtifactRouteResult {
  action: FlowDocBackendArtifactRouteAction
  status: "accepted" | "ready" | "blocked"
  requestId: string | null
  idempotencyKey: string | null
  permission: {
    required: true
    checked: false
    context: FlowDocBackendArtifactPermissionContext
  }
  retry: FlowDocBackendArtifactRetryPolicy
  artifactStatus: VNextArtifactManifestStatus | "not-created"
  job: {
    status: "not-created"
    reason: "backend-route-contract-only"
  }
  storage: {
    reads: false
    writes: false
    reason: "backend-route-contract-only"
  }
  renderer: {
    execution: false
  }
}

export interface FlowDocBackendArtifactDownloadMetadata {
  artifactId: string
  format: VNextArtifactManifestRecord["format"]
  mediaType: string
  byteLength: number
  sha256: string
  storageKey: string
  url: null
  bytes: null
  status: "metadata-only"
}

export interface FlowDocBackendArtifactRouteResponseBody {
  source: typeof FLOWDOC_BACKEND_ARTIFACT_ROUTE_SOURCE
  mode: typeof FLOWDOC_BACKEND_ARTIFACT_ROUTE_MODE
  action: FlowDocBackendArtifactRouteAction
  result: FlowDocBackendArtifactRouteResult | null
  artifact: VNextArtifactManifestRecord | null
  artifacts: VNextArtifactManifestRecord[]
  download: FlowDocBackendArtifactDownloadMetadata | null
  bytes: null
  issues: FlowDocBackendArtifactRouteIssue[]
}

export interface FlowDocBackendArtifactRouteContracts {
  backendOwnedModule: true
  importsCoreAsPublicPackage: true
  usesCoreArtifactManifestContract: true
  serverRoute: false
  storageReads: false
  storageWrites: false
  rendererExecution: false
  artifactByteReads: false
  artifactByteWrites: false
  authzExecution: false
  productionRouteReady: false
  packageSchemaChange: false
}

export interface FlowDocBackendArtifactRouteResponse {
  ok: boolean
  source: typeof FLOWDOC_BACKEND_ARTIFACT_ROUTE_SOURCE
  mode: typeof FLOWDOC_BACKEND_ARTIFACT_ROUTE_MODE
  action: FlowDocBackendArtifactRouteAction
  method: string
  allowedMethods: FlowDocBackendArtifactRouteMethod[]
  httpStatus: FlowDocBackendArtifactRouteHttpStatus
  headers: Record<string, string>
  body: FlowDocBackendArtifactRouteResponseBody
  contracts: FlowDocBackendArtifactRouteContracts
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
}

function contracts(): FlowDocBackendArtifactRouteContracts {
  return {
    backendOwnedModule: true,
    importsCoreAsPublicPackage: true,
    usesCoreArtifactManifestContract: true,
    serverRoute: false,
    storageReads: false,
    storageWrites: false,
    rendererExecution: false,
    artifactByteReads: false,
    artifactByteWrites: false,
    authzExecution: false,
    productionRouteReady: false,
    packageSchemaChange: false,
  }
}

function normalizeMethod(method: string | undefined, fallback: FlowDocBackendArtifactRouteMethod): string {
  return (method ?? fallback).trim().toUpperCase()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function issue(
  category: FlowDocBackendArtifactRouteIssue["category"],
  code: string,
  path: string,
  message: string,
): FlowDocBackendArtifactRouteIssue {
  return { severity: "error", category, code, path, message }
}

function methodNotAllowedIssue(
  method: string,
  allowed: readonly FlowDocBackendArtifactRouteMethod[],
): FlowDocBackendArtifactRouteIssue {
  return issue("request", "method-not-allowed", "method", `backend artifact route accepts ${allowed.join(", ")}, received ${method}`)
}

function nonEmptyString(
  input: Record<string, unknown>,
  path: string,
  issues: FlowDocBackendArtifactRouteIssue[],
  category: FlowDocBackendArtifactRouteIssue["category"] = "request",
): string | null {
  const value = input[path]
  if (typeof value === "string" && value.trim().length > 0) return value

  issues.push(issue(category, "invalid-string", path, `${path} must be a non-empty string`))
  return null
}

function optionalString(input: Record<string, unknown>, path: string): string | null {
  const value = input[path]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function parseBody(value: unknown, issues: FlowDocBackendArtifactRouteIssue[]): Record<string, unknown> | null {
  if (isPlainObject(value)) return value

  issues.push(issue("request", "invalid-body", "body", "request body must be an object"))
  return null
}

function parsePermission(
  body: Record<string, unknown>,
  requiredScope: FlowDocBackendArtifactPermissionScope,
  issues: FlowDocBackendArtifactRouteIssue[],
): FlowDocBackendArtifactPermissionContext | null {
  const value = body.permission
  if (!isPlainObject(value)) {
    issues.push(issue("permission", "missing-permission", "permission", "permission context is required but not executed by this route contract"))
    return null
  }

  const principalId = nonEmptyString(value, "principalId", issues, "permission")
  const tenantId = value.tenantId == null ? null : nonEmptyString(value, "tenantId", issues, "permission")
  const scope = value.scope
  if (scope !== requiredScope) {
    issues.push(issue("permission", "invalid-permission-scope", "permission.scope", `permission scope must be ${requiredScope}`))
  }

  if (principalId == null || (value.tenantId != null && tenantId == null) || scope !== requiredScope) {
    return null
  }

  return {
    principalId,
    tenantId,
    scope: requiredScope,
    checked: false,
  }
}

function routeResponse(input: {
  action: FlowDocBackendArtifactRouteAction
  method: string
  allowedMethods: FlowDocBackendArtifactRouteMethod[]
  httpStatus: FlowDocBackendArtifactRouteHttpStatus
  ok: boolean
  body: FlowDocBackendArtifactRouteResponseBody
}): FlowDocBackendArtifactRouteResponse {
  return {
    ok: input.ok,
    source: FLOWDOC_BACKEND_ARTIFACT_ROUTE_SOURCE,
    mode: FLOWDOC_BACKEND_ARTIFACT_ROUTE_MODE,
    action: input.action,
    method: input.method,
    allowedMethods: input.allowedMethods,
    httpStatus: input.httpStatus,
    headers: {
      ...JSON_HEADERS,
      allow: input.allowedMethods.join(", "),
    },
    body: input.body,
    contracts: contracts(),
  }
}

function emptyBody(
  action: FlowDocBackendArtifactRouteAction,
  issues: FlowDocBackendArtifactRouteIssue[] = [],
): FlowDocBackendArtifactRouteResponseBody {
  return {
    source: FLOWDOC_BACKEND_ARTIFACT_ROUTE_SOURCE,
    mode: FLOWDOC_BACKEND_ARTIFACT_ROUTE_MODE,
    action,
    result: null,
    artifact: null,
    artifacts: [],
    download: null,
    bytes: null,
    issues,
  }
}

function blockedResponse(
  action: FlowDocBackendArtifactRouteAction,
  method: string,
  allowedMethods: FlowDocBackendArtifactRouteMethod[],
  issues: FlowDocBackendArtifactRouteIssue[],
  httpStatus: FlowDocBackendArtifactRouteHttpStatus = 400,
): FlowDocBackendArtifactRouteResponse {
  return routeResponse({
    action,
    method,
    allowedMethods,
    httpStatus,
    ok: false,
    body: emptyBody(action, issues),
  })
}

function result(input: {
  action: FlowDocBackendArtifactRouteAction
  status: FlowDocBackendArtifactRouteResult["status"]
  requestId: string | null
  idempotencyKey: string | null
  permission: FlowDocBackendArtifactPermissionContext
  artifactStatus: FlowDocBackendArtifactRouteResult["artifactStatus"]
  retryAfterMs: number | null
}): FlowDocBackendArtifactRouteResult {
  return {
    action: input.action,
    status: input.status,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    permission: {
      required: true,
      checked: false,
      context: input.permission,
    },
    retry: {
      safe: true,
      idempotencyKey: input.idempotencyKey,
      retryAfterMs: input.retryAfterMs,
    },
    artifactStatus: input.artifactStatus,
    job: {
      status: "not-created",
      reason: "backend-route-contract-only",
    },
    storage: {
      reads: false,
      writes: false,
      reason: "backend-route-contract-only",
    },
    renderer: {
      execution: false,
    },
  }
}

function routeIssuesFromManifest(
  manifestIssues: readonly VNextArtifactManifestIssue[],
  pathPrefix: string,
): FlowDocBackendArtifactRouteIssue[] {
  return manifestIssues.map((manifestIssue) => issue(
    "artifact",
    manifestIssue.code,
    `${pathPrefix}.${manifestIssue.path}`,
    manifestIssue.message,
  ))
}

function parseManifest(
  value: unknown,
  path: string,
  issues: FlowDocBackendArtifactRouteIssue[],
): VNextArtifactManifestRecord | null {
  const plan = createVNextArtifactManifestPlan(value)
  if (plan.status === "ready" && plan.record != null) return plan.record

  issues.push(...routeIssuesFromManifest(plan.issues, path))
  return null
}

function retryAfterForStatus(status: VNextArtifactManifestStatus): number | null {
  return status === "planned" || status === "rendering" ? 1000 : null
}

export function createFlowDocBackendArtifactGenerationRouteResponse(
  request: FlowDocBackendArtifactRouteRequest,
): FlowDocBackendArtifactRouteResponse {
  const action = "artifact.request"
  const method = normalizeMethod(request.method, "POST")
  const allowedMethods: FlowDocBackendArtifactRouteMethod[] = ["POST"]

  if (method !== "POST") {
    return blockedResponse(action, method, allowedMethods, [methodNotAllowedIssue(method, allowedMethods)], 405)
  }

  const issues: FlowDocBackendArtifactRouteIssue[] = []
  const body = parseBody(request.body, issues)
  if (body == null) return blockedResponse(action, method, allowedMethods, issues)

  const idempotencyKey = nonEmptyString(body, "idempotencyKey", issues)
  const requestId = optionalString(body, "requestId")
  const permission = parsePermission(body, "artifact:generate", issues)
  const artifactInput = isPlainObject(body.artifact) ? body.artifact : null
  if (artifactInput == null) {
    issues.push(issue("artifact", "missing-artifact", "artifact", "artifact request payload is required"))
  }

  const manifest = artifactInput == null ? null : parseManifest({
    ...artifactInput,
    byteLength: null,
    sha256: null,
    storageKey: null,
    status: "planned",
    error: null,
  }, "artifact", issues)

  if (issues.length > 0 || idempotencyKey == null || permission == null || manifest == null) {
    return blockedResponse(action, method, allowedMethods, issues)
  }

  return routeResponse({
    action,
    method,
    allowedMethods,
    httpStatus: 202,
    ok: true,
    body: {
      ...emptyBody(action),
      result: result({
        action,
        status: "accepted",
        requestId,
        idempotencyKey,
        permission,
        artifactStatus: "planned",
        retryAfterMs: 1000,
      }),
      artifact: manifest,
    },
  })
}

export function createFlowDocBackendArtifactStatusRouteResponse(
  request: FlowDocBackendArtifactRouteRequest,
): FlowDocBackendArtifactRouteResponse {
  const action = "artifact.status"
  const method = normalizeMethod(request.method, "GET")
  const allowedMethods: FlowDocBackendArtifactRouteMethod[] = ["GET"]

  if (method !== "GET") {
    return blockedResponse(action, method, allowedMethods, [methodNotAllowedIssue(method, allowedMethods)], 405)
  }

  const issues: FlowDocBackendArtifactRouteIssue[] = []
  const body = parseBody(request.body, issues)
  if (body == null) return blockedResponse(action, method, allowedMethods, issues)

  const artifactId = nonEmptyString(body, "artifactId", issues)
  const requestId = optionalString(body, "requestId")
  const permission = parsePermission(body, "artifact:read", issues)
  const manifest = parseManifest(body.artifactManifest, "artifactManifest", issues)

  if (manifest != null && artifactId != null && manifest.artifactId !== artifactId) {
    issues.push(issue("artifact", "artifact-id-mismatch", "artifactManifest.artifactId", "artifact manifest id must match artifactId"))
  }

  if (issues.length > 0 || permission == null || manifest == null) {
    return blockedResponse(action, method, allowedMethods, issues)
  }

  return routeResponse({
    action,
    method,
    allowedMethods,
    httpStatus: 200,
    ok: true,
    body: {
      ...emptyBody(action),
      result: result({
        action,
        status: "ready",
        requestId,
        idempotencyKey: null,
        permission,
        artifactStatus: manifest.status,
        retryAfterMs: retryAfterForStatus(manifest.status),
      }),
      artifact: manifest,
    },
  })
}

export function createFlowDocBackendSessionArtifactListRouteResponse(
  request: FlowDocBackendArtifactRouteRequest,
): FlowDocBackendArtifactRouteResponse {
  const action = "artifact.listSession"
  const method = normalizeMethod(request.method, "GET")
  const allowedMethods: FlowDocBackendArtifactRouteMethod[] = ["GET"]

  if (method !== "GET") {
    return blockedResponse(action, method, allowedMethods, [methodNotAllowedIssue(method, allowedMethods)], 405)
  }

  const issues: FlowDocBackendArtifactRouteIssue[] = []
  const body = parseBody(request.body, issues)
  if (body == null) return blockedResponse(action, method, allowedMethods, issues)

  const sessionId = nonEmptyString(body, "sessionId", issues)
  const requestId = optionalString(body, "requestId")
  const permission = parsePermission(body, "artifact:list", issues)
  const artifactsValue = body.artifacts
  const artifacts: VNextArtifactManifestRecord[] = []

  if (!Array.isArray(artifactsValue)) {
    issues.push(issue("artifact", "invalid-artifacts", "artifacts", "artifacts must be an array supplied by the caller"))
  } else {
    artifactsValue.forEach((artifact, index) => {
      const manifest = parseManifest(artifact, `artifacts[${index}]`, issues)
      if (manifest != null && manifest.sessionId === sessionId) artifacts.push(manifest)
    })
  }

  if (issues.length > 0 || sessionId == null || permission == null) {
    return blockedResponse(action, method, allowedMethods, issues)
  }

  return routeResponse({
    action,
    method,
    allowedMethods,
    httpStatus: 200,
    ok: true,
    body: {
      ...emptyBody(action),
      result: result({
        action,
        status: "ready",
        requestId,
        idempotencyKey: null,
        permission,
        artifactStatus: artifacts.length === 0 ? "not-created" : artifacts[0].status,
        retryAfterMs: artifacts.some((artifact) => retryAfterForStatus(artifact.status) != null) ? 1000 : null,
      }),
      artifacts,
    },
  })
}

export function createFlowDocBackendArtifactDownloadMetadataRouteResponse(
  request: FlowDocBackendArtifactRouteRequest,
): FlowDocBackendArtifactRouteResponse {
  const action = "artifact.downloadMetadata"
  const method = normalizeMethod(request.method, "GET")
  const allowedMethods: FlowDocBackendArtifactRouteMethod[] = ["GET"]

  if (method !== "GET") {
    return blockedResponse(action, method, allowedMethods, [methodNotAllowedIssue(method, allowedMethods)], 405)
  }

  const issues: FlowDocBackendArtifactRouteIssue[] = []
  const body = parseBody(request.body, issues)
  if (body == null) return blockedResponse(action, method, allowedMethods, issues)

  const artifactId = nonEmptyString(body, "artifactId", issues)
  const requestId = optionalString(body, "requestId")
  const permission = parsePermission(body, "artifact:download", issues)
  const manifest = parseManifest(body.artifactManifest, "artifactManifest", issues)

  if (manifest != null && artifactId != null && manifest.artifactId !== artifactId) {
    issues.push(issue("artifact", "artifact-id-mismatch", "artifactManifest.artifactId", "artifact manifest id must match artifactId"))
  }

  if (manifest != null && manifest.status !== "rendered") {
    issues.push(issue("artifact", "artifact-not-rendered", "artifactManifest.status", "download metadata requires a rendered artifact manifest"))
  }

  if (issues.length > 0 || permission == null || manifest == null) {
    return blockedResponse(action, method, allowedMethods, issues)
  }

  return routeResponse({
    action,
    method,
    allowedMethods,
    httpStatus: 200,
    ok: true,
    body: {
      ...emptyBody(action),
      result: result({
        action,
        status: "ready",
        requestId,
        idempotencyKey: null,
        permission,
        artifactStatus: manifest.status,
        retryAfterMs: null,
      }),
      artifact: manifest,
      download: {
        artifactId: manifest.artifactId,
        format: manifest.format,
        mediaType: manifest.mediaType,
        byteLength: manifest.byteLength!,
        sha256: manifest.sha256!,
        storageKey: manifest.storageKey!,
        url: null,
        bytes: null,
        status: "metadata-only",
      },
    },
  })
}
