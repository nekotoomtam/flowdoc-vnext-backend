import type {
  VNextPdfExportProductionPolicyV1,
  VNextPdfExportRequestV1,
  VNextPdfExportSourceIdentityV1,
  VNextPdfMeasuredDrawContractResultV1,
} from "@flowdoc/vnext-core"
import type { FlowDocBackendPdfExportArtifactPersistenceRepositoryV1 } from "./pdfExportArtifactPersistence.js"
import type { FlowDocBackendPdfExportContentAddressedStoreV1 } from "./pdfExportContentAddressedStore.js"
import type {
  FlowDocBackendPdfExportLifecycleHeadV1,
  FlowDocBackendPdfExportLifecycleStopReasonV1,
} from "./pdfExportLifecycle.js"
import type { FlowDocBackendPdfExportLifecycleRepositoryV1 } from "./pdfExportLifecycleRepository.js"
import type { FlowDocBackendPdfExportObservabilityRepositoryV1 } from "./pdfExportObservability.js"
import {
  createFlowDocBackendPdfExportOperationV1,
  flowDocBackendPdfExportFingerprintV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  type FlowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"
import type { FlowDocBackendPdfExportOperationRepositoryV1 } from "./pdfExportOperationRepository.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_ROUTE_V1_SOURCE =
  "flowdoc-backend-pdf-export-authenticated-route" as const

export type FlowDocBackendPdfExportRouteActionV1 =
  | "pdf-export:request"
  | "pdf-export:read"
  | "pdf-export:cancel"
  | "pdf-export:download"

export interface FlowDocBackendPdfExportAuthenticatedIdentityV1 {
  tenantId: string
  principalId: string
  authenticationId: string
}

export type FlowDocBackendPdfExportAuthenticationResultV1 =
  | {
      status: "authenticated"
      identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
      issues: []
    }
  | {
      status: "unauthenticated" | "unavailable"
      identity: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportAuthenticatorV1 {
  authenticate(input: {
    authorization: string | null
  }): Promise<FlowDocBackendPdfExportAuthenticationResultV1>
}

export type FlowDocBackendPdfExportAuthorizationResultV1 =
  | { status: "authorized"; authorizationId: string; issues: [] }
  | {
      status: "denied" | "unavailable"
      authorizationId: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportAuthorizerV1 {
  authorize(input: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    action: FlowDocBackendPdfExportRouteActionV1
    documentId: string
    operationId: string | null
  }): Promise<FlowDocBackendPdfExportAuthorizationResultV1>
}

export type FlowDocBackendPdfExportAdmissionResolutionV1 =
  | {
      status: "ready"
      operationId: string
      request: VNextPdfExportRequestV1
      currentSource: VNextPdfExportSourceIdentityV1
      measuredDrawContract: VNextPdfMeasuredDrawContractResultV1
      policy: VNextPdfExportProductionPolicyV1
      issues: []
    }
  | {
      status: "not-found" | "stale" | "rejected" | "unavailable"
      operationId: null
      request: null
      currentSource: null
      measuredDrawContract: null
      policy: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportAdmissionResolverV1 {
  resolve(input: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    documentId: string
    documentRevision: number
    acceptedAt: string
  }): Promise<FlowDocBackendPdfExportAdmissionResolutionV1>
}

export interface FlowDocBackendPdfExportRouteRequestV1 {
  method: string
  path: string
  authorization: string | null
  idempotencyKey: string | null
  body: unknown
}

export type FlowDocBackendPdfExportPublicStateV1 =
  | "accepted"
  | "pending"
  | "processing"
  | "finalizing"
  | "completed"
  | "cancel-requested"
  | "cancelled"
  | "deadline-exceeded"
  | "resource-rejected"
  | "failed"

export interface FlowDocBackendPdfExportPublicStatusV1 {
  operationId: string
  exportRequestId: string
  artifactId: string
  documentId: string
  documentRevision: number
  state: FlowDocBackendPdfExportPublicStateV1
  acceptedAt: string
  updatedAt: string
  terminalStatus: "completed" | "cancelled" | "deadline-exceeded" | "resource-rejected" | "failed" | null
  stopReason: string | null
  pageCount: number | null
  byteLength: number | null
}

export interface FlowDocBackendPdfExportRouteContractsV1 {
  concreteHttpAdapter: true
  applicationServerMounted: false
  authenticationRequired: true
  authorizationRequiredPerAction: true
  tenantPrincipalFromCredentialOnly: true
  callerIdentityFieldsAccepted: false
  scopedRepositoryAccess: true
  terminalCompletionRequiredForDownload: true
  physicalByteVerificationRequiredForDownload: true
  automaticWorkerStart: false
  concreteAuthenticationProviderSelected: false
  concreteAuthorizationProviderSelected: false
  productionBinding: false
}

export interface FlowDocBackendPdfExportRouteSecurityV1 {
  authentication: "not-run" | "authenticated" | "failed" | "unavailable"
  authorization: "not-run" | "authorized" | "denied" | "unavailable"
}

export type FlowDocBackendPdfExportRouteBodyV1 =
  | { kind: "json"; value: unknown }
  | { kind: "pdf"; bytes: Uint8Array }

export interface FlowDocBackendPdfExportRouteResponseV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_ROUTE_V1_SOURCE
  matched: boolean
  httpStatus: number
  headers: Record<string, string>
  body: FlowDocBackendPdfExportRouteBodyV1
  security: FlowDocBackendPdfExportRouteSecurityV1
  contracts: FlowDocBackendPdfExportRouteContractsV1
}

export interface FlowDocBackendPdfExportRouteOptionsV1 {
  authenticator: FlowDocBackendPdfExportAuthenticatorV1
  authorizer: FlowDocBackendPdfExportAuthorizerV1
  admissionResolver: FlowDocBackendPdfExportAdmissionResolverV1
  operationRepository: FlowDocBackendPdfExportOperationRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilityRepositoryV1
  contentStore: FlowDocBackendPdfExportContentAddressedStoreV1
  now: () => string
}

interface RouteTargetV1 {
  action: FlowDocBackendPdfExportRouteActionV1
  operationId: string | null
  allowedMethod: "GET" | "POST"
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
}

function contracts(): FlowDocBackendPdfExportRouteContractsV1 {
  return {
    concreteHttpAdapter: true,
    applicationServerMounted: false,
    authenticationRequired: true,
    authorizationRequiredPerAction: true,
    tenantPrincipalFromCredentialOnly: true,
    callerIdentityFieldsAccepted: false,
    scopedRepositoryAccess: true,
    terminalCompletionRequiredForDownload: true,
    physicalByteVerificationRequiredForDownload: true,
    automaticWorkerStart: false,
    concreteAuthenticationProviderSelected: false,
    concreteAuthorizationProviderSelected: false,
    productionBinding: false,
  }
}

function issue(code: string, message: string) {
  return { severity: "error" as const, code, message }
}

function jsonResponse(input: {
  status: number
  value: unknown
  security: FlowDocBackendPdfExportRouteSecurityV1
  headers?: Record<string, string>
  matched?: boolean
}): FlowDocBackendPdfExportRouteResponseV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_ROUTE_V1_SOURCE,
    matched: input.matched ?? true,
    httpStatus: input.status,
    headers: { ...JSON_HEADERS, ...input.headers },
    body: { kind: "json", value: input.value },
    security: input.security,
    contracts: contracts(),
  }
}

