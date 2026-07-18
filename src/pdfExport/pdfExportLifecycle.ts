import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  isFlowDocBackendPdfExportRecordV1,
  parseFlowDocBackendPdfExportOperationV1,
  type FlowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_HEAD_V1_SOURCE =
  "flowdoc-backend-pdf-export-lifecycle-head" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_TRANSITION_V1_SOURCE =
  "flowdoc-backend-pdf-export-lifecycle-transition" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION = 1 as const
export const FLOWDOC_BACKEND_PDF_EXPORT_MAX_CLAIM_DURATION_MS = 5 * 60 * 1000

export type FlowDocBackendPdfExportCheckpointV1 =
  | "before-handoff"
  | "before-render"
  | "before-persist"

export type FlowDocBackendPdfExportLifecycleStopReasonV1 =
  | "cancelled-before-handoff"
  | "cancelled-before-render"
  | "cancelled-before-persist"
  | "deadline-exceeded"
  | "attempts-exhausted"
  | "shutdown-forced"

export interface FlowDocBackendPdfExportLifecycleClaimV1 {
  claimToken: string
  workerId: string
  attemptNumber: number
  claimedAt: string
  expiresAt: string
}

export interface FlowDocBackendPdfExportLifecycleCancellationV1 {
  transitionId: string
  requestedAt: string
}

export interface FlowDocBackendPdfExportLifecycleReleaseV1 {
  claimToken: string
  workerId: string
  attemptNumber: number
  releasedAt: string
  retryAfter: string | null
}

export interface FlowDocBackendPdfExportLifecycleCheckpointCheckV1 {
  checkpoint: FlowDocBackendPdfExportCheckpointV1
  claimToken: string
  checkedAt: string
}

export interface FlowDocBackendPdfExportLifecycleStopV1 {
  reason: FlowDocBackendPdfExportLifecycleStopReasonV1
  checkpoint: FlowDocBackendPdfExportCheckpointV1
  stoppedAt: string
}

export interface FlowDocBackendPdfExportLifecycleHeadV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_HEAD_V1_SOURCE
  contractVersion: typeof FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION
  kind: "pdf-export-lifecycle-head"
  operationId: string
  scope: {
    tenantId: string
    principalId: string
  }
  operationFingerprint: string
  admissionFingerprint: string
  payloadFingerprint: string
  headRevision: number
  status: "pending" | "claimed" | "stopped"
  checkpoint: FlowDocBackendPdfExportCheckpointV1
  attemptCount: number
  maxAttempts: number
  retryAfter: string | null
  claim: FlowDocBackendPdfExportLifecycleClaimV1 | null
  cancellation: FlowDocBackendPdfExportLifecycleCancellationV1 | null
  lastRelease: FlowDocBackendPdfExportLifecycleReleaseV1 | null
  checkpointCheck: FlowDocBackendPdfExportLifecycleCheckpointCheckV1 | null
  stop: FlowDocBackendPdfExportLifecycleStopV1 | null
  createdAt: string
  updatedAt: string
  deadlineAt: string
  contracts: {
    revisionCompareAndSwap: true
    durableTransitionReplay: true
    boundedClaims: true
    boundedAttempts: true
    deadlineEnforcement: true
    checkpointCancellation: true
    rendererExecution: false
    bytePersistence: false
    artifactProjection: false
    backendRoute: false
    productionBinding: false
  }
  lifecycleFingerprint: string
}

type LifecycleHeadFactsV1 = Omit<FlowDocBackendPdfExportLifecycleHeadV1, "lifecycleFingerprint">

interface FlowDocBackendPdfExportLifecycleTransitionBaseV1 {
  transitionId: string
  tenantId: string
  principalId: string
  operationId: string
  expectedHeadRevision: number
  transitionAt: string
}

export type FlowDocBackendPdfExportLifecycleTransitionRequestV1 =
  | (FlowDocBackendPdfExportLifecycleTransitionBaseV1 & {
      kind: "claim"
      claimToken: string
      workerId: string
      claimExpiresAt: string
    })
  | (FlowDocBackendPdfExportLifecycleTransitionBaseV1 & {
      kind: "request-cancellation"
    })
  | (FlowDocBackendPdfExportLifecycleTransitionBaseV1 & {
      kind: "pass-checkpoint"
      claimToken: string
      nextCheckpoint: "before-render" | "before-persist"
    })
  | (FlowDocBackendPdfExportLifecycleTransitionBaseV1 & {
      kind: "release-claim"
      claimToken: string
      retryAfter: string | null
    })
  | (FlowDocBackendPdfExportLifecycleTransitionBaseV1 & {
      kind: "check-checkpoint"
      claimToken: string
    })
  | (FlowDocBackendPdfExportLifecycleTransitionBaseV1 & {
      kind: "enforce-deadline"
    })
  | (FlowDocBackendPdfExportLifecycleTransitionBaseV1 & {
      kind: "force-shutdown"
    })

