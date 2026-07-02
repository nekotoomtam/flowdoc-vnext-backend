import type {
  FlowDocFileJsonStorageAdapter,
  FlowDocFileJsonStorageReadResult,
  FlowDocFileJsonStorageWriteResult,
} from "./fileJsonStorage.js"
import {
  createVNextArtifactJobPlan,
} from "@flowdoc/vnext-core"
import type {
  VNextArtifactJobCreateInput,
  VNextArtifactJobRecord,
  VNextArtifactManifestRecord,
  VNextSessionStorageRecord,
  VNextStorageOperationIssue,
  VNextStorageRecordKind,
} from "@flowdoc/vnext-core"

export const FLOWDOC_STORAGE_ROUTE_BINDING_SOURCE = "flowdoc-storage-route-binding"
export const FLOWDOC_STORAGE_ROUTE_BINDING_MODE = "internal-alpha-route-contract-to-storage-binding"
export const FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER = "flowdoc-vnext-backend:file-json-storage"

export type FlowDocStorageRouteBindingAction =
  | "session.load"
  | "session.save"
  | "artifact.request"
  | "artifact.status"
  | "artifact.metadata"

export type FlowDocStorageRouteBindingMethod = "GET" | "POST"
export type FlowDocStorageRouteBindingHttpStatus = 200 | 201 | 202 | 400 | 404 | 405 | 409

export interface FlowDocStorageRouteBindingRequest {
  method?: string
  body?: unknown
}

export interface FlowDocStorageRouteBindingIssue {
  severity: "error"
  category: "request" | "storage" | "artifact"
  code: string
  path: string
  message: string
}

export interface FlowDocStorageRouteBindingResult {
  action: FlowDocStorageRouteBindingAction
  status: "loaded" | "saved" | "accepted" | "ready" | "missing" | "conflict" | "blocked"
  requestId: string | null
  storage: {
    adapter: typeof FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER
    reads: boolean
    writes: boolean
    recordKinds: VNextStorageRecordKind[]
    byteReads: false
    byteWrites: false
  }
  retry: {
    safe: true
    idempotencyKey: string | null
    retryAfterMs: number | null
  }
}

export interface FlowDocStorageRouteBindingResponseBody {
  source: typeof FLOWDOC_STORAGE_ROUTE_BINDING_SOURCE
  mode: typeof FLOWDOC_STORAGE_ROUTE_BINDING_MODE
  action: FlowDocStorageRouteBindingAction
  result: FlowDocStorageRouteBindingResult | null
  session: VNextSessionStorageRecord | null
  artifact: VNextArtifactManifestRecord | null
  job: VNextArtifactJobRecord | null
  bytes: null
  issues: FlowDocStorageRouteBindingIssue[]
}

export interface FlowDocStorageRouteBindingResponse {
  ok: boolean
  source: typeof FLOWDOC_STORAGE_ROUTE_BINDING_SOURCE
  mode: typeof FLOWDOC_STORAGE_ROUTE_BINDING_MODE
  action: FlowDocStorageRouteBindingAction
  method: string
  allowedMethods: FlowDocStorageRouteBindingMethod[]
  httpStatus: FlowDocStorageRouteBindingHttpStatus
  headers: Record<string, string>
  body: FlowDocStorageRouteBindingResponseBody
  contracts: {
    jsonSafe: true
    routeShapeOnly: true
    concreteStorageAdapter: true
    serverRoute: false
    authzExecution: false
    rendererExecution: false
    artifactByteReads: false
    artifactByteWrites: false
    productionStorageReady: false
    packageSchemaChange: false
    multiRecordTransactions: false
  }
}

export interface FlowDocStorageRouteBinding {
  loadSession(request: FlowDocStorageRouteBindingRequest): Promise<FlowDocStorageRouteBindingResponse>
  saveSession(request: FlowDocStorageRouteBindingRequest): Promise<FlowDocStorageRouteBindingResponse>
  requestArtifactGeneration(request: FlowDocStorageRouteBindingRequest): Promise<FlowDocStorageRouteBindingResponse>
  getArtifactStatus(request: FlowDocStorageRouteBindingRequest): Promise<FlowDocStorageRouteBindingResponse>
  getArtifactMetadata(request: FlowDocStorageRouteBindingRequest): Promise<FlowDocStorageRouteBindingResponse>
}

export interface FlowDocStorageRouteBindingInput {
  storageAdapter: FlowDocFileJsonStorageAdapter
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
}

function contracts(): FlowDocStorageRouteBindingResponse["contracts"] {
  return {
    jsonSafe: true,
    routeShapeOnly: true,
    concreteStorageAdapter: true,
    serverRoute: false,
    authzExecution: false,
    rendererExecution: false,
    artifactByteReads: false,
    artifactByteWrites: false,
    productionStorageReady: false,
    packageSchemaChange: false,
    multiRecordTransactions: false,
  }
}