function routeTarget(path: string): RouteTargetV1 | null {
  if (path === "/pdf-exports") return {
    action: "pdf-export:request",
    operationId: null,
    allowedMethod: "POST",
  }
  const match = /^\/pdf-exports\/([^/]+?)(?:\/(cancel|download))?$/u.exec(path)
  if (match == null) return null
  let operationId: string
  try {
    operationId = decodeURIComponent(match[1]!)
  } catch {
    return null
  }
  if (!isFlowDocBackendPdfExportBoundedStringV1(operationId)) return null
  if (match[2] === "cancel") return { action: "pdf-export:cancel", operationId, allowedMethod: "POST" }
  if (match[2] === "download") return { action: "pdf-export:download", operationId, allowedMethod: "GET" }
  return { action: "pdf-export:read", operationId, allowedMethod: "GET" }
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function requestBody(value: unknown): { documentId: string; documentRevision: number } | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join("|") !== "documentId|documentRevision") return null
  if (!isFlowDocBackendPdfExportBoundedStringV1(record.documentId)) return null
  if (!Number.isSafeInteger(record.documentRevision) || Number(record.documentRevision) < 0) return null
  return { documentId: record.documentId, documentRevision: Number(record.documentRevision) }
}

function scope(identity: FlowDocBackendPdfExportAuthenticatedIdentityV1) {
  return { tenantId: identity.tenantId, principalId: identity.principalId }
}