export interface FlowDocBackendPdfExportLifecycleTransitionReceiptV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_TRANSITION_V1_SOURCE
  contractVersion: typeof FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION
  kind: "pdf-export-lifecycle-transition-receipt"
  transitionId: string
  operationId: string
  transitionKind: FlowDocBackendPdfExportLifecycleTransitionRequestV1["kind"]
  requestFingerprint: string
  fromHeadRevision: number
  toHeadRevision: number
  resultHeadFingerprint: string
  appliedAt: string
  receiptFingerprint: string
}

export type FlowDocBackendPdfExportLifecycleHeadResultV1 =
  | { status: "ready"; head: FlowDocBackendPdfExportLifecycleHeadV1; issues: [] }
  | { status: "blocked"; head: null; issues: FlowDocBackendPdfExportOperationIssueV1[] }

export type FlowDocBackendPdfExportLifecycleTransitionInspectionV1 =
  | {
      status: "ready"
      request: FlowDocBackendPdfExportLifecycleTransitionRequestV1
      requestFingerprint: string
      issues: []
    }
  | { status: "blocked"; request: null; requestFingerprint: null; issues: FlowDocBackendPdfExportOperationIssueV1[] }

export type FlowDocBackendPdfExportLifecycleApplyResultV1 =
  | {
      status: "applied"
      head: FlowDocBackendPdfExportLifecycleHeadV1
      receipt: FlowDocBackendPdfExportLifecycleTransitionReceiptV1
      issues: []
    }
  | {
      status: "blocked"
      head: FlowDocBackendPdfExportLifecycleHeadV1 | null
      receipt: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u
const CHECKPOINTS = new Set<FlowDocBackendPdfExportCheckpointV1>([
  "before-handoff",
  "before-render",
  "before-persist",
])
const STOP_REASONS = new Set<FlowDocBackendPdfExportLifecycleStopReasonV1>([
  "cancelled-before-handoff",
  "cancelled-before-render",
  "cancelled-before-persist",
  "deadline-exceeded",
  "attempts-exhausted",
  "shutdown-forced",
])

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|")
}

function fingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT.test(value)
}

function parseClaim(value: unknown): FlowDocBackendPdfExportLifecycleClaimV1 | null {
  if (!isFlowDocBackendPdfExportRecordV1(value) || !exactKeys(value, [
    "claimToken", "workerId", "attemptNumber", "claimedAt", "expiresAt",
  ])) return null
  if (
    !isFlowDocBackendPdfExportBoundedStringV1(value.claimToken)
    || !isFlowDocBackendPdfExportBoundedStringV1(value.workerId)
    || !Number.isInteger(value.attemptNumber)
    || (value.attemptNumber as number) < 1
    || !exactIso(value.claimedAt)
    || !exactIso(value.expiresAt)
    || Date.parse(value.expiresAt) <= Date.parse(value.claimedAt)
    || Date.parse(value.expiresAt) - Date.parse(value.claimedAt) > FLOWDOC_BACKEND_PDF_EXPORT_MAX_CLAIM_DURATION_MS
  ) return null
  return cloneFlowDocBackendPdfExportJsonV1(value as unknown as FlowDocBackendPdfExportLifecycleClaimV1)
}

function parseCancellation(value: unknown): FlowDocBackendPdfExportLifecycleCancellationV1 | null {
  if (!isFlowDocBackendPdfExportRecordV1(value) || !exactKeys(value, ["transitionId", "requestedAt"])) return null
  if (!isFlowDocBackendPdfExportBoundedStringV1(value.transitionId) || !exactIso(value.requestedAt)) return null
  return { transitionId: value.transitionId, requestedAt: value.requestedAt }
}

function parseRelease(value: unknown): FlowDocBackendPdfExportLifecycleReleaseV1 | null {
  if (!isFlowDocBackendPdfExportRecordV1(value) || !exactKeys(value, [
    "claimToken", "workerId", "attemptNumber", "releasedAt", "retryAfter",
  ])) return null
  if (
    !isFlowDocBackendPdfExportBoundedStringV1(value.claimToken)
    || !isFlowDocBackendPdfExportBoundedStringV1(value.workerId)
    || !Number.isInteger(value.attemptNumber)
    || (value.attemptNumber as number) < 1
    || !exactIso(value.releasedAt)
    || (value.retryAfter !== null && !exactIso(value.retryAfter))
  ) return null
  return cloneFlowDocBackendPdfExportJsonV1(value as unknown as FlowDocBackendPdfExportLifecycleReleaseV1)
}

function parseCheckpointCheck(value: unknown): FlowDocBackendPdfExportLifecycleCheckpointCheckV1 | null {
  if (!isFlowDocBackendPdfExportRecordV1(value) || !exactKeys(value, [
    "checkpoint", "claimToken", "checkedAt",
  ])) return null
  if (
    typeof value.checkpoint !== "string"
    || !CHECKPOINTS.has(value.checkpoint as FlowDocBackendPdfExportCheckpointV1)
    || !isFlowDocBackendPdfExportBoundedStringV1(value.claimToken)
    || !exactIso(value.checkedAt)
  ) return null
  return cloneFlowDocBackendPdfExportJsonV1(value as unknown as FlowDocBackendPdfExportLifecycleCheckpointCheckV1)
}