function normalizeMethod(method: string | undefined, fallback: FlowDocStorageRouteBindingMethod): string {
  return (method ?? fallback).trim().toUpperCase()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function issue(
  category: FlowDocStorageRouteBindingIssue["category"],
  code: string,
  path: string,
  message: string,
): FlowDocStorageRouteBindingIssue {
  return { severity: "error", category, code, path, message }
}

function storageIssues(
  issues: readonly VNextStorageOperationIssue[],
  prefix: string,
): FlowDocStorageRouteBindingIssue[] {
  return issues.map((entry) => issue("storage", entry.code, `${prefix}.${entry.path}`, entry.message))
}

function parseBody(value: unknown, issues: FlowDocStorageRouteBindingIssue[]): Record<string, unknown> | null {
  if (isPlainObject(value)) return value

  issues.push(issue("request", "invalid-body", "body", "request body must be an object"))
  return null
}

function nonEmptyString(
  input: Record<string, unknown>,
  path: string,
  issues: FlowDocStorageRouteBindingIssue[],
): string | null {
  const value = input[path]
  if (typeof value === "string" && value.trim().length > 0) return value

  issues.push(issue("request", "invalid-string", path, `${path} must be a non-empty string`))
  return null
}

function nullableRevision(
  input: Record<string, unknown>,
  path: string,
  issues: FlowDocStorageRouteBindingIssue[],
): number | null {
  const value = input[path]
  if (value == null) return null
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value

  issues.push(issue("request", "invalid-revision", path, `${path} must be null or a non-negative integer`))
  return null
}

function optionalString(input: Record<string, unknown>, path: string): string | null {
  const value = input[path]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function response(input: {
  action: FlowDocStorageRouteBindingAction
  method: string
  allowedMethods: FlowDocStorageRouteBindingMethod[]
  httpStatus: FlowDocStorageRouteBindingHttpStatus
  ok: boolean
  result: FlowDocStorageRouteBindingResult | null
  session?: VNextSessionStorageRecord | null
  artifact?: VNextArtifactManifestRecord | null
  job?: VNextArtifactJobRecord | null
  issues?: FlowDocStorageRouteBindingIssue[]
}): FlowDocStorageRouteBindingResponse {
  return {
    ok: input.ok,
    source: FLOWDOC_STORAGE_ROUTE_BINDING_SOURCE,
    mode: FLOWDOC_STORAGE_ROUTE_BINDING_MODE,
    action: input.action,
    method: input.method,
    allowedMethods: input.allowedMethods,
    httpStatus: input.httpStatus,
    headers: {
      ...JSON_HEADERS,
      allow: input.allowedMethods.join(", "),
    },
    body: {
      source: FLOWDOC_STORAGE_ROUTE_BINDING_SOURCE,
      mode: FLOWDOC_STORAGE_ROUTE_BINDING_MODE,
      action: input.action,
      result: input.result,
      session: input.session ?? null,
      artifact: input.artifact ?? null,
      job: input.job ?? null,
      bytes: null,
      issues: input.issues ?? [],
    },
    contracts: contracts(),
  }
}

function methodBlocked(
  action: FlowDocStorageRouteBindingAction,
  method: string,
  allowedMethods: FlowDocStorageRouteBindingMethod[],
): FlowDocStorageRouteBindingResponse {
  return response({
    action,
    method,
    allowedMethods,
    httpStatus: 405,
    ok: false,
    result: null,
    issues: [issue("request", "method-not-allowed", "method", `${action} accepts ${allowedMethods.join(", ")}, received ${method}`)],
  })
}

function result(input: {
  action: FlowDocStorageRouteBindingAction
  status: FlowDocStorageRouteBindingResult["status"]
  requestId: string | null
  reads: boolean
  writes: boolean
  recordKinds: VNextStorageRecordKind[]
  idempotencyKey?: string | null
  retryAfterMs?: number | null
}): FlowDocStorageRouteBindingResult {
  return {
    action: input.action,
    status: input.status,
    requestId: input.requestId,
    storage: {
      adapter: FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER,
      reads: input.reads,
      writes: input.writes,
      recordKinds: input.recordKinds,
      byteReads: false,
      byteWrites: false,
    },
    retry: {
      safe: true,
      idempotencyKey: input.idempotencyKey ?? null,
      retryAfterMs: input.retryAfterMs ?? null,
    },
  }
}

function statusFromWrite(write: FlowDocFileJsonStorageWriteResult<unknown>): {
  httpStatus: FlowDocStorageRouteBindingHttpStatus
  status: FlowDocStorageRouteBindingResult["status"]
} {
  if (write.ok) return { httpStatus: 201, status: "saved" }
  if (write.status === "conflict") return { httpStatus: 409, status: "conflict" }
  return { httpStatus: 400, status: "blocked" }
}

function statusFromRead(read: FlowDocFileJsonStorageReadResult<unknown>): {
  httpStatus: FlowDocStorageRouteBindingHttpStatus
  status: FlowDocStorageRouteBindingResult["status"]
} {
  if (read.ok) return { httpStatus: 200, status: "loaded" }
  if (read.status === "not-found") return { httpStatus: 404, status: "missing" }
  return { httpStatus: 400, status: "blocked" }
}

export function createFlowDocStorageRouteBinding(
  input: FlowDocStorageRouteBindingInput,
): FlowDocStorageRouteBinding {
  const adapter = input.storageAdapter

  return {
    async loadSession(request) {
      const action = "session.load"
      const method = normalizeMethod(request.method, "GET")
      const allowedMethods: FlowDocStorageRouteBindingMethod[] = ["GET"]
      if (method !== "GET") return methodBlocked(action, method, allowedMethods)

      const issues: FlowDocStorageRouteBindingIssue[] = []
      const body = parseBody(request.body, issues)
      if (body == null) return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })
      const key = nonEmptyString(body, "key", issues)
      const requestId = optionalString(body, "requestId")
      if (key == null || issues.length > 0) return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })

      const read = await adapter.packageSessions.read({ kind: "package-session", key })
      const mapped = statusFromRead(read)

      return response({
        action,
        method,
        allowedMethods,
        httpStatus: mapped.httpStatus,
        ok: read.ok,
        result: result({ action, status: mapped.status, requestId, reads: true, writes: false, recordKinds: ["package-session"] }),
        session: read.ok ? read.record.value : null,
        issues: read.ok ? [] : storageIssues(read.issues, "package-session.read"),
      })
    },

    async saveSession(request) {
      const action = "session.save"
      const method = normalizeMethod(request.method, "POST")
      const allowedMethods: FlowDocStorageRouteBindingMethod[] = ["POST"]
      if (method !== "POST") return methodBlocked(action, method, allowedMethods)

      const issues: FlowDocStorageRouteBindingIssue[] = []
      const body = parseBody(request.body, issues)
      if (body == null) return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })
      const key = nonEmptyString(body, "key", issues)
      const idempotencyKey = nonEmptyString(body, "idempotencyKey", issues)
      const now = nonEmptyString(body, "now", issues)
      const expectedRevision = nullableRevision(body, "expectedRevision", issues)
      const record = body.record as VNextSessionStorageRecord | undefined
      const requestId = optionalString(body, "requestId")
      if (!isPlainObject(record)) issues.push(issue("request", "invalid-record", "record", "record must be a session storage record object"))
      if (key == null || idempotencyKey == null || now == null || record == null || issues.length > 0) {
        return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })
      }

      const write = await adapter.packageSessions.write({
        kind: "package-session",
        key,
        value: record,
        expectedRevision,
        idempotencyKey,
        now,
      })
      const mapped = statusFromWrite(write)

      return response({
        action,
        method,
        allowedMethods,
        httpStatus: mapped.httpStatus,
        ok: write.ok,
        result: result({ action, status: mapped.status, requestId, reads: false, writes: true, recordKinds: ["package-session"], idempotencyKey }),
        session: write.ok ? write.record.value : null,
        issues: write.ok ? [] : storageIssues(write.issues, "package-session.write"),
      })
    },

    async requestArtifactGeneration(request) {
      const action = "artifact.request"
      const method = normalizeMethod(request.method, "POST")
      const allowedMethods: FlowDocStorageRouteBindingMethod[] = ["POST"]
      if (method !== "POST") return methodBlocked(action, method, allowedMethods)

      const issues: FlowDocStorageRouteBindingIssue[] = []
      const body = parseBody(request.body, issues)
      if (body == null) return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })
      const now = nonEmptyString(body, "now", issues)
      const idempotencyKey = nonEmptyString(body, "idempotencyKey", issues)
      const requestId = optionalString(body, "requestId")
      const jobInput = body.jobInput as VNextArtifactJobCreateInput | undefined
      if (!isPlainObject(jobInput)) issues.push(issue("request", "invalid-job-input", "jobInput", "jobInput must be an artifact job create input object"))
      if (now == null || idempotencyKey == null || jobInput == null || issues.length > 0) {
        return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })
      }

      const jobPlan = createVNextArtifactJobPlan(jobInput)
      if (jobPlan.job == null) {
        return response({
          action,
          method,
          allowedMethods,
          httpStatus: 400,
          ok: false,
          result: null,
          issues: jobPlan.issues.map((entry) => issue("artifact", entry.code, `jobInput.${entry.path}`, entry.message)),
        })
      }

      const manifest = jobPlan.job.artifactManifest
      if (manifest == null) {
        return response({
          action,
          method,
          allowedMethods,
          httpStatus: 400,
          ok: false,
          result: null,
          issues: [issue("artifact", "missing-planned-manifest", "jobInput", "artifact job plan did not create a planned manifest")],
        })
      }

      const manifestWrite = await adapter.artifactManifests.write({
        kind: "artifact-manifest",
        key: manifest.artifactId,
        value: manifest,
        expectedRevision: null,
        idempotencyKey: `${idempotencyKey}:manifest`,
        now,
      })
      const jobWrite = await adapter.artifactJobs.write({
        kind: "artifact-job",
        key: jobPlan.job.jobId,
        value: jobPlan.job,
        expectedRevision: null,
        idempotencyKey: `${idempotencyKey}:job`,
        now,
      })
      const blockedIssues = [
        ...(manifestWrite.ok ? [] : storageIssues(manifestWrite.issues, "artifact-manifest.write")),
        ...(jobWrite.ok ? [] : storageIssues(jobWrite.issues, "artifact-job.write")),
      ]
      const ok = manifestWrite.ok && jobWrite.ok
      const conflict = manifestWrite.status === "conflict" || jobWrite.status === "conflict"

      return response({
        action,
        method,
        allowedMethods,
        httpStatus: ok ? 202 : conflict ? 409 : 400,
        ok,
        result: result({
          action,
          status: ok ? "accepted" : conflict ? "conflict" : "blocked",
          requestId,
          reads: false,
          writes: true,
          recordKinds: ["artifact-manifest", "artifact-job"],
          idempotencyKey,
          retryAfterMs: ok ? 1000 : null,
        }),
        artifact: manifestWrite.ok ? manifestWrite.record.value : null,
        job: jobWrite.ok ? jobWrite.record.value : null,
        issues: blockedIssues,
      })
    },

    async getArtifactStatus(request) {
      const action = "artifact.status"
      const method = normalizeMethod(request.method, "GET")
      const allowedMethods: FlowDocStorageRouteBindingMethod[] = ["GET"]
      if (method !== "GET") return methodBlocked(action, method, allowedMethods)

      const issues: FlowDocStorageRouteBindingIssue[] = []
      const body = parseBody(request.body, issues)
      if (body == null) return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })
      const jobKey = nonEmptyString(body, "jobKey", issues)
      const requestId = optionalString(body, "requestId")
      if (jobKey == null || issues.length > 0) return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })

      const read = await adapter.artifactJobs.read({ kind: "artifact-job", key: jobKey })
      const mapped = statusFromRead(read)

      return response({
        action,
        method,
        allowedMethods,
        httpStatus: mapped.httpStatus,
        ok: read.ok,
        result: result({ action, status: read.ok ? "ready" : mapped.status, requestId, reads: true, writes: false, recordKinds: ["artifact-job"], retryAfterMs: read.ok && (read.record.value.status === "queued" || read.record.value.status === "rendering") ? 1000 : null }),
        job: read.ok ? read.record.value : null,
        artifact: read.ok ? read.record.value.artifactManifest : null,
        issues: read.ok ? [] : storageIssues(read.issues, "artifact-job.read"),
      })
    },

    async getArtifactMetadata(request) {
      const action = "artifact.metadata"
      const method = normalizeMethod(request.method, "GET")
      const allowedMethods: FlowDocStorageRouteBindingMethod[] = ["GET"]
      if (method !== "GET") return methodBlocked(action, method, allowedMethods)

      const issues: FlowDocStorageRouteBindingIssue[] = []
      const body = parseBody(request.body, issues)
      if (body == null) return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })
      const artifactId = nonEmptyString(body, "artifactId", issues)
      const requestId = optionalString(body, "requestId")
      if (artifactId == null || issues.length > 0) return response({ action, method, allowedMethods, httpStatus: 400, ok: false, result: null, issues })

      const read = await adapter.artifactManifests.read({ kind: "artifact-manifest", key: artifactId })
      const mapped = statusFromRead(read)

      return response({
        action,
        method,
        allowedMethods,
        httpStatus: mapped.httpStatus,
        ok: read.ok,
        result: result({ action, status: read.ok ? "ready" : mapped.status, requestId, reads: true, writes: false, recordKinds: ["artifact-manifest"] }),
        artifact: read.ok ? read.record.value : null,
        issues: read.ok ? [] : storageIssues(read.issues, "artifact-manifest.read"),
      })
    },
  }
}