function validIdentity(identity: FlowDocBackendPdfExportAuthenticatedIdentityV1): boolean {
  return isFlowDocBackendPdfExportBoundedStringV1(identity.tenantId)
    && isFlowDocBackendPdfExportBoundedStringV1(identity.principalId)
    && isFlowDocBackendPdfExportBoundedStringV1(identity.authenticationId)
}

function terminalState(status: "completed" | "cancelled" | "deadline-exceeded" | "resource-rejected" | "failed"):
FlowDocBackendPdfExportPublicStateV1 {
  return status
}

function stoppedState(reason: FlowDocBackendPdfExportLifecycleStopReasonV1): FlowDocBackendPdfExportPublicStateV1 {
  if (reason.startsWith("cancelled-")) return "cancelled"
  if (reason === "deadline-exceeded") return "deadline-exceeded"
  return "failed"
}

async function publicStatus(input: {
  operation: FlowDocBackendPdfExportOperationV1
  options: FlowDocBackendPdfExportRouteOptionsV1
}): Promise<{ status: "ready"; value: FlowDocBackendPdfExportPublicStatusV1 } | { status: "unavailable" }> {
  const operation = input.operation
  const lookup = { ...operation.scope, operationId: operation.operationId }
  const [terminal, persistence, lifecycle] = await Promise.all([
    input.options.observabilityRepository.readTerminalWorkflow(lookup),
    input.options.persistenceRepository.readByOperationId(lookup),
    input.options.lifecycleRepository.readLifecycle(lookup),
  ])
  if ([terminal.status, persistence.status, lifecycle.status].some((status) => ["invalid", "storage-unavailable"].includes(status))) {
    return { status: "unavailable" }
  }
  if (
    persistence.status === "found"
    && persistence.receipt.operationFingerprint !== operation.operationFingerprint
  ) return { status: "unavailable" }
  if (
    terminal.status === "found"
    && (
      terminal.completion.operationFingerprint !== operation.operationFingerprint
      || terminal.completion.terminalStatus === "completed" && (
        persistence.status !== "found"
        || terminal.completion.persistenceReceiptFingerprint !== persistence.receipt.persistenceReceiptFingerprint
      )
      || terminal.completion.terminalStatus !== "completed" && persistence.status === "found"
    )
  ) return { status: "unavailable" }
  let state: FlowDocBackendPdfExportPublicStateV1 = "accepted"
  let terminalStatus: FlowDocBackendPdfExportPublicStatusV1["terminalStatus"] = null
  let stopReason: string | null = null
  let updatedAt = operation.acceptedAt
  if (terminal.status === "found") {
    state = terminalState(terminal.completion.terminalStatus)
    terminalStatus = terminal.completion.terminalStatus
    stopReason = terminal.completion.stopReason
    updatedAt = terminal.completion.completedAt
  } else if (persistence.status === "found") {
    state = "finalizing"
    updatedAt = persistence.receipt.committedAt
  } else if (lifecycle.status === "found") {
    updatedAt = lifecycle.head.updatedAt
    if (lifecycle.head.status === "stopped" && lifecycle.head.stop != null) {
      state = stoppedState(lifecycle.head.stop.reason)
      stopReason = lifecycle.head.stop.reason
    } else if (lifecycle.head.cancellation != null) state = "cancel-requested"
    else if (lifecycle.head.status === "claimed") state = "processing"
    else state = "pending"
  }
  const receipt = persistence.status === "found" ? persistence.receipt : null
  return {
    status: "ready",
    value: {
      operationId: operation.operationId,
      exportRequestId: operation.admission.exportIdentity.exportRequestId,
      artifactId: operation.admission.exportIdentity.artifactId,
      documentId: operation.admission.exportIdentity.sourceIdentity.documentId,
      documentRevision: operation.admission.exportIdentity.sourceIdentity.documentRevision,
      state,
      acceptedAt: operation.acceptedAt,
      updatedAt,
      terminalStatus,
      stopReason,
      pageCount: receipt?.core.completion.artifact.pageCount ?? null,
      byteLength: receipt?.bytes.byteLength ?? null,
    },
  }
}

