import { createHash } from "node:crypto"
import {
  createVNextPdfExportProductionAdmissionV1,
  VNEXT_PDF_EXPORT_PRODUCTION_ADMISSION_V1_SOURCE,
  VNEXT_PDF_EXPORT_PRODUCTION_ADMISSION_V1_VERSION,
  type VNextPdfExportProductionAdmissionV1,
  type VNextPdfExportProductionPolicyV1,
  type VNextPdfExportRequestV1,
  type VNextPdfExportSourceIdentityV1,
  type VNextPdfMeasuredDrawContractResultV1,
} from "@flowdoc/vnext-core"

export const FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_V1_SOURCE =
  "flowdoc-backend-pdf-export-operation" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_V1_VERSION = 1 as const
// Core measurement-profile identities include digest-bound font, style, shaping,
// and segmentation facts; retained canonical evidence currently exceeds 512.
export const FLOWDOC_BACKEND_PDF_EXPORT_MAX_ID_LENGTH = 2_048

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

export interface FlowDocBackendPdfExportOperationIssueV1 {
  severity: "error"
  code: string
  path: string
  message: string
}

export interface FlowDocBackendPdfExportOperationV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_V1_SOURCE
  contractVersion: typeof FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_V1_VERSION
  kind: "pdf-export-operation"
  operationId: string
  status: "accepted"
  scope: {
    tenantId: string
    principalId: string
  }
  idempotency: {
    callerKey: string
    payloadFingerprint: string
  }
  admission: VNextPdfExportProductionAdmissionV1
  acceptedAt: string
  contracts: {
    backendOwned: true
    importsCoreAsPublicPackage: true
    usesCoreProductionAdmission: true
    immutableAdmission: true
    callerKeyBoundToPayload: true
    tenantAndPrincipalScoped: true
    lifecycleHead: false
    workerExecution: false
    deadlineExecution: false
    cancellationExecution: false
    rendererExecution: false
    storageWrites: false
    artifactProjection: false
    observabilityWrites: false
    backendRoute: false
    authzExecution: false
    productionBinding: false
  }
  operationFingerprint: string
}

export type FlowDocBackendPdfExportOperationResultV1 =
  | { status: "ready"; operation: FlowDocBackendPdfExportOperationV1; issues: [] }
  | { status: "blocked"; operation: null; issues: FlowDocBackendPdfExportOperationIssueV1[] }

export interface FlowDocBackendPdfExportOperationCreateInputV1 {
  operationId: string
  tenantId: string
  principalId: string
  callerIdempotencyKey: string
  acceptedAt: string
  request: VNextPdfExportRequestV1
  currentSource: VNextPdfExportSourceIdentityV1
  measuredDrawContract: VNextPdfMeasuredDrawContractResultV1
  policy: VNextPdfExportProductionPolicyV1
}

export function flowDocBackendPdfExportOperationIssueV1(
  code: string,
  path: string,
  message: string,
): FlowDocBackendPdfExportOperationIssueV1 {
  return { severity: "error", code, path, message }
}

export function cloneFlowDocBackendPdfExportJsonV1<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function flowDocBackendPdfExportFingerprintV1(value: object): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

export function isFlowDocBackendPdfExportRecordV1(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

export function isFlowDocBackendPdfExportBoundedStringV1(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= FLOWDOC_BACKEND_PDF_EXPORT_MAX_ID_LENGTH
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
  issues: FlowDocBackendPdfExportOperationIssueV1[],
): Record<string, unknown> | null {
  if (!isFlowDocBackendPdfExportRecordV1(value)) {
    issues.push(flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-record-invalid",
      path,
      `${path || "value"} must be an object`,
    ))
    return null
  }
  const allowed = new Set(keys)
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) issues.push(flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-property-unknown",
      path.length === 0 ? key : `${path}.${key}`,
      `${path.length === 0 ? key : `${path}.${key}`} is not allowed`,
    ))
  })
  return value
}