function parseStop(value: unknown): FlowDocBackendPdfExportLifecycleStopV1 | null {
  if (!isFlowDocBackendPdfExportRecordV1(value) || !exactKeys(value, ["reason", "checkpoint", "stoppedAt"])) {
    return null
  }
  if (
    typeof value.reason !== "string"
    || !STOP_REASONS.has(value.reason as FlowDocBackendPdfExportLifecycleStopReasonV1)
    || typeof value.checkpoint !== "string"
    || !CHECKPOINTS.has(value.checkpoint as FlowDocBackendPdfExportCheckpointV1)
    || !exactIso(value.stoppedAt)
  ) return null
  return cloneFlowDocBackendPdfExportJsonV1(value as unknown as FlowDocBackendPdfExportLifecycleStopV1)
}

function cancellationReason(checkpoint: FlowDocBackendPdfExportCheckpointV1): FlowDocBackendPdfExportLifecycleStopReasonV1 {
  if (checkpoint === "before-handoff") return "cancelled-before-handoff"
  if (checkpoint === "before-render") return "cancelled-before-render"
  return "cancelled-before-persist"
}

function finalizeHead(facts: LifecycleHeadFactsV1): FlowDocBackendPdfExportLifecycleHeadV1 {
  const cloned = cloneFlowDocBackendPdfExportJsonV1(facts)
  return { ...cloned, lifecycleFingerprint: flowDocBackendPdfExportFingerprintV1(cloned) }
}

