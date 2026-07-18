import type { VNextPdfExportProductionStopReasonV1 } from "@flowdoc/vnext-core"
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

export const FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_V1_SOURCE =
  "flowdoc-backend-pdf-export-observability" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_REPOSITORY_V1_SOURCE =
  "flowdoc-backend-pdf-export-observability-repository" as const

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u
const FAILURE_CODE = /^[a-z0-9][a-z0-9.-]{0,127}$/u
const OUTCOMES = new Set(["progress", "succeeded", "deduplicated", "cancelled", "rejected", "failed"])
const TERMINAL_EVENTS: Record<FlowDocBackendPdfExportWorkflowCompletionV1["terminalStatus"], {
  eventName: FlowDocBackendPdfExportObservabilityEventNameV1
  outcome: FlowDocBackendPdfExportObservabilityEventV1["outcome"]
}> = {
  completed: { eventName: "pdf-export.persist-completed", outcome: "succeeded" },
  cancelled: { eventName: "pdf-export.cancelled", outcome: "cancelled" },
  "deadline-exceeded": { eventName: "pdf-export.deadline-exceeded", outcome: "failed" },
  "resource-rejected": { eventName: "pdf-export.resource-rejected", outcome: "rejected" },
  failed: { eventName: "pdf-export.failed", outcome: "failed" },
}
const STOP_REASONS = new Set<VNextPdfExportProductionStopReasonV1>([
  "completed",
  "cancelled-before-handoff",
  "cancelled-before-render",
  "cancelled-before-persist",
  "deadline-exceeded",
  "resource-limit-exceeded",
  "source-revision-drift",
  "idempotency-conflict",
  "renderer-blocked",
  "storage-failed",
  "shutdown-drain-complete",
  "shutdown-forced",
])

export const FLOWDOC_BACKEND_PDF_EXPORT_REQUIRED_EVENT_NAMES_V1 = [
  "pdf-export.accepted",
  "pdf-export.deduplicated",
  "pdf-export.render-started",
  "pdf-export.render-completed",
  "pdf-export.persist-started",
  "pdf-export.persist-completed",
  "pdf-export.cancelled",
  "pdf-export.deadline-exceeded",
  "pdf-export.resource-rejected",
  "pdf-export.failed",
] as const

export type FlowDocBackendPdfExportObservabilityEventNameV1 =
  typeof FLOWDOC_BACKEND_PDF_EXPORT_REQUIRED_EVENT_NAMES_V1[number]

export interface FlowDocBackendPdfExportObservabilityDimensionsV1 {
  exportRequestId: string
  artifactId: string
  documentId: string
  documentRevision: number
  requestFingerprint: string
  sourceContractFingerprint: string
  rendererProfileId: string
  measurementProfileId: string
  attempt: number
  stopReason: VNextPdfExportProductionStopReasonV1 | null
  pageCount: number | null
  byteLength: number | null
  durationMs: number
}

export interface FlowDocBackendPdfExportObservabilityEventV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-observability-event"
  eventId: string
  operationId: string
  sequence: number
  previousEventFingerprint: string | null
  eventName: FlowDocBackendPdfExportObservabilityEventNameV1
  outcome: "progress" | "succeeded" | "deduplicated" | "cancelled" | "rejected" | "failed"
  occurredAt: string
  scopeFingerprint: string
  dimensions: FlowDocBackendPdfExportObservabilityDimensionsV1
  failureCode: string | null
  privacy: {
    sourceTextIncluded: false
    pdfBytesIncluded: false
    freeformMessageIncluded: false
    rawPrincipalIncluded: false
    rawTenantIncluded: false
  }
  contracts: {
    closedSchema: true
    allCoreDimensionsPresent: true
    appendOnly: true
    durableDeliveryRequired: true
    backendRoute: false
    authzExecution: false
    productionBinding: false
  }
  eventFingerprint: string
}

