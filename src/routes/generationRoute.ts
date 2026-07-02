import {
  assessVNextGenerationReadiness,
  type VNextGenerationReadinessResult,
  type VNextGenerationRuntimeIssue,
} from "@flowdoc/vnext-core"

export const FLOWDOC_BACKEND_GENERATION_ROUTE_SOURCE = "flowdoc-backend-generation-route"
export const FLOWDOC_BACKEND_GENERATION_ROUTE_MODE = "backend-readiness-route"
export const FLOWDOC_BACKEND_GENERATION_ROUTE_ACTION = "generation.assess"

export type FlowDocBackendGenerationRouteMethod = "POST"
export type FlowDocBackendGenerationRouteHttpStatus = 200 | 400 | 405

export interface FlowDocBackendGenerationRouteRequest {
  method?: string
  body?: unknown
}

export interface FlowDocBackendGenerationRouteResponseBody {
  source: typeof FLOWDOC_BACKEND_GENERATION_ROUTE_SOURCE
  mode: typeof FLOWDOC_BACKEND_GENERATION_ROUTE_MODE
  action: typeof FLOWDOC_BACKEND_GENERATION_ROUTE_ACTION
  result: VNextGenerationReadinessResult | null
  artifact: null
  generatedDocument: null
  issues: VNextGenerationRuntimeIssue[]
}

export interface FlowDocBackendGenerationRouteContracts {
  backendOwnedModule: true
  importsCoreAsPublicPackage: true
  usesCoreReadinessRuntime: true
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

export interface FlowDocBackendGenerationRouteResponse {
  ok: boolean
  source: typeof FLOWDOC_BACKEND_GENERATION_ROUTE_SOURCE
  mode: typeof FLOWDOC_BACKEND_GENERATION_ROUTE_MODE
  action: typeof FLOWDOC_BACKEND_GENERATION_ROUTE_ACTION
  method: string
  allowedMethods: FlowDocBackendGenerationRouteMethod[]
  httpStatus: FlowDocBackendGenerationRouteHttpStatus
  headers: Record<string, string>
  body: FlowDocBackendGenerationRouteResponseBody
  contracts: FlowDocBackendGenerationRouteContracts
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
}

function contracts(): FlowDocBackendGenerationRouteContracts {
  return {
    backendOwnedModule: true,
    importsCoreAsPublicPackage: true,
    usesCoreReadinessRuntime: true,
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

function normalizeMethod(method: string | undefined): string {
  return (method ?? "POST").trim().toUpperCase()
}

function methodNotAllowedIssue(method: string): VNextGenerationRuntimeIssue {
  return {
    severity: "error",
    category: "request",
    code: "method-not-allowed",
    path: "method",
    message: `backend generation readiness route accepts POST, received ${method}`,
  }
}

function response(input: {
  body: FlowDocBackendGenerationRouteResponseBody
  httpStatus: FlowDocBackendGenerationRouteHttpStatus
  method: string
  ok: boolean
}): FlowDocBackendGenerationRouteResponse {
  return {
    ok: input.ok,
    source: FLOWDOC_BACKEND_GENERATION_ROUTE_SOURCE,
    mode: FLOWDOC_BACKEND_GENERATION_ROUTE_MODE,
    action: FLOWDOC_BACKEND_GENERATION_ROUTE_ACTION,
    method: input.method,
    allowedMethods: ["POST"],
    httpStatus: input.httpStatus,
    headers: {
      ...JSON_HEADERS,
      allow: "POST",
    },
    body: input.body,
    contracts: contracts(),
  }
}

export function createFlowDocBackendGenerationRouteResponse(
  request: FlowDocBackendGenerationRouteRequest,
): FlowDocBackendGenerationRouteResponse {
  const method = normalizeMethod(request.method)

  if (method !== "POST") {
    const issues = [methodNotAllowedIssue(method)]
    return response({
      ok: false,
      method,
      httpStatus: 405,
      body: {
        source: FLOWDOC_BACKEND_GENERATION_ROUTE_SOURCE,
        mode: FLOWDOC_BACKEND_GENERATION_ROUTE_MODE,
        action: FLOWDOC_BACKEND_GENERATION_ROUTE_ACTION,
        result: null,
        artifact: null,
        generatedDocument: null,
        issues,
      },
    })
  }

  const result = assessVNextGenerationReadiness(request.body)

  return response({
    ok: result.ok,
    method,
    httpStatus: result.ok ? 200 : 400,
    body: {
      source: FLOWDOC_BACKEND_GENERATION_ROUTE_SOURCE,
      mode: FLOWDOC_BACKEND_GENERATION_ROUTE_MODE,
      action: FLOWDOC_BACKEND_GENERATION_ROUTE_ACTION,
      result,
      artifact: null,
      generatedDocument: null,
      issues: result.issues,
    },
  })
}