export function parseFlowDocBackendPdfExportLifecycleHeadV1(
  value: unknown,
): FlowDocBackendPdfExportLifecycleHeadResultV1 {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (!isFlowDocBackendPdfExportRecordV1(value) || !exactKeys(value, [
    "source", "contractVersion", "kind", "operationId", "scope", "operationFingerprint",
    "admissionFingerprint", "payloadFingerprint", "headRevision", "status", "checkpoint",
    "attemptCount", "maxAttempts", "retryAfter", "claim", "cancellation", "lastRelease",
    "checkpointCheck", "stop", "createdAt", "updatedAt", "deadlineAt", "contracts", "lifecycleFingerprint",
  ])) return {
    status: "blocked",
    head: null,
    issues: [issue("pdf-export-lifecycle-shape-invalid", "head", "lifecycle head must contain only the V1 fields")],
  }
  const record = value
  const scope = isFlowDocBackendPdfExportRecordV1(record.scope) && exactKeys(record.scope, ["tenantId", "principalId"])
    ? record.scope
    : null
  if (
    record.source !== FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_HEAD_V1_SOURCE
    || record.contractVersion !== FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION
    || record.kind !== "pdf-export-lifecycle-head"
    || !isFlowDocBackendPdfExportBoundedStringV1(record.operationId)
    || scope == null
    || !isFlowDocBackendPdfExportBoundedStringV1(scope.tenantId)
    || !isFlowDocBackendPdfExportBoundedStringV1(scope.principalId)
    || !fingerprint(record.operationFingerprint)
    || !fingerprint(record.admissionFingerprint)
    || !fingerprint(record.payloadFingerprint)
    || !Number.isInteger(record.headRevision)
    || (record.headRevision as number) < 0
    || !["pending", "claimed", "stopped"].includes(String(record.status))
    || typeof record.checkpoint !== "string"
    || !CHECKPOINTS.has(record.checkpoint as FlowDocBackendPdfExportCheckpointV1)
    || !Number.isInteger(record.attemptCount)
    || (record.attemptCount as number) < 0
    || !Number.isInteger(record.maxAttempts)
    || (record.maxAttempts as number) < 1
    || (record.attemptCount as number) > (record.maxAttempts as number)
    || (record.retryAfter !== null && !exactIso(record.retryAfter))
    || !exactIso(record.createdAt)
    || !exactIso(record.updatedAt)
    || !exactIso(record.deadlineAt)
    || Date.parse(record.updatedAt) < Date.parse(record.createdAt)
    || Date.parse(record.deadlineAt) <= Date.parse(record.createdAt)
    || !fingerprint(record.lifecycleFingerprint)
  ) issues.push(issue(
    "pdf-export-lifecycle-facts-invalid",
    "head",
    "lifecycle identity, binding, revision, status, attempt, fingerprint, and time facts must be valid",
  ))

  const contracts = isFlowDocBackendPdfExportRecordV1(record.contracts) ? record.contracts : null
  const expectedContracts = {
    revisionCompareAndSwap: true,
    durableTransitionReplay: true,
    boundedClaims: true,
    boundedAttempts: true,
    deadlineEnforcement: true,
    checkpointCancellation: true,
    rendererExecution: false,
    bytePersistence: false,
    artifactProjection: false,
    backendRoute: false,
    productionBinding: false,
  } as const
  if (contracts == null || !exactKeys(contracts, Object.keys(expectedContracts))
    || Object.entries(expectedContracts).some(([key, expected]) => contracts[key] !== expected)) {
    issues.push(issue("pdf-export-lifecycle-boundary-invalid", "contracts", "lifecycle execution boundaries must remain exact"))
  }

  const claim = record.claim === null ? null : parseClaim(record.claim)
  const cancellation = record.cancellation === null ? null : parseCancellation(record.cancellation)
  const lastRelease = record.lastRelease === null ? null : parseRelease(record.lastRelease)
  const checkpointCheck = record.checkpointCheck === null ? null : parseCheckpointCheck(record.checkpointCheck)
  const stop = record.stop === null ? null : parseStop(record.stop)
  if (record.claim !== null && claim == null) issues.push(issue("pdf-export-lifecycle-claim-invalid", "claim", "claim must be bounded and exact"))
  if (record.cancellation !== null && cancellation == null) issues.push(issue("pdf-export-lifecycle-cancellation-invalid", "cancellation", "cancellation must be exact"))
  if (record.lastRelease !== null && lastRelease == null) issues.push(issue("pdf-export-lifecycle-release-invalid", "lastRelease", "release receipt must be exact"))
  if (record.checkpointCheck !== null && checkpointCheck == null) issues.push(issue("pdf-export-lifecycle-checkpoint-check-invalid", "checkpointCheck", "checkpoint check must be exact"))
  if (record.stop !== null && stop == null) issues.push(issue("pdf-export-lifecycle-stop-invalid", "stop", "stop receipt must be exact"))

  const status = String(record.status)
  if (
    (status === "pending" && (claim != null || checkpointCheck != null || stop != null))
    || (status === "claimed" && (claim == null || stop != null || record.retryAfter !== null))
    || (status === "stopped" && (claim != null || checkpointCheck != null || stop == null || record.retryAfter !== null))
  ) issues.push(issue("pdf-export-lifecycle-state-invalid", "status", "status must match claim, retry, and stop facts"))
  if (claim != null && (
    claim.attemptNumber !== record.attemptCount
    || Date.parse(claim.claimedAt) < Date.parse(record.createdAt as string)
    || Date.parse(claim.claimedAt) > Date.parse(record.updatedAt as string)
    || Date.parse(claim.expiresAt) > Date.parse(record.deadlineAt as string)
  )) issues.push(issue("pdf-export-lifecycle-claim-binding-invalid", "claim", "claim must own the current attempt and fit the lifecycle window"))
  if (cancellation != null && (
    Date.parse(cancellation.requestedAt) < Date.parse(record.createdAt as string)
    || Date.parse(cancellation.requestedAt) > Date.parse(record.updatedAt as string)
  )) issues.push(issue("pdf-export-lifecycle-cancellation-time-invalid", "cancellation.requestedAt", "cancellation must fit retained lifecycle time"))
  if (lastRelease != null && (
    lastRelease.attemptNumber > (record.attemptCount as number)
    || Date.parse(lastRelease.releasedAt) > Date.parse(record.updatedAt as string)
    || (lastRelease.retryAfter != null && Date.parse(lastRelease.retryAfter) < Date.parse(lastRelease.releasedAt))
    || (lastRelease.retryAfter != null && Date.parse(lastRelease.retryAfter) >= Date.parse(record.deadlineAt as string))
  )) issues.push(issue("pdf-export-lifecycle-release-binding-invalid", "lastRelease", "release must fit the retained attempt and deadline"))
  if (checkpointCheck != null && (
    claim == null
    || checkpointCheck.checkpoint !== record.checkpoint
    || checkpointCheck.claimToken !== claim.claimToken
    || checkpointCheck.checkedAt !== record.updatedAt
  )) issues.push(issue("pdf-export-lifecycle-checkpoint-check-binding-invalid", "checkpointCheck", "checkpoint check must own the exact live claim, checkpoint, and head update"))
  if (stop != null && (
    stop.checkpoint !== record.checkpoint
    || stop.stoppedAt !== record.updatedAt
    || (stop.reason.startsWith("cancelled-") && stop.reason !== cancellationReason(stop.checkpoint))
    || (stop.reason.startsWith("cancelled-") && cancellation == null)
  )) issues.push(issue("pdf-export-lifecycle-stop-binding-invalid", "stop", "stop must match the current checkpoint, cancellation, and update time"))
  const { lifecycleFingerprint: _fingerprint, ...facts } = record
  if (fingerprint(record.lifecycleFingerprint)
    && flowDocBackendPdfExportFingerprintV1(facts) !== record.lifecycleFingerprint) {
    issues.push(issue("pdf-export-lifecycle-fingerprint-mismatch", "lifecycleFingerprint", "lifecycle fingerprint must match exact head facts"))
  }
  if (issues.length > 0) return { status: "blocked", head: null, issues }
  return {
    status: "ready",
    head: cloneFlowDocBackendPdfExportJsonV1(value as unknown as FlowDocBackendPdfExportLifecycleHeadV1),
    issues: [],
  }
}