function boundedString(
  value: unknown,
  path: string,
  issues: FlowDocBackendPdfExportOperationIssueV1[],
): string | null {
  if (isFlowDocBackendPdfExportBoundedStringV1(value)) return value
  issues.push(flowDocBackendPdfExportOperationIssueV1(
    "pdf-export-operation-string-invalid",
    path,
    `${path} must be a non-empty string of at most ${FLOWDOC_BACKEND_PDF_EXPORT_MAX_ID_LENGTH} characters`,
  ))
  return null
}

function fingerprint(
  value: unknown,
  path: string,
  issues: FlowDocBackendPdfExportOperationIssueV1[],
): string | null {
  if (typeof value === "string" && FINGERPRINT.test(value)) return value
  issues.push(flowDocBackendPdfExportOperationIssueV1(
    "pdf-export-operation-fingerprint-invalid",
    path,
    `${path} must be a compact SHA-256 fingerprint`,
  ))
  return null
}

function exactIsoDate(
  value: unknown,
  path: string,
  issues: FlowDocBackendPdfExportOperationIssueV1[],
): string | null {
  if (typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value) {
    return value
  }
  issues.push(flowDocBackendPdfExportOperationIssueV1(
    "pdf-export-operation-date-invalid",
    path,
    `${path} must be an exact ISO date-time`,
  ))
  return null
}

function literal(
  actual: unknown,
  expected: string | number | boolean,
  path: string,
  issues: FlowDocBackendPdfExportOperationIssueV1[],
): boolean {
  if (actual === expected) return true
  issues.push(flowDocBackendPdfExportOperationIssueV1(
    "pdf-export-operation-literal-invalid",
    path,
    `${path} must equal ${String(expected)}`,
  ))
  return false
}

function parseAdmission(
  value: unknown,
  issues: FlowDocBackendPdfExportOperationIssueV1[],
): VNextPdfExportProductionAdmissionV1 | null {
  const admission = exactRecord(value, "admission", [
    "source",
    "contractVersion",
    "kind",
    "admissionId",
    "policy",
    "exportIdentity",
    "idempotency",
    "lifecycle",
    "resources",
    "activation",
    "contracts",
    "admissionFingerprint",
  ], issues)
  if (admission == null) return null
  literal(admission.source, VNEXT_PDF_EXPORT_PRODUCTION_ADMISSION_V1_SOURCE, "admission.source", issues)
  literal(
    admission.contractVersion,
    VNEXT_PDF_EXPORT_PRODUCTION_ADMISSION_V1_VERSION,
    "admission.contractVersion",
    issues,
  )
  literal(admission.kind, "pdf-export-production-admission", "admission.kind", issues)
  const admissionId = boundedString(admission.admissionId, "admission.admissionId", issues)
  const admissionFingerprint = fingerprint(
    admission.admissionFingerprint,
    "admission.admissionFingerprint",
    issues,
  )
  const idempotency = isFlowDocBackendPdfExportRecordV1(admission.idempotency)
    ? admission.idempotency
    : null
  const payloadFingerprint = idempotency == null
    ? null
    : fingerprint(
        idempotency.payloadFingerprint,
        "admission.idempotency.payloadFingerprint",
        issues,
      )
  if (idempotency == null) issues.push(flowDocBackendPdfExportOperationIssueV1(
    "pdf-export-operation-admission-idempotency-invalid",
    "admission.idempotency",
    "admission must retain Core idempotency facts",
  ))
  const contracts = isFlowDocBackendPdfExportRecordV1(admission.contracts)
    ? admission.contracts
    : null
  if (contracts == null || contracts.productionBinding !== false || contracts.rendererExecution !== false) {
    issues.push(flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-admission-boundary-invalid",
      "admission.contracts",
      "admission must remain a non-executing Core production boundary",
    ))
  }
  const activation = isFlowDocBackendPdfExportRecordV1(admission.activation)
    ? admission.activation
    : null
  if (activation == null || activation.status !== "blocked" || activation.productionBinding !== false) {
    issues.push(flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-admission-activation-invalid",
      "admission.activation",
      "admission must retain blocked production activation",
    ))
  }
  if (admissionFingerprint != null) {
    const { admissionFingerprint: _fingerprint, ...facts } = admission
    if (flowDocBackendPdfExportFingerprintV1(facts) !== admissionFingerprint) {
      issues.push(flowDocBackendPdfExportOperationIssueV1(
        "pdf-export-operation-admission-fingerprint-mismatch",
        "admission.admissionFingerprint",
        "admission fingerprint must match its exact Core facts",
      ))
    }
  }
  if (admissionId == null || payloadFingerprint == null || issues.length > 0) return null
  return cloneFlowDocBackendPdfExportJsonV1(value as VNextPdfExportProductionAdmissionV1)
}