async function authenticate(
  request: FlowDocBackendPdfExportRouteRequestV1,
  options: FlowDocBackendPdfExportRouteOptionsV1,
): Promise<{ response: FlowDocBackendPdfExportRouteResponseV1; identity: null }
  | { response: null; identity: FlowDocBackendPdfExportAuthenticatedIdentityV1 }> {
  const result = await options.authenticator.authenticate({ authorization: request.authorization })
  if (result.status !== "authenticated" || !validIdentity(result.identity)) return {
    identity: null,
    response: jsonResponse({
      status: result.status === "unavailable" ? 503 : 401,
      value: { status: result.status === "authenticated" ? "unauthenticated" : result.status, issues: [issue("pdf-export-authentication-failed", "valid bearer authentication is required")] },
      headers: result.status === "unavailable" ? undefined : { "www-authenticate": "Bearer" },
      security: {
        authentication: result.status === "unavailable" ? "unavailable" : "failed",
        authorization: "not-run",
      },
    }),
  }
  return { response: null, identity: result.identity }
}

async function authorize(input: {
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
  action: FlowDocBackendPdfExportRouteActionV1
  documentId: string
  operationId: string | null
  options: FlowDocBackendPdfExportRouteOptionsV1
}): Promise<FlowDocBackendPdfExportRouteResponseV1 | null> {
  const result = await input.options.authorizer.authorize({
    identity: input.identity,
    action: input.action,
    documentId: input.documentId,
    operationId: input.operationId,
  })
  if (result.status === "authorized" && isFlowDocBackendPdfExportBoundedStringV1(result.authorizationId)) return null
  const unavailable = result.status === "unavailable" || result.status === "authorized"
  return jsonResponse({
    status: unavailable ? 503 : 403,
    value: {
      status: unavailable ? "unavailable" : result.status,
      issues: [issue(
        unavailable ? "pdf-export-authorization-unavailable" : "pdf-export-authorization-denied",
        unavailable ? "authorization is temporarily unavailable" : "the authenticated principal is not allowed to perform this action",
      )],
    },
    security: {
      authentication: "authenticated",
      authorization: unavailable ? "unavailable" : "denied",
    },
  })
}

const AUTHORIZED_SECURITY: FlowDocBackendPdfExportRouteSecurityV1 = {
  authentication: "authenticated",
  authorization: "authorized",
}

async function readScopedOperation(input: {
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
  operationId: string
  options: FlowDocBackendPdfExportRouteOptionsV1
}) {
  return input.options.operationRepository.readByOperationId({
    ...scope(input.identity),
    operationId: input.operationId,
  })
}