export function createFlowDocBackendPdfExportLifecycleHeadV1(
  operationValue: unknown,
): FlowDocBackendPdfExportLifecycleHeadResultV1 {
  const parsedOperation = parseFlowDocBackendPdfExportOperationV1(operationValue)
  if (parsedOperation.status === "blocked") return { status: "blocked", head: null, issues: parsedOperation.issues }
  const operation = parsedOperation.operation
  const deadlineAt = new Date(
    Date.parse(operation.acceptedAt) + operation.admission.lifecycle.executionDeadlineMs,
  ).toISOString()
  const facts: LifecycleHeadFactsV1 = {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_HEAD_V1_SOURCE,
    contractVersion: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION,
    kind: "pdf-export-lifecycle-head",
    operationId: operation.operationId,
    scope: cloneFlowDocBackendPdfExportJsonV1(operation.scope),
    operationFingerprint: operation.operationFingerprint,
    admissionFingerprint: operation.admission.admissionFingerprint,
    payloadFingerprint: operation.idempotency.payloadFingerprint,
    headRevision: 0,
    status: "pending",
    checkpoint: "before-handoff",
    attemptCount: 0,
    maxAttempts: operation.admission.lifecycle.maxAttempts,
    retryAfter: null,
    claim: null,
    cancellation: null,
    lastRelease: null,
    checkpointCheck: null,
    stop: null,
    createdAt: operation.acceptedAt,
    updatedAt: operation.acceptedAt,
    deadlineAt,
    contracts: {
      revisionCompareAndSwap: true,
      durableTransitionReplay: true,
      boundedClaims: true,
      boundedAttempts: true,
      deadlineEnforcement: true,
      checkpointCancellation: true,
      rendererExecution: false,
      bytePersistence: false,
      artifactProjection: false,
      backendRoute: false,
      productionBinding: false,
    },
  }
  return { status: "ready", head: finalizeHead(facts), issues: [] }
}

function normalizeBase(
  value: Record<string, unknown>,
  keys: readonly string[],
  issues: FlowDocBackendPdfExportOperationIssueV1[],
): FlowDocBackendPdfExportLifecycleTransitionBaseV1 | null {
  if (!exactKeys(value, keys)) issues.push(issue(
    "pdf-export-lifecycle-transition-shape-invalid",
    "transition",
    "transition request must contain only fields for its exact kind",
  ))
  const identityFields = ["transitionId", "tenantId", "principalId", "operationId"] as const
  identityFields.forEach((key) => {
    if (!isFlowDocBackendPdfExportBoundedStringV1(value[key])) issues.push(issue(
      "pdf-export-lifecycle-transition-identity-invalid",
      key,
      `${key} must be a bounded non-empty string`,
    ))
  })
  if (!Number.isInteger(value.expectedHeadRevision) || (value.expectedHeadRevision as number) < 0) issues.push(issue(
    "pdf-export-lifecycle-transition-revision-invalid",
    "expectedHeadRevision",
    "expected head revision must be a non-negative integer",
  ))
  if (!exactIso(value.transitionAt)) issues.push(issue(
    "pdf-export-lifecycle-transition-time-invalid",
    "transitionAt",
    "transition time must be an exact ISO date-time",
  ))
  if (issues.length > 0) return null
  return {
    transitionId: value.transitionId as string,
    tenantId: value.tenantId as string,
    principalId: value.principalId as string,
    operationId: value.operationId as string,
    expectedHeadRevision: value.expectedHeadRevision as number,
    transitionAt: value.transitionAt as string,
  }
}