export interface FlowDocBackendPdfExportWorkflowCompletionV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-workflow-completion"
  workflowId: string
  operationId: string
  scope: {
    tenantId: string
    principalId: string
  }
  scopeFingerprint: string
  operationFingerprint: string
  terminalStatus: "completed" | "cancelled" | "deadline-exceeded" | "resource-rejected" | "failed"
  stopReason: VNextPdfExportProductionStopReasonV1
  persistenceReceiptFingerprint: string | null
  lifecycleFingerprint: string
  eventCount: number
  firstEventFingerprint: string
  lastEventFingerprint: string
  completedAt: string
  contracts: {
    terminalOperationOwner: true
    atomicWithEventBatch: true
    terminalReplayRetained: true
    lifecycleTraceSuperseded: true
    sourceTextIncluded: false
    pdfBytesIncluded: false
    backendRoute: false
    authzExecution: false
    productionBinding: false
  }
  completionFingerprint: string
}

export interface FlowDocBackendPdfExportObservabilityEventCreateInputV1 {
  eventId: string
  operationId: string
  sequence: number
  previousEventFingerprint: string | null
  eventName: FlowDocBackendPdfExportObservabilityEventNameV1
  outcome: FlowDocBackendPdfExportObservabilityEventV1["outcome"]
  occurredAt: string
  scopeFingerprint: string
  dimensions: FlowDocBackendPdfExportObservabilityDimensionsV1
  failureCode: string | null
}

export type FlowDocBackendPdfExportObservabilityEventResultV1 =
  | { status: "ready"; event: FlowDocBackendPdfExportObservabilityEventV1; issues: [] }
  | { status: "blocked"; event: null; issues: FlowDocBackendPdfExportOperationIssueV1[] }

export interface FlowDocBackendPdfExportWorkflowCommitRequestV1 {
  workflowId: string
  operation: FlowDocBackendPdfExportOperationV1
  terminalStatus: FlowDocBackendPdfExportWorkflowCompletionV1["terminalStatus"]
  stopReason: VNextPdfExportProductionStopReasonV1
  persistenceReceiptFingerprint: string | null
  lifecycleFingerprint: string
  completedAt: string
  expectedEventCount: 0
  expectedPreviousEventFingerprint: null
  events: FlowDocBackendPdfExportObservabilityEventV1[]
  requestFingerprint: string
}