async function requestExport(input: {
  request: FlowDocBackendPdfExportRouteRequestV1
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
  options: FlowDocBackendPdfExportRouteOptionsV1
}): Promise<FlowDocBackendPdfExportRouteResponseV1> {
  const body = requestBody(input.request.body)
  if (body == null || !isFlowDocBackendPdfExportBoundedStringV1(input.request.idempotencyKey)) return jsonResponse({
    status: 400,
    value: { status: "invalid-request", issues: [issue("pdf-export-request-invalid", "an exact document pin and Idempotency-Key header are required; identity fields are forbidden")] },
    security: { authentication: "authenticated", authorization: "not-run" },
  })
  const denied = await authorize({
    identity: input.identity,
    action: "pdf-export:request",
    documentId: body.documentId,
    operationId: null,
    options: input.options,
  })
  if (denied != null) return denied
  const existing = await input.options.operationRepository.readByCallerKey({
    ...scope(input.identity),
    callerIdempotencyKey: input.request.idempotencyKey,
  })
  if (existing.status === "found") {
    const source = existing.operation.admission.exportIdentity.sourceIdentity
    if (source.documentId !== body.documentId || source.documentRevision !== body.documentRevision) return jsonResponse({
      status: 409,
      value: { status: "conflict", issues: [issue("pdf-export-idempotency-conflict", "Idempotency-Key is already bound to another document pin")] },
      security: AUTHORIZED_SECURITY,
    })
    const initialized = await input.options.lifecycleRepository.initializeLifecycle(existing.operation)
    if (initialized.status !== "created" && initialized.status !== "idempotent-replay") return jsonResponse({
      status: initialized.status === "conflict" ? 409 : 503,
      value: { status: "unavailable" },
      security: AUTHORIZED_SECURITY,
    })
    const status = await publicStatus({ operation: existing.operation, options: input.options })
    return status.status === "ready"
      ? jsonResponse({ status: 200, value: { status: "idempotent-replay", export: status.value }, security: AUTHORIZED_SECURITY })
      : jsonResponse({ status: 503, value: { status: "unavailable" }, security: AUTHORIZED_SECURITY })
  }
  if (existing.status !== "not-found") return jsonResponse({
    status: 503,
    value: { status: "unavailable" },
    security: AUTHORIZED_SECURITY,
  })
  const acceptedAt = input.options.now()
  if (!exactIso(acceptedAt)) return jsonResponse({
    status: 503,
    value: { status: "unavailable", issues: [issue("pdf-export-route-clock-invalid", "backend clock is unavailable")] },
    security: AUTHORIZED_SECURITY,
  })
  const resolved = await input.options.admissionResolver.resolve({
    identity: input.identity,
    documentId: body.documentId,
    documentRevision: body.documentRevision,
    acceptedAt,
  })
  if (resolved.status !== "ready") return jsonResponse({
    status: resolved.status === "not-found" ? 404 : resolved.status === "unavailable" ? 503 : 422,
    value: { status: resolved.status, issues: resolved.issues.map((entry) => issue(entry.code, "trusted PDF export admission resolution failed")) },
    security: AUTHORIZED_SECURITY,
  })
  const created = createFlowDocBackendPdfExportOperationV1({
    operationId: resolved.operationId,
    ...scope(input.identity),
    callerIdempotencyKey: input.request.idempotencyKey,
    acceptedAt,
    request: resolved.request,
    currentSource: resolved.currentSource,
    measuredDrawContract: resolved.measuredDrawContract,
    policy: resolved.policy,
  })
  if (created.status === "blocked") return jsonResponse({
    status: 422,
    value: { status: "rejected", issues: created.issues.map((entry) => issue(entry.code, entry.message)) },
    security: AUTHORIZED_SECURITY,
  })
  const source = created.operation.admission.exportIdentity.sourceIdentity
  if (source.documentId !== body.documentId || source.documentRevision !== body.documentRevision) return jsonResponse({
    status: 422,
    value: { status: "rejected", issues: [issue("pdf-export-admission-pin-mismatch", "trusted admission must match the requested document pin")] },
    security: AUTHORIZED_SECURITY,
  })
  const admitted = await input.options.operationRepository.admitOperation(created.operation)
  if (admitted.status !== "created" && admitted.status !== "idempotent-replay") return jsonResponse({
    status: admitted.status === "conflict" ? 409 : 503,
    value: { status: admitted.status, issues: admitted.issues.map((entry) => issue(entry.code, entry.message)) },
    security: AUTHORIZED_SECURITY,
  })
  const initialized = await input.options.lifecycleRepository.initializeLifecycle(admitted.operation)
  if (initialized.status !== "created" && initialized.status !== "idempotent-replay") return jsonResponse({
    status: initialized.status === "conflict" ? 409 : 503,
    value: { status: "unavailable", issues: initialized.issues.map((entry) => issue(entry.code, entry.message)) },
    security: AUTHORIZED_SECURITY,
  })
  const status = await publicStatus({ operation: admitted.operation, options: input.options })
  return status.status === "ready"
    ? jsonResponse({ status: admitted.status === "created" ? 202 : 200, value: { status: admitted.status, export: status.value }, security: AUTHORIZED_SECURITY })
    : jsonResponse({ status: 503, value: { status: "unavailable" }, security: AUTHORIZED_SECURITY })
}