export function inspectFlowDocBackendPdfExportLifecycleTransitionRequestV1(
  value: unknown,
): FlowDocBackendPdfExportLifecycleTransitionInspectionV1 {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (!isFlowDocBackendPdfExportRecordV1(value) || typeof value.kind !== "string") return {
    status: "blocked",
    request: null,
    requestFingerprint: null,
    issues: [issue("pdf-export-lifecycle-transition-invalid", "transition", "transition request and kind are required")],
  }
  const baseKeys = [
    "transitionId", "tenantId", "principalId", "operationId",
    "expectedHeadRevision", "transitionAt", "kind",
  ]
  let normalized: FlowDocBackendPdfExportLifecycleTransitionRequestV1 | null = null
  if (value.kind === "claim") {
    const base = normalizeBase(value, [...baseKeys, "claimToken", "workerId", "claimExpiresAt"], issues)
    if (!isFlowDocBackendPdfExportBoundedStringV1(value.claimToken)) issues.push(issue("pdf-export-lifecycle-claim-token-invalid", "claimToken", "claim token must be bounded"))
    if (!isFlowDocBackendPdfExportBoundedStringV1(value.workerId)) issues.push(issue("pdf-export-lifecycle-worker-id-invalid", "workerId", "worker id must be bounded"))
    if (!exactIso(value.claimExpiresAt)) issues.push(issue("pdf-export-lifecycle-claim-expiry-invalid", "claimExpiresAt", "claim expiry must be an exact ISO date-time"))
    if (base != null && issues.length === 0) normalized = {
      ...base,
      kind: "claim",
      claimToken: value.claimToken as string,
      workerId: value.workerId as string,
      claimExpiresAt: value.claimExpiresAt as string,
    }
  } else if (value.kind === "request-cancellation" || value.kind === "enforce-deadline" || value.kind === "force-shutdown") {
    const base = normalizeBase(value, baseKeys, issues)
    if (base != null && issues.length === 0) normalized = { ...base, kind: value.kind }
  } else if (value.kind === "pass-checkpoint") {
    const base = normalizeBase(value, [...baseKeys, "claimToken", "nextCheckpoint"], issues)
    if (!isFlowDocBackendPdfExportBoundedStringV1(value.claimToken)) issues.push(issue("pdf-export-lifecycle-claim-token-invalid", "claimToken", "claim token must be bounded"))
    if (!["before-render", "before-persist"].includes(String(value.nextCheckpoint))) issues.push(issue("pdf-export-lifecycle-next-checkpoint-invalid", "nextCheckpoint", "next checkpoint must follow the V1 sequence"))
    if (base != null && issues.length === 0) normalized = {
      ...base,
      kind: "pass-checkpoint",
      claimToken: value.claimToken as string,
      nextCheckpoint: value.nextCheckpoint as "before-render" | "before-persist",
    }
  } else if (value.kind === "release-claim") {
    const base = normalizeBase(value, [...baseKeys, "claimToken", "retryAfter"], issues)
    if (!isFlowDocBackendPdfExportBoundedStringV1(value.claimToken)) issues.push(issue("pdf-export-lifecycle-claim-token-invalid", "claimToken", "claim token must be bounded"))
    if (value.retryAfter !== null && !exactIso(value.retryAfter)) issues.push(issue("pdf-export-lifecycle-retry-time-invalid", "retryAfter", "retry time must be null or an exact ISO date-time"))
    if (base != null && issues.length === 0) normalized = {
      ...base,
      kind: "release-claim",
      claimToken: value.claimToken as string,
      retryAfter: value.retryAfter as string | null,
    }
  } else if (value.kind === "check-checkpoint") {
    const base = normalizeBase(value, [...baseKeys, "claimToken"], issues)
    if (!isFlowDocBackendPdfExportBoundedStringV1(value.claimToken)) issues.push(issue("pdf-export-lifecycle-claim-token-invalid", "claimToken", "claim token must be bounded"))
    if (base != null && issues.length === 0) normalized = {
      ...base,
      kind: "check-checkpoint",
      claimToken: value.claimToken as string,
    }
  } else issues.push(issue("pdf-export-lifecycle-transition-kind-invalid", "kind", "transition kind is not supported by V1"))

  if (normalized == null || issues.length > 0) return {
    status: "blocked",
    request: null,
    requestFingerprint: null,
    issues,
  }
  return {
    status: "ready",
    request: normalized,
    requestFingerprint: flowDocBackendPdfExportFingerprintV1(normalized),
    issues: [],
  }
}

function stopFacts(
  head: FlowDocBackendPdfExportLifecycleHeadV1,
  reason: FlowDocBackendPdfExportLifecycleStopReasonV1,
  stoppedAt: string,
  cancellation = head.cancellation,
): LifecycleHeadFactsV1 {
  const { lifecycleFingerprint: _fingerprint, ...facts } = head
  return {
    ...facts,
    headRevision: head.headRevision + 1,
    status: "stopped",
    retryAfter: null,
    claim: null,
    cancellation,
    checkpointCheck: null,
    stop: { reason, checkpoint: head.checkpoint, stoppedAt },
    updatedAt: stoppedAt,
  }
}

function transitionReceipt(
  request: FlowDocBackendPdfExportLifecycleTransitionRequestV1,
  requestFingerprint: string,
  previous: FlowDocBackendPdfExportLifecycleHeadV1,
  next: FlowDocBackendPdfExportLifecycleHeadV1,
): FlowDocBackendPdfExportLifecycleTransitionReceiptV1 {
  const facts = {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_TRANSITION_V1_SOURCE,
    contractVersion: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION,
    kind: "pdf-export-lifecycle-transition-receipt" as const,
    transitionId: request.transitionId,
    operationId: request.operationId,
    transitionKind: request.kind,
    requestFingerprint,
    fromHeadRevision: previous.headRevision,
    toHeadRevision: next.headRevision,
    resultHeadFingerprint: next.lifecycleFingerprint,
    appliedAt: request.transitionAt,
  }
  return { ...facts, receiptFingerprint: flowDocBackendPdfExportFingerprintV1(facts) }
}