export function parseFlowDocBackendPdfExportOperationV1(
  value: unknown,
): FlowDocBackendPdfExportOperationResultV1 {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  const record = exactRecord(value, "", [
    "source",
    "contractVersion",
    "kind",
    "operationId",
    "status",
    "scope",
    "idempotency",
    "admission",
    "acceptedAt",
    "contracts",
    "operationFingerprint",
  ], issues)
  if (record == null) return { status: "blocked", operation: null, issues }
  literal(record.source, FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_V1_SOURCE, "source", issues)
  literal(record.contractVersion, FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_V1_VERSION, "contractVersion", issues)
  literal(record.kind, "pdf-export-operation", "kind", issues)
  literal(record.status, "accepted", "status", issues)
  const operationId = boundedString(record.operationId, "operationId", issues)
  const acceptedAt = exactIsoDate(record.acceptedAt, "acceptedAt", issues)
  const operationFingerprint = fingerprint(record.operationFingerprint, "operationFingerprint", issues)
  const scope = exactRecord(record.scope, "scope", ["tenantId", "principalId"], issues)
  const tenantId = scope == null ? null : boundedString(scope.tenantId, "scope.tenantId", issues)
  const principalId = scope == null ? null : boundedString(scope.principalId, "scope.principalId", issues)
  const idempotency = exactRecord(
    record.idempotency,
    "idempotency",
    ["callerKey", "payloadFingerprint"],
    issues,
  )
  const callerKey = idempotency == null
    ? null
    : boundedString(idempotency.callerKey, "idempotency.callerKey", issues)
  const payloadFingerprint = idempotency == null
    ? null
    : fingerprint(idempotency.payloadFingerprint, "idempotency.payloadFingerprint", issues)
  const admission = parseAdmission(record.admission, issues)
  const contracts = exactRecord(record.contracts, "contracts", [
    "backendOwned",
    "importsCoreAsPublicPackage",
    "usesCoreProductionAdmission",
    "immutableAdmission",
    "callerKeyBoundToPayload",
    "tenantAndPrincipalScoped",
    "lifecycleHead",
    "workerExecution",
    "deadlineExecution",
    "cancellationExecution",
    "rendererExecution",
    "storageWrites",
    "artifactProjection",
    "observabilityWrites",
    "backendRoute",
    "authzExecution",
    "productionBinding",
  ], issues)
  const contractLiterals: Array<[string, boolean]> = [
    ["backendOwned", true],
    ["importsCoreAsPublicPackage", true],
    ["usesCoreProductionAdmission", true],
    ["immutableAdmission", true],
    ["callerKeyBoundToPayload", true],
    ["tenantAndPrincipalScoped", true],
    ["lifecycleHead", false],
    ["workerExecution", false],
    ["deadlineExecution", false],
    ["cancellationExecution", false],
    ["rendererExecution", false],
    ["storageWrites", false],
    ["artifactProjection", false],
    ["observabilityWrites", false],
    ["backendRoute", false],
    ["authzExecution", false],
    ["productionBinding", false],
  ]
  if (contracts != null) contractLiterals.forEach(([key, expected]) => {
    literal(contracts[key], expected, `contracts.${key}`, issues)
  })
  if (operationId != null && admission != null && admission.admissionId !== operationId) {
    issues.push(flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-admission-id-mismatch",
      "admission.admissionId",
      "Core admission id must equal the backend operation id",
    ))
  }
  if (payloadFingerprint != null
    && admission != null
    && admission.idempotency.payloadFingerprint !== payloadFingerprint) {
    issues.push(flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-payload-fingerprint-mismatch",
      "idempotency.payloadFingerprint",
      "backend caller-key binding must use the exact Core admission payload fingerprint",
    ))
  }
  if (operationFingerprint != null) {
    const { operationFingerprint: _fingerprint, ...facts } = record
    if (flowDocBackendPdfExportFingerprintV1(facts) !== operationFingerprint) {
      issues.push(flowDocBackendPdfExportOperationIssueV1(
        "pdf-export-operation-fingerprint-mismatch",
        "operationFingerprint",
        "operation fingerprint must match its exact retained facts",
      ))
    }
  }
  if (
    operationId == null || acceptedAt == null || operationFingerprint == null
    || tenantId == null || principalId == null || callerKey == null
    || payloadFingerprint == null || admission == null || contracts == null
    || issues.length > 0
  ) return { status: "blocked", operation: null, issues }
  return {
    status: "ready",
    operation: cloneFlowDocBackendPdfExportJsonV1(value as FlowDocBackendPdfExportOperationV1),
    issues: [],
  }
}