async function readExport(input: {
  operation: FlowDocBackendPdfExportOperationV1
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
  options: FlowDocBackendPdfExportRouteOptionsV1
}): Promise<FlowDocBackendPdfExportRouteResponseV1> {
  const denied = await authorize({
    identity: input.identity,
    action: "pdf-export:read",
    documentId: input.operation.admission.exportIdentity.sourceIdentity.documentId,
    operationId: input.operation.operationId,
    options: input.options,
  })
  if (denied != null) return denied
  const status = await publicStatus({ operation: input.operation, options: input.options })
  return status.status === "ready"
    ? jsonResponse({ status: 200, value: { status: "found", export: status.value }, security: AUTHORIZED_SECURITY })
    : jsonResponse({ status: 503, value: { status: "unavailable" }, security: AUTHORIZED_SECURITY })
}

function cancelState(head: FlowDocBackendPdfExportLifecycleHeadV1): "cancel-requested" | "cancelled" {
  return head.status === "stopped" ? "cancelled" : "cancel-requested"
}

async function cancelExport(input: {
  request: FlowDocBackendPdfExportRouteRequestV1
  operation: FlowDocBackendPdfExportOperationV1
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
  options: FlowDocBackendPdfExportRouteOptionsV1
}): Promise<FlowDocBackendPdfExportRouteResponseV1> {
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.request.idempotencyKey)) return jsonResponse({
    status: 400,
    value: { status: "invalid-request", issues: [issue("pdf-export-cancel-idempotency-key-missing", "Idempotency-Key header is required for cancellation")] },
    security: { authentication: "authenticated", authorization: "not-run" },
  })
  const denied = await authorize({
    identity: input.identity,
    action: "pdf-export:cancel",
    documentId: input.operation.admission.exportIdentity.sourceIdentity.documentId,
    operationId: input.operation.operationId,
    options: input.options,
  })
  if (denied != null) return denied
  const lookup = { ...input.operation.scope, operationId: input.operation.operationId }
  const [terminal, persistence] = await Promise.all([
    input.options.observabilityRepository.readTerminalWorkflow(lookup),
    input.options.persistenceRepository.readByOperationId(lookup),
  ])
  if ([terminal.status, persistence.status].some((status) => ["invalid", "storage-unavailable"].includes(status))) return jsonResponse({
    status: 503,
    value: { status: "unavailable" },
    security: AUTHORIZED_SECURITY,
  })
  if (terminal.status === "found" || persistence.status === "found") return jsonResponse({
    status: 409,
    value: { status: terminal.status === "found" ? terminal.completion.terminalStatus : "finalizing", issues: [issue("pdf-export-cancel-terminal", "persisted or terminal PDF exports cannot be cancelled")] },
    security: AUTHORIZED_SECURITY,
  })
  let lifecycle = await input.options.lifecycleRepository.readLifecycle(lookup)
  if (lifecycle.status === "not-found") {
    const initialized = await input.options.lifecycleRepository.initializeLifecycle(input.operation)
    if (initialized.status !== "created" && initialized.status !== "idempotent-replay") return jsonResponse({
      status: 503,
      value: { status: "unavailable" },
      security: AUTHORIZED_SECURITY,
    })
    lifecycle = { status: "found", head: initialized.head, issues: [] }
  }
  if (lifecycle.status !== "found") return jsonResponse({ status: 503, value: { status: "unavailable" }, security: AUTHORIZED_SECURITY })
  const transitionId = `cancel:${flowDocBackendPdfExportFingerprintV1({
    ...lookup,
    idempotencyKey: input.request.idempotencyKey,
  }).slice("sha256:".length)}`
  let transitionAt: string | null = null
  let head = lifecycle.head
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (head.cancellation?.transitionId === transitionId) return jsonResponse({
      status: 200,
      value: { status: "idempotent-replay", operationId: input.operation.operationId, state: cancelState(head), requestedAt: head.cancellation.requestedAt },
      security: AUTHORIZED_SECURITY,
    })
    if (head.cancellation != null || head.status === "stopped") return jsonResponse({
      status: 409,
      value: { status: "conflict", issues: [issue("pdf-export-cancel-conflict", "the export already has another cancellation or terminal decision")] },
      security: AUTHORIZED_SECURITY,
    })
    transitionAt ??= input.options.now()
    if (!exactIso(transitionAt)) return jsonResponse({ status: 503, value: { status: "unavailable" }, security: AUTHORIZED_SECURITY })
    const applied = await input.options.lifecycleRepository.applyLifecycleTransition({
      transitionId,
      ...lookup,
      expectedHeadRevision: head.headRevision,
      transitionAt,
      kind: "request-cancellation",
    })
    if (applied.status === "applied" || applied.status === "idempotent-replay") {
      const persistedAfterCancellation = await input.options.persistenceRepository.readByOperationId(lookup)
      if (persistedAfterCancellation.status === "found") return jsonResponse({
        status: 409,
        value: { status: "finalizing", issues: [issue("pdf-export-cancel-persistence-won", "verified persistence completed concurrently with cancellation")] },
        security: AUTHORIZED_SECURITY,
      })
      if (persistedAfterCancellation.status !== "not-found") return jsonResponse({
        status: 503,
        value: { status: "unavailable" },
        security: AUTHORIZED_SECURITY,
      })
      return jsonResponse({
        status: applied.head.status === "stopped" ? 200 : 202,
        value: { status: applied.status, operationId: input.operation.operationId, state: cancelState(applied.head), requestedAt: applied.head.cancellation?.requestedAt ?? transitionAt },
        security: AUTHORIZED_SECURITY,
      })
    }
    if (applied.status !== "stale") return jsonResponse({
      status: applied.status === "conflict" || applied.status === "blocked" ? 409 : 503,
      value: { status: applied.status, issues: applied.issues.map((entry) => issue(entry.code, entry.message)) },
      security: AUTHORIZED_SECURITY,
    })
    const reread = await input.options.lifecycleRepository.readLifecycle(lookup)
    if (reread.status !== "found") return jsonResponse({ status: 503, value: { status: "unavailable" }, security: AUTHORIZED_SECURITY })
    head = reread.head
  }
  return jsonResponse({ status: 409, value: { status: "stale" }, security: AUTHORIZED_SECURITY })
}