function blocked(
  head: FlowDocBackendPdfExportLifecycleHeadV1 | null,
  code: string,
  path: string,
  message: string,
): FlowDocBackendPdfExportLifecycleApplyResultV1 {
  return { status: "blocked", head, receipt: null, issues: [issue(code, path, message)] }
}

export function applyFlowDocBackendPdfExportLifecycleTransitionV1(input: {
  head: unknown
  request: unknown
}): FlowDocBackendPdfExportLifecycleApplyResultV1 {
  const parsedHead = parseFlowDocBackendPdfExportLifecycleHeadV1(input.head)
  if (parsedHead.status === "blocked") return { status: "blocked", head: null, receipt: null, issues: parsedHead.issues }
  const inspected = inspectFlowDocBackendPdfExportLifecycleTransitionRequestV1(input.request)
  if (inspected.status === "blocked") return { status: "blocked", head: parsedHead.head, receipt: null, issues: inspected.issues }
  const head = parsedHead.head
  const request = inspected.request
  if (request.operationId !== head.operationId) return blocked(head, "pdf-export-lifecycle-operation-mismatch", "operationId", "transition must target the exact lifecycle operation")
  if (request.expectedHeadRevision !== head.headRevision) return blocked(head, "pdf-export-lifecycle-revision-stale", "expectedHeadRevision", "transition expected revision is stale")
  if (Date.parse(request.transitionAt) < Date.parse(head.updatedAt)) return blocked(head, "pdf-export-lifecycle-time-stale", "transitionAt", "transition time cannot precede the current lifecycle update")
  if (head.status === "stopped") return blocked(head, "pdf-export-lifecycle-terminal", "status", "stopped lifecycle cannot accept another transition")

  let facts: LifecycleHeadFactsV1 | null = null
  const transitionMs = Date.parse(request.transitionAt)
  const deadlineMs = Date.parse(head.deadlineAt)
  if (request.kind === "force-shutdown") {
    facts = stopFacts(head, "shutdown-forced", request.transitionAt)
  } else if (request.kind === "enforce-deadline") {
    if (transitionMs < deadlineMs) return blocked(head, "pdf-export-lifecycle-deadline-not-reached", "transitionAt", "deadline enforcement cannot run before the pinned deadline")
    facts = stopFacts(head, "deadline-exceeded", request.transitionAt)
  } else if (request.kind === "request-cancellation") {
    if (head.cancellation != null) return blocked(head, "pdf-export-lifecycle-cancellation-exists", "cancellation", "lifecycle already retains a cancellation request")
    const cancellation = { transitionId: request.transitionId, requestedAt: request.transitionAt }
    if (transitionMs >= deadlineMs) facts = stopFacts(head, "deadline-exceeded", request.transitionAt, cancellation)
    else if (head.status === "pending") facts = stopFacts(head, cancellationReason(head.checkpoint), request.transitionAt, cancellation)
    else {
      const { lifecycleFingerprint: _fingerprint, ...current } = head
      facts = {
        ...current,
        headRevision: head.headRevision + 1,
        cancellation,
        checkpointCheck: null,
        updatedAt: request.transitionAt,
      }
    }
  } else if (request.kind === "claim") {
    if (transitionMs >= deadlineMs) facts = stopFacts(head, "deadline-exceeded", request.transitionAt)
    else if (head.cancellation != null) facts = stopFacts(head, cancellationReason(head.checkpoint), request.transitionAt)
    else if (head.status === "claimed" && transitionMs < Date.parse(head.claim!.expiresAt)) {
      return blocked(head, "pdf-export-lifecycle-claim-busy", "claim", "another unexpired worker claim owns the lifecycle")
    } else if (head.status === "pending" && head.retryAfter != null && transitionMs < Date.parse(head.retryAfter)) {
      return blocked(head, "pdf-export-lifecycle-retry-deferred", "retryAfter", "lifecycle is not eligible for another claim yet")
    } else if (head.attemptCount >= head.maxAttempts) facts = stopFacts(head, "attempts-exhausted", request.transitionAt)
    else if (
      Date.parse(request.claimExpiresAt) <= transitionMs
      || Date.parse(request.claimExpiresAt) > deadlineMs
      || Date.parse(request.claimExpiresAt) - transitionMs > FLOWDOC_BACKEND_PDF_EXPORT_MAX_CLAIM_DURATION_MS
    ) return blocked(head, "pdf-export-lifecycle-claim-window-invalid", "claimExpiresAt", "claim must be positive, bounded, and end no later than the lifecycle deadline")
    else {
      const { lifecycleFingerprint: _fingerprint, ...current } = head
      const attemptNumber = head.attemptCount + 1
      facts = {
        ...current,
        headRevision: head.headRevision + 1,
        status: "claimed",
        checkpoint: head.status === "claimed" ? "before-handoff" : head.checkpoint,
        attemptCount: attemptNumber,
        retryAfter: null,
        claim: {
          claimToken: request.claimToken,
          workerId: request.workerId,
          attemptNumber,
          claimedAt: request.transitionAt,
          expiresAt: request.claimExpiresAt,
        },
        checkpointCheck: null,
        updatedAt: request.transitionAt,
      }
    }
  } else {
    if (head.status !== "claimed" || head.claim == null || head.claim.claimToken !== request.claimToken) {
      return blocked(head, "pdf-export-lifecycle-claim-stale", "claimToken", "transition must own the exact live worker claim")
    }
    if (transitionMs >= Date.parse(head.claim.expiresAt)) return blocked(head, "pdf-export-lifecycle-claim-expired", "transitionAt", "worker claim expired before this transition")
    if (transitionMs >= deadlineMs) facts = stopFacts(head, "deadline-exceeded", request.transitionAt)
    else if (head.cancellation != null) facts = stopFacts(head, cancellationReason(head.checkpoint), request.transitionAt)
    else if (request.kind === "pass-checkpoint") {
      const validNext = (head.checkpoint === "before-handoff" && request.nextCheckpoint === "before-render")
        || (head.checkpoint === "before-render" && request.nextCheckpoint === "before-persist")
      if (!validNext) return blocked(head, "pdf-export-lifecycle-checkpoint-order-invalid", "nextCheckpoint", "checkpoint transitions must follow the exact V1 order")
      const { lifecycleFingerprint: _fingerprint, ...current } = head
      facts = {
        ...current,
        headRevision: head.headRevision + 1,
        checkpoint: request.nextCheckpoint,
        checkpointCheck: null,
        updatedAt: request.transitionAt,
      }
    } else if (request.kind === "release-claim") {
      if (request.retryAfter != null && (
        Date.parse(request.retryAfter) < transitionMs || Date.parse(request.retryAfter) >= deadlineMs
      )) return blocked(head, "pdf-export-lifecycle-retry-window-invalid", "retryAfter", "retry time must be at or after release and before the lifecycle deadline")
      if (head.attemptCount >= head.maxAttempts) facts = {
        ...stopFacts(head, "attempts-exhausted", request.transitionAt),
        lastRelease: {
          claimToken: head.claim.claimToken,
          workerId: head.claim.workerId,
          attemptNumber: head.claim.attemptNumber,
          releasedAt: request.transitionAt,
          retryAfter: request.retryAfter,
        },
      }
      else {
        const { lifecycleFingerprint: _fingerprint, ...current } = head
        facts = {
          ...current,
          headRevision: head.headRevision + 1,
          status: "pending",
          checkpoint: "before-handoff",
          retryAfter: request.retryAfter,
          claim: null,
          checkpointCheck: null,
          lastRelease: {
            claimToken: head.claim.claimToken,
            workerId: head.claim.workerId,
            attemptNumber: head.claim.attemptNumber,
            releasedAt: request.transitionAt,
            retryAfter: request.retryAfter,
          },
          updatedAt: request.transitionAt,
        }
      }
    } else if (request.kind === "check-checkpoint") {
      const { lifecycleFingerprint: _fingerprint, ...current } = head
      facts = {
        ...current,
        headRevision: head.headRevision + 1,
        checkpointCheck: {
          checkpoint: head.checkpoint,
          claimToken: head.claim.claimToken,
          checkedAt: request.transitionAt,
        },
        updatedAt: request.transitionAt,
      }
    }
  }
  if (facts == null) return blocked(head, "pdf-export-lifecycle-transition-unhandled", "kind", "transition did not produce a lifecycle result")
  const next = finalizeHead(facts)
  const parsedNext = parseFlowDocBackendPdfExportLifecycleHeadV1(next)
  if (parsedNext.status === "blocked") return { status: "blocked", head, receipt: null, issues: parsedNext.issues }
  return {
    status: "applied",
    head: parsedNext.head,
    receipt: transitionReceipt(request, inspected.requestFingerprint, head, parsedNext.head),
    issues: [],
  }
}

export function lifecycleOperationMatchesV1(input: {
  operation: FlowDocBackendPdfExportOperationV1
  head: FlowDocBackendPdfExportLifecycleHeadV1
}): boolean {
  return input.operation.operationId === input.head.operationId
    && input.operation.scope.tenantId === input.head.scope.tenantId
    && input.operation.scope.principalId === input.head.scope.principalId
    && input.operation.operationFingerprint === input.head.operationFingerprint
    && input.operation.admission.admissionFingerprint === input.head.admissionFingerprint
    && input.operation.idempotency.payloadFingerprint === input.head.payloadFingerprint
    && input.operation.acceptedAt === input.head.createdAt
    && input.operation.admission.lifecycle.maxAttempts === input.head.maxAttempts
    && Date.parse(input.operation.acceptedAt) + input.operation.admission.lifecycle.executionDeadlineMs
      === Date.parse(input.head.deadlineAt)
}