export function createFlowDocBackendPdfExportOperationV1(
  input: FlowDocBackendPdfExportOperationCreateInputV1,
): FlowDocBackendPdfExportOperationResultV1 {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  const operationId = boundedString(input.operationId, "operationId", issues)
  const tenantId = boundedString(input.tenantId, "tenantId", issues)
  const principalId = boundedString(input.principalId, "principalId", issues)
  const callerKey = boundedString(input.callerIdempotencyKey, "callerIdempotencyKey", issues)
  const acceptedAt = exactIsoDate(input.acceptedAt, "acceptedAt", issues)
  if (acceptedAt != null && Date.parse(acceptedAt) < Date.parse(input.request.requestedAt)) {
    issues.push(flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-accepted-before-request",
      "acceptedAt",
      "backend acceptance time must not precede the Core export request",
    ))
  }
  const admission = createVNextPdfExportProductionAdmissionV1({
    admissionId: input.operationId,
    request: input.request,
    currentSource: input.currentSource,
    measuredDrawContract: input.measuredDrawContract,
    policy: input.policy,
  })
  if (admission.status !== "admitted") admission.issues.forEach((item, index) => {
    issues.push(flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-operation-core-admission-blocked",
      `admission.issues[${index}].${item.path}`,
      `${item.code}: ${item.message}`,
    ))
  })
  if (
    operationId == null || tenantId == null || principalId == null || callerKey == null
    || acceptedAt == null || admission.status !== "admitted" || issues.length > 0
  ) return { status: "blocked", operation: null, issues }

  const facts = {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_V1_SOURCE,
    contractVersion: FLOWDOC_BACKEND_PDF_EXPORT_OPERATION_V1_VERSION,
    kind: "pdf-export-operation" as const,
    operationId,
    status: "accepted" as const,
    scope: { tenantId, principalId },
    idempotency: {
      callerKey,
      payloadFingerprint: admission.admission.idempotency.payloadFingerprint,
    },
    admission: cloneFlowDocBackendPdfExportJsonV1(admission.admission),
    acceptedAt,
    contracts: {
      backendOwned: true as const,
      importsCoreAsPublicPackage: true as const,
      usesCoreProductionAdmission: true as const,
      immutableAdmission: true as const,
      callerKeyBoundToPayload: true as const,
      tenantAndPrincipalScoped: true as const,
      lifecycleHead: false as const,
      workerExecution: false as const,
      deadlineExecution: false as const,
      cancellationExecution: false as const,
      rendererExecution: false as const,
      storageWrites: false as const,
      artifactProjection: false as const,
      observabilityWrites: false as const,
      backendRoute: false as const,
      authzExecution: false as const,
      productionBinding: false as const,
    },
  }
  return {
    status: "ready",
    operation: {
      ...facts,
      operationFingerprint: flowDocBackendPdfExportFingerprintV1(facts),
    },
    issues: [],
  }
}