async function downloadExport(input: {
  operation: FlowDocBackendPdfExportOperationV1
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
  options: FlowDocBackendPdfExportRouteOptionsV1
}): Promise<FlowDocBackendPdfExportRouteResponseV1> {
  const denied = await authorize({
    identity: input.identity,
    action: "pdf-export:download",
    documentId: input.operation.admission.exportIdentity.sourceIdentity.documentId,
    operationId: input.operation.operationId,
    options: input.options,
  })
  if (denied != null) return denied
  const lookup = { ...input.operation.scope, operationId: input.operation.operationId }
  const [terminal, persistence] = await Promise.all([
    input.options.observabilityRepository.readTerminalWorkflow(lookup),
    input.options.persistenceRepository.readByOperationId(lookup),
  ])
  if (terminal.status === "not-found" || terminal.status === "found" && terminal.completion.terminalStatus !== "completed") return jsonResponse({
    status: 409,
    value: { status: "not-ready", issues: [issue("pdf-export-download-not-ready", "download requires a completed terminal workflow")] },
    security: AUTHORIZED_SECURITY,
  })
  if (terminal.status !== "found" || persistence.status !== "found") return jsonResponse({
    status: 503,
    value: { status: "unavailable" },
    security: AUTHORIZED_SECURITY,
  })
  const receipt = persistence.receipt
  if (
    terminal.completion.operationFingerprint !== input.operation.operationFingerprint
    || terminal.completion.persistenceReceiptFingerprint !== receipt.persistenceReceiptFingerprint
    || receipt.operationFingerprint !== input.operation.operationFingerprint
  ) return jsonResponse({
    status: 503,
    value: { status: "integrity-failed", issues: [issue("pdf-export-download-evidence-mismatch", "terminal and persistence evidence do not match")] },
    security: AUTHORIZED_SECURITY,
  })
  const content = await input.options.contentStore.read({ storageKey: receipt.bytes.storageKey })
  if (
    content.status !== "found"
    || content.content.sha256 !== receipt.bytes.sha256
    || content.content.byteLength !== receipt.bytes.byteLength
    || content.bytes.byteLength !== receipt.bytes.byteLength
  ) return jsonResponse({
    status: 503,
    value: { status: "integrity-failed", issues: [issue("pdf-export-download-byte-verification-failed", "physical PDF bytes failed verification")] },
    security: AUTHORIZED_SECURITY,
  })
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_ROUTE_V1_SOURCE,
    matched: true,
    httpStatus: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": "attachment; filename=\"flowdoc-export.pdf\"",
      "content-length": String(content.bytes.byteLength),
      "content-type": "application/pdf",
      etag: `\"${content.content.sha256}\"`,
      "x-content-type-options": "nosniff",
    },
    body: { kind: "pdf", bytes: new Uint8Array(content.bytes) },
    security: AUTHORIZED_SECURITY,
    contracts: contracts(),
  }
}