export type FlowDocBackendPdfExportWorkflowCommitResultV1 =
  | {
      status: "committed" | "idempotent-replay"
      completion: FlowDocBackendPdfExportWorkflowCompletionV1
      events: FlowDocBackendPdfExportObservabilityEventV1[]
      issues: []
    }
  | {
      status: "conflict" | "invalid" | "storage-unavailable"
      completion: FlowDocBackendPdfExportWorkflowCompletionV1 | null
      events: FlowDocBackendPdfExportObservabilityEventV1[]
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportWorkflowReadResultV1 =
  | {
      status: "found"
      completion: FlowDocBackendPdfExportWorkflowCompletionV1
      events: FlowDocBackendPdfExportObservabilityEventV1[]
      issues: []
    }
  | { status: "not-found"; completion: null; events: []; issues: [] }
  | {
      status: "invalid" | "storage-unavailable"
      completion: null
      events: []
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportObservabilityRepositoryV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_REPOSITORY_V1_SOURCE
  commitTerminalWorkflow(
    request: FlowDocBackendPdfExportWorkflowCommitRequestV1,
  ): Promise<FlowDocBackendPdfExportWorkflowCommitResultV1>
  readTerminalWorkflow(input: {
    tenantId: string
    principalId: string
    operationId: string
  }): Promise<FlowDocBackendPdfExportWorkflowReadResultV1>
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT.test(value)
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function validPositiveIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|")
}

function eventFacts(event: FlowDocBackendPdfExportObservabilityEventV1) {
  const { eventFingerprint: _fingerprint, ...facts } = event
  return facts
}

export function flowDocBackendPdfExportScopeFingerprintV1(scope: {
  tenantId: string
  principalId: string
}): string {
  return flowDocBackendPdfExportFingerprintV1({ tenantId: scope.tenantId, principalId: scope.principalId })
}

export function createFlowDocBackendPdfExportObservabilityEventV1(
  input: FlowDocBackendPdfExportObservabilityEventCreateInputV1,
): FlowDocBackendPdfExportObservabilityEventResultV1 {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  const eventNames = new Set<string>(FLOWDOC_BACKEND_PDF_EXPORT_REQUIRED_EVENT_NAMES_V1)
  const ids: Array<[string, unknown]> = [
    ["eventId", input.eventId],
    ["operationId", input.operationId],
    ["dimensions.exportRequestId", input.dimensions.exportRequestId],
    ["dimensions.artifactId", input.dimensions.artifactId],
    ["dimensions.documentId", input.dimensions.documentId],
    ["dimensions.rendererProfileId", input.dimensions.rendererProfileId],
    ["dimensions.measurementProfileId", input.dimensions.measurementProfileId],
  ]
  ids.forEach(([path, value]) => {
    if (!isFlowDocBackendPdfExportBoundedStringV1(value)) issues.push(issue(
      "pdf-export-observability-identity-invalid", path, `${path} must be a bounded identity`,
    ))
  })
  if (!validNonNegativeInteger(input.sequence)) issues.push(issue("pdf-export-observability-sequence-invalid", "sequence", "event sequence must be a non-negative integer"))
  if (input.sequence === 0 ? input.previousEventFingerprint !== null : !validFingerprint(input.previousEventFingerprint)) issues.push(issue(
    "pdf-export-observability-previous-fingerprint-invalid",
    "previousEventFingerprint",
    "event zero requires null and later events require the previous event fingerprint",
  ))
  if (!eventNames.has(input.eventName)) issues.push(issue("pdf-export-observability-event-name-invalid", "eventName", "event name must be in the Core-required vocabulary"))
  if (!OUTCOMES.has(input.outcome)) issues.push(issue("pdf-export-observability-outcome-invalid", "outcome", "event outcome must use the closed V-F vocabulary"))
  if (!exactIso(input.occurredAt)) issues.push(issue("pdf-export-observability-time-invalid", "occurredAt", "event time must be exact ISO"))
  if (!validFingerprint(input.scopeFingerprint)) issues.push(issue("pdf-export-observability-scope-fingerprint-invalid", "scopeFingerprint", "event scope must be a compact fingerprint"))
  if (!validFingerprint(input.dimensions.requestFingerprint) || !validFingerprint(input.dimensions.sourceContractFingerprint)) issues.push(issue(
    "pdf-export-observability-contract-fingerprint-invalid",
    "dimensions",
    "request and source-contract dimensions must be compact fingerprints",
  ))
  if (
    !validNonNegativeInteger(input.dimensions.documentRevision)
    || !validNonNegativeInteger(input.dimensions.attempt)
    || !validPositiveIntegerOrNull(input.dimensions.pageCount)
    || !validPositiveIntegerOrNull(input.dimensions.byteLength)
    || !validNonNegativeInteger(input.dimensions.durationMs)
  ) issues.push(issue("pdf-export-observability-numeric-dimension-invalid", "dimensions", "revision, attempt, count, byte, and duration dimensions must be bounded numeric facts"))
  if (input.dimensions.stopReason !== null && !STOP_REASONS.has(input.dimensions.stopReason)) issues.push(issue(
    "pdf-export-observability-stop-reason-invalid", "dimensions.stopReason", "stop reason must use the Core production vocabulary",
  ))
  if (input.failureCode !== null && !FAILURE_CODE.test(input.failureCode)) issues.push(issue(
    "pdf-export-observability-failure-code-invalid", "failureCode", "failure code must be a lowercase bounded token without free-form text",
  ))
  if (issues.length > 0) return { status: "blocked", event: null, issues }
  const facts = {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_V1_SOURCE,
    contractVersion: 1 as const,
    kind: "pdf-export-observability-event" as const,
    eventId: input.eventId,
    operationId: input.operationId,
    sequence: input.sequence,
    previousEventFingerprint: input.previousEventFingerprint,
    eventName: input.eventName,
    outcome: input.outcome,
    occurredAt: input.occurredAt,
    scopeFingerprint: input.scopeFingerprint,
    dimensions: {
      exportRequestId: input.dimensions.exportRequestId,
      artifactId: input.dimensions.artifactId,
      documentId: input.dimensions.documentId,
      documentRevision: input.dimensions.documentRevision,
      requestFingerprint: input.dimensions.requestFingerprint,
      sourceContractFingerprint: input.dimensions.sourceContractFingerprint,
      rendererProfileId: input.dimensions.rendererProfileId,
      measurementProfileId: input.dimensions.measurementProfileId,
      attempt: input.dimensions.attempt,
      stopReason: input.dimensions.stopReason,
      pageCount: input.dimensions.pageCount,
      byteLength: input.dimensions.byteLength,
      durationMs: input.dimensions.durationMs,
    },
    failureCode: input.failureCode,
    privacy: {
      sourceTextIncluded: false as const,
      pdfBytesIncluded: false as const,
      freeformMessageIncluded: false as const,
      rawPrincipalIncluded: false as const,
      rawTenantIncluded: false as const,
    },
    contracts: {
      closedSchema: true as const,
      allCoreDimensionsPresent: true as const,
      appendOnly: true as const,
      durableDeliveryRequired: true as const,
      backendRoute: false as const,
      authzExecution: false as const,
      productionBinding: false as const,
    },
  }
  return {
    status: "ready",
    event: { ...facts, eventFingerprint: flowDocBackendPdfExportFingerprintV1(facts) },
    issues: [],
  }
}

export function parseFlowDocBackendPdfExportObservabilityEventV1(
  value: unknown,
): FlowDocBackendPdfExportObservabilityEventResultV1 {
  if (!isFlowDocBackendPdfExportRecordV1(value)) return {
    status: "blocked",
    event: null,
    issues: [issue("pdf-export-observability-event-invalid", "event", "event must be an object")],
  }
  const exactRoot = [
    "source", "contractVersion", "kind", "eventId", "operationId", "sequence",
    "previousEventFingerprint", "eventName", "outcome", "occurredAt", "scopeFingerprint",
    "dimensions", "failureCode", "privacy", "contracts", "eventFingerprint",
  ]
  if (!exactKeys(value, exactRoot)) return {
    status: "blocked",
    event: null,
    issues: [issue("pdf-export-observability-event-schema-open", "event", "observability events reject unknown, missing, byte, text, and message fields")],
  }
  const candidate = value as unknown as FlowDocBackendPdfExportObservabilityEventV1
  const exactDimensions = [
    "exportRequestId", "artifactId", "documentId", "documentRevision",
    "requestFingerprint", "sourceContractFingerprint", "rendererProfileId",
    "measurementProfileId", "attempt", "stopReason", "pageCount", "byteLength", "durationMs",
  ]
  if (
    !isFlowDocBackendPdfExportRecordV1(candidate.dimensions)
    || !exactKeys(candidate.dimensions, exactDimensions)
    || JSON.stringify(candidate.privacy) !== JSON.stringify({
      sourceTextIncluded: false,
      pdfBytesIncluded: false,
      freeformMessageIncluded: false,
      rawPrincipalIncluded: false,
      rawTenantIncluded: false,
    })
    || JSON.stringify(candidate.contracts) !== JSON.stringify({
      closedSchema: true,
      allCoreDimensionsPresent: true,
      appendOnly: true,
      durableDeliveryRequired: true,
      backendRoute: false,
      authzExecution: false,
      productionBinding: false,
    })
  ) return {
    status: "blocked",
    event: null,
    issues: [issue("pdf-export-observability-event-nested-schema-invalid", "event", "dimensions, privacy, and contracts must be exact closed records")],
  }
  const recreated = createFlowDocBackendPdfExportObservabilityEventV1(candidate)
  if (recreated.status === "blocked") return recreated
  if (
    JSON.stringify(eventFacts(recreated.event)) !== JSON.stringify(eventFacts(candidate))
    || recreated.event.eventFingerprint !== candidate.eventFingerprint
  ) return {
    status: "blocked",
    event: null,
    issues: [issue("pdf-export-observability-event-fingerprint-invalid", "eventFingerprint", "event fingerprint must bind the exact closed-schema facts")],
  }
  return { status: "ready", event: cloneFlowDocBackendPdfExportJsonV1(candidate), issues: [] }
}

export function calculateFlowDocBackendPdfExportWorkflowRequestFingerprintV1(
  request: Omit<FlowDocBackendPdfExportWorkflowCommitRequestV1, "requestFingerprint">,
): string {
  return flowDocBackendPdfExportFingerprintV1(request)
}

function createCompletion(request: FlowDocBackendPdfExportWorkflowCommitRequestV1): FlowDocBackendPdfExportWorkflowCompletionV1 {
  const first = request.events[0]!
  const last = request.events.at(-1)!
  const facts = {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_V1_SOURCE,
    contractVersion: 1 as const,
    kind: "pdf-export-workflow-completion" as const,
    workflowId: request.workflowId,
    operationId: request.operation.operationId,
    scope: cloneFlowDocBackendPdfExportJsonV1(request.operation.scope),
    scopeFingerprint: flowDocBackendPdfExportScopeFingerprintV1(request.operation.scope),
    operationFingerprint: request.operation.operationFingerprint,
    terminalStatus: request.terminalStatus,
    stopReason: request.stopReason,
    persistenceReceiptFingerprint: request.persistenceReceiptFingerprint,
    lifecycleFingerprint: request.lifecycleFingerprint,
    eventCount: request.events.length,
    firstEventFingerprint: first.eventFingerprint,
    lastEventFingerprint: last.eventFingerprint,
    completedAt: request.completedAt,
    contracts: {
      terminalOperationOwner: true as const,
      atomicWithEventBatch: true as const,
      terminalReplayRetained: true as const,
      lifecycleTraceSuperseded: true as const,
      sourceTextIncluded: false as const,
      pdfBytesIncluded: false as const,
      backendRoute: false as const,
      authzExecution: false as const,
      productionBinding: false as const,
    },
  }
  return { ...facts, completionFingerprint: flowDocBackendPdfExportFingerprintV1(facts) }
}

export function inspectFlowDocBackendPdfExportWorkflowCommitRequestV1(
  request: FlowDocBackendPdfExportWorkflowCommitRequestV1,
): { status: "ready"; completion: FlowDocBackendPdfExportWorkflowCompletionV1; issues: [] }
  | { status: "blocked"; completion: null; issues: FlowDocBackendPdfExportOperationIssueV1[] } {
  const parsedOperation = parseFlowDocBackendPdfExportOperationV1(request.operation)
  if (parsedOperation.status === "blocked") return { status: "blocked", completion: null, issues: parsedOperation.issues }
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (!isFlowDocBackendPdfExportBoundedStringV1(request.workflowId)) issues.push(issue("pdf-export-workflow-id-invalid", "workflowId", "workflow id must be bounded"))
  if (!validFingerprint(request.lifecycleFingerprint)) issues.push(issue("pdf-export-workflow-lifecycle-fingerprint-invalid", "lifecycleFingerprint", "workflow completion requires a lifecycle fingerprint"))
  if (request.persistenceReceiptFingerprint !== null && !validFingerprint(request.persistenceReceiptFingerprint)) issues.push(issue("pdf-export-workflow-persistence-fingerprint-invalid", "persistenceReceiptFingerprint", "persistence receipt fingerprint must be null or compact"))
  if (!exactIso(request.completedAt)) issues.push(issue("pdf-export-workflow-completed-time-invalid", "completedAt", "workflow completion time must be exact ISO"))
  if (request.expectedEventCount !== 0 || request.expectedPreviousEventFingerprint !== null) issues.push(issue("pdf-export-workflow-event-cas-invalid", "expectedEventCount", "V-F commits one terminal event batch from an absent stream"))
  if (request.events.length === 0 || request.events.length > 32) issues.push(issue("pdf-export-workflow-event-count-invalid", "events", "terminal event batch must contain between 1 and 32 events"))
  let previous: string | null = null
  let previousTime = Number.NEGATIVE_INFINITY
  const eventIds = new Set<string>()
  const admission = parsedOperation.operation.admission.exportIdentity
  const source = admission.sourceIdentity
  request.events.forEach((event, index) => {
    const parsed = parseFlowDocBackendPdfExportObservabilityEventV1(event)
    if (parsed.status === "blocked") issues.push(...parsed.issues)
    else if (
      event.operationId !== request.operation.operationId
      || event.scopeFingerprint !== flowDocBackendPdfExportScopeFingerprintV1(request.operation.scope)
      || event.sequence !== index
      || event.previousEventFingerprint !== previous
    ) issues.push(issue("pdf-export-workflow-event-chain-invalid", `events[${index}]`, "events must form one exact operation-scoped fingerprint chain"))
    if (eventIds.has(event.eventId)) issues.push(issue("pdf-export-workflow-event-id-duplicate", `events[${index}].eventId`, "event ids must be unique within the terminal batch"))
    eventIds.add(event.eventId)
    const occurredAt = Date.parse(event.occurredAt)
    if (occurredAt < previousTime) issues.push(issue("pdf-export-workflow-event-time-order-invalid", `events[${index}].occurredAt`, "event times must be monotonic"))
    previousTime = occurredAt
    if (
      event.dimensions.exportRequestId !== admission.exportRequestId
      || event.dimensions.artifactId !== admission.artifactId
      || event.dimensions.documentId !== source.documentId
      || event.dimensions.documentRevision !== source.documentRevision
      || event.dimensions.requestFingerprint !== admission.requestFingerprint
      || event.dimensions.sourceContractFingerprint !== admission.sourceContractFingerprint
      || event.dimensions.rendererProfileId !== admission.rendererProfileId
      || event.dimensions.measurementProfileId !== admission.measurementProfileId
    ) issues.push(issue("pdf-export-workflow-event-dimension-binding-invalid", `events[${index}].dimensions`, "event identity dimensions must match the exact admitted operation"))
    previous = event.eventFingerprint
  })
  const first = request.events[0]
  const last = request.events.at(-1)
  const terminal = TERMINAL_EVENTS[request.terminalStatus]
  if (first?.eventName !== "pdf-export.accepted" || first.outcome !== "progress") issues.push(issue(
    "pdf-export-workflow-first-event-invalid", "events[0]", "terminal event chains must begin with accepted progress",
  ))
  if (last == null || terminal == null || last.eventName !== terminal.eventName || last.outcome !== terminal.outcome || last.dimensions.stopReason !== request.stopReason) issues.push(issue(
    "pdf-export-workflow-terminal-event-invalid", "events", "last event name, outcome, and stop reason must match terminal workflow status",
  ))
  if (last != null && Date.parse(request.completedAt) < Date.parse(last.occurredAt)) issues.push(issue(
    "pdf-export-workflow-completion-time-order-invalid", "completedAt", "workflow completion cannot precede its terminal event",
  ))
  const { requestFingerprint: _fingerprint, ...facts } = request
  if (calculateFlowDocBackendPdfExportWorkflowRequestFingerprintV1(facts) !== request.requestFingerprint) issues.push(issue(
    "pdf-export-workflow-request-fingerprint-invalid", "requestFingerprint", "workflow request fingerprint must bind the exact terminal batch",
  ))
  if (request.terminalStatus === "completed" && (request.stopReason !== "completed" || request.persistenceReceiptFingerprint == null)) issues.push(issue(
    "pdf-export-workflow-completed-binding-invalid", "terminalStatus", "completed workflow requires completed stop reason and persistence receipt",
  ))
  if (request.terminalStatus !== "completed" && request.persistenceReceiptFingerprint !== null) issues.push(issue(
    "pdf-export-workflow-terminal-persistence-invalid", "persistenceReceiptFingerprint", "non-completed workflow cannot own a persistence receipt",
  ))
  return issues.length === 0
    ? { status: "ready", completion: createCompletion(request), issues: [] }
    : { status: "blocked", completion: null, issues }
}

export function parseFlowDocBackendPdfExportWorkflowCompletionV1(
  value: unknown,
): { status: "ready"; completion: FlowDocBackendPdfExportWorkflowCompletionV1; issues: [] }
  | { status: "blocked"; completion: null; issues: FlowDocBackendPdfExportOperationIssueV1[] } {
  if (!isFlowDocBackendPdfExportRecordV1(value)) return {
    status: "blocked",
    completion: null,
    issues: [issue("pdf-export-workflow-completion-invalid", "completion", "workflow completion must be an object")],
  }
  const exactRoot = [
    "source", "contractVersion", "kind", "workflowId", "operationId", "scope",
    "scopeFingerprint", "operationFingerprint", "terminalStatus", "stopReason",
    "persistenceReceiptFingerprint", "lifecycleFingerprint", "eventCount",
    "firstEventFingerprint", "lastEventFingerprint", "completedAt", "contracts",
    "completionFingerprint",
  ]
  if (!exactKeys(value, exactRoot)) return {
    status: "blocked",
    completion: null,
    issues: [issue("pdf-export-workflow-completion-schema-open", "completion", "workflow completion rejects unknown, missing, byte, text, and message fields")],
  }
  const completion = value as unknown as FlowDocBackendPdfExportWorkflowCompletionV1
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (
    completion.source !== FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_V1_SOURCE
    || completion.contractVersion !== 1
    || completion.kind !== "pdf-export-workflow-completion"
    || !isFlowDocBackendPdfExportBoundedStringV1(completion.workflowId)
    || !isFlowDocBackendPdfExportBoundedStringV1(completion.operationId)
    || !validFingerprint(completion.scopeFingerprint)
    || !validFingerprint(completion.operationFingerprint)
    || !validFingerprint(completion.lifecycleFingerprint)
    || !validPositiveInteger(completion.eventCount)
    || !validFingerprint(completion.firstEventFingerprint)
    || !validFingerprint(completion.lastEventFingerprint)
    || !exactIso(completion.completedAt)
  ) issues.push(issue("pdf-export-workflow-completion-shape-invalid", "completion", "workflow completion identity, event, and time facts must be exact"))
  if (
    !["completed", "cancelled", "deadline-exceeded", "resource-rejected", "failed"].includes(completion.terminalStatus)
    || !STOP_REASONS.has(completion.stopReason)
    || (completion.persistenceReceiptFingerprint !== null && !validFingerprint(completion.persistenceReceiptFingerprint))
  ) issues.push(issue("pdf-export-workflow-completion-terminal-invalid", "terminalStatus", "workflow terminal status, stop reason, and persistence identity must be valid"))
  if (
    !isFlowDocBackendPdfExportRecordV1(completion.scope)
    || !exactKeys(completion.scope, ["tenantId", "principalId"])
    || !isFlowDocBackendPdfExportBoundedStringV1(completion.scope.tenantId)
    || !isFlowDocBackendPdfExportBoundedStringV1(completion.scope.principalId)
    || flowDocBackendPdfExportScopeFingerprintV1(completion.scope) !== completion.scopeFingerprint
  ) issues.push(issue("pdf-export-workflow-completion-scope-invalid", "scope", "workflow scope and privacy fingerprint must match"))
  const expectedContracts = {
    terminalOperationOwner: true,
    atomicWithEventBatch: true,
    terminalReplayRetained: true,
    lifecycleTraceSuperseded: true,
    sourceTextIncluded: false,
    pdfBytesIncluded: false,
    backendRoute: false,
    authzExecution: false,
    productionBinding: false,
  }
  if (
    !isFlowDocBackendPdfExportRecordV1(completion.contracts)
    || !exactKeys(completion.contracts, Object.keys(expectedContracts))
    || Object.entries(expectedContracts).some(([key, expected]) => completion.contracts[key as keyof typeof completion.contracts] !== expected)
  ) issues.push(issue("pdf-export-workflow-completion-contracts-invalid", "contracts", "workflow completion contracts must be the exact closed V-F boundary"))
  if (completion.terminalStatus === "completed" && (completion.stopReason !== "completed" || completion.persistenceReceiptFingerprint == null)) issues.push(issue(
    "pdf-export-workflow-completion-binding-invalid", "terminalStatus", "completed workflow requires completed stop reason and persistence receipt",
  ))
  if (completion.terminalStatus !== "completed" && completion.persistenceReceiptFingerprint !== null) issues.push(issue(
    "pdf-export-workflow-completion-persistence-invalid", "persistenceReceiptFingerprint", "non-completed workflow cannot own a persistence receipt",
  ))
  const { completionFingerprint: _fingerprint, ...facts } = completion
  if (flowDocBackendPdfExportFingerprintV1(facts) !== completion.completionFingerprint) issues.push(issue(
    "pdf-export-workflow-completion-fingerprint-invalid", "completionFingerprint", "workflow completion fingerprint must bind exact facts",
  ))
  return issues.length === 0
    ? { status: "ready", completion: cloneFlowDocBackendPdfExportJsonV1(completion), issues: [] }
    : { status: "blocked", completion: null, issues }
}

function workflowConflict(message: string, completion: FlowDocBackendPdfExportWorkflowCompletionV1 | null = null): FlowDocBackendPdfExportWorkflowCommitResultV1 {
  return {
    status: "conflict",
    completion: completion == null ? null : cloneFlowDocBackendPdfExportJsonV1(completion),
    events: [],
    issues: [issue("pdf-export-workflow-conflict", "workflow", message)],
  }
}

export function createInMemoryFlowDocBackendPdfExportObservabilityRepositoryV1():
FlowDocBackendPdfExportObservabilityRepositoryV1 {
  const completionByOperationId = new Map<string, FlowDocBackendPdfExportWorkflowCompletionV1>()
  const eventsByOperationId = new Map<string, FlowDocBackendPdfExportObservabilityEventV1[]>()
  const operationIdByWorkflowId = new Map<string, string>()
  const operationIdByEventId = new Map<string, string>()
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_REPOSITORY_V1_SOURCE,

    async commitTerminalWorkflow(request) {
      const inspected = inspectFlowDocBackendPdfExportWorkflowCommitRequestV1(request)
      if (inspected.status === "blocked") return { status: "invalid", completion: null, events: [], issues: inspected.issues }
      const workflowOwner = operationIdByWorkflowId.get(request.workflowId)
      if (workflowOwner != null && workflowOwner !== request.operation.operationId) return workflowConflict("workflow id belongs to another operation")
      const existing = completionByOperationId.get(request.operation.operationId)
      if (existing != null) {
        const events = eventsByOperationId.get(request.operation.operationId) ?? []
        if (existing.completionFingerprint === inspected.completion.completionFingerprint) return {
          status: "idempotent-replay",
          completion: cloneFlowDocBackendPdfExportJsonV1(existing),
          events: cloneFlowDocBackendPdfExportJsonV1(events),
          issues: [],
        }
        return workflowConflict("operation already owns another terminal workflow", existing)
      }
      for (const event of request.events) {
        const owner = operationIdByEventId.get(event.eventId)
        if (owner != null && owner !== request.operation.operationId) return workflowConflict("event id belongs to another operation")
      }
      completionByOperationId.set(request.operation.operationId, cloneFlowDocBackendPdfExportJsonV1(inspected.completion))
      eventsByOperationId.set(request.operation.operationId, cloneFlowDocBackendPdfExportJsonV1(request.events))
      operationIdByWorkflowId.set(request.workflowId, request.operation.operationId)
      request.events.forEach((event) => operationIdByEventId.set(event.eventId, request.operation.operationId))
      return {
        status: "committed",
        completion: inspected.completion,
        events: cloneFlowDocBackendPdfExportJsonV1(request.events),
        issues: [],
      }
    },

    async readTerminalWorkflow(input) {
      if (
        !isFlowDocBackendPdfExportBoundedStringV1(input.tenantId)
        || !isFlowDocBackendPdfExportBoundedStringV1(input.principalId)
        || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)
      ) return {
        status: "invalid",
        completion: null,
        events: [],
        issues: [issue("pdf-export-workflow-read-invalid", "operationId", "workflow read scope must be bounded")],
      }
      const completion = completionByOperationId.get(input.operationId)
      if (completion == null || completion.scope.tenantId !== input.tenantId || completion.scope.principalId !== input.principalId) {
        return { status: "not-found", completion: null, events: [], issues: [] }
      }
      return {
        status: "found",
        completion: cloneFlowDocBackendPdfExportJsonV1(completion),
        events: cloneFlowDocBackendPdfExportJsonV1(eventsByOperationId.get(input.operationId) ?? []),
        issues: [],
      }
    },
  }
}