export async function handleFlowDocBackendPdfExportRouteV1(
  request: FlowDocBackendPdfExportRouteRequestV1,
  options: FlowDocBackendPdfExportRouteOptionsV1,
): Promise<FlowDocBackendPdfExportRouteResponseV1> {
  const target = routeTarget(request.path)
  if (target == null) return jsonResponse({
    status: 404,
    value: { status: "not-found" },
    security: { authentication: "not-run", authorization: "not-run" },
    matched: false,
  })
  const method = request.method.trim().toUpperCase()
  if (method !== target.allowedMethod) return jsonResponse({
    status: 405,
    value: { status: "method-not-allowed" },
    headers: { allow: target.allowedMethod },
    security: { authentication: "not-run", authorization: "not-run" },
  })
  const authenticated = await authenticate(request, options)
  if (authenticated.response != null) return authenticated.response
  const identity = authenticated.identity
  if (target.action === "pdf-export:request") return requestExport({ request, identity, options })
  const operation = await readScopedOperation({ identity, operationId: target.operationId!, options })
  if (operation.status === "not-found") return jsonResponse({
    status: 404,
    value: { status: "not-found" },
    security: { authentication: "authenticated", authorization: "not-run" },
  })
  if (operation.status !== "found") return jsonResponse({
    status: 503,
    value: { status: "unavailable" },
    security: { authentication: "authenticated", authorization: "not-run" },
  })
  if (target.action === "pdf-export:read") return readExport({ operation: operation.operation, identity, options })
  if (target.action === "pdf-export:cancel") return cancelExport({ request, operation: operation.operation, identity, options })
  return downloadExport({ operation: operation.operation, identity, options })
}
