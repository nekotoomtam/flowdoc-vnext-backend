import type {
  VNextPdfExportRequestV1,
  VNextPdfExportSourceIdentityV1,
  VNextPdfMeasuredDrawContractResultV1,
} from "@flowdoc/vnext-core"
import type { FlowDocBackendPdfExportContentAddressedStoreV1 } from "./pdfExportContentAddressedStore.js"
import type { FlowDocBackendPdfExportLifecycleHeadV1 } from "./pdfExportLifecycle.js"
import type { FlowDocBackendPdfExportLifecycleRepositoryV1 } from "./pdfExportLifecycleRepository.js"
import {
  calculateFlowDocBackendPdfExportWorkflowRequestFingerprintV1,
  createFlowDocBackendPdfExportObservabilityEventV1,
  flowDocBackendPdfExportScopeFingerprintV1,
  type FlowDocBackendPdfExportObservabilityEventNameV1,
  type FlowDocBackendPdfExportObservabilityEventV1,
  type FlowDocBackendPdfExportObservabilityRepositoryV1,
  type FlowDocBackendPdfExportWorkflowCompletionV1,
} from "./pdfExportObservability.js"
import {
  flowDocBackendPdfExportFingerprintV1,
  flowDocBackendPdfExportOperationIssueV1,
  parseFlowDocBackendPdfExportOperationV1,
  type FlowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"
import type { FlowDocBackendPdfExportOperationRepositoryV1 } from "./pdfExportOperationRepository.js"
import {
  parseFlowDocBackendPdfExportArtifactPersistenceReceiptV1,
  persistFlowDocBackendPdfExportArtifactV1,
  type FlowDocBackendPdfExportArtifactPersistenceReceiptV1,
  type FlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
} from "./pdfExportArtifactPersistence.js"
import {
  runFlowDocBackendPdfExportRendererAttemptV1,
  type FlowDocBackendPdfExportRendererV1,
} from "./pdfExportRendererAttempt.js"
import type { FlowDocBackendPdfExportRendererQualificationV1 } from "./pdfExportRendererQualification.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_WORKFLOW_V1_SOURCE =
  "flowdoc-backend-pdf-export-workflow" as const

export type FlowDocBackendPdfExportWorkflowFaultPointV1 =
  | "after-operation-admission"
  | "after-lifecycle-ready"
  | "after-render"
  | "after-persistence"

export interface FlowDocBackendPdfExportWorkflowInputV1 {
  workflowId: string
  operation: unknown
  request: VNextPdfExportRequestV1
  currentSource: VNextPdfExportSourceIdentityV1
  measuredDrawContract: VNextPdfMeasuredDrawContractResultV1
  qualification: FlowDocBackendPdfExportRendererQualificationV1
  renderer: FlowDocBackendPdfExportRendererV1
  operationRepository: FlowDocBackendPdfExportOperationRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilityRepositoryV1
  contentStore: FlowDocBackendPdfExportContentAddressedStoreV1
  worker: {
    workerId: string
    claimToken: string
    claimTransitionId: string
    claimedAt: string
    claimExpiresAt: string
    beforeHandoffTransitionId: string
    beforeHandoffAt: string
  }
  rendererAttempt: {
    renderAttemptId: string
    completionId: string
    beforeRenderTransitionId: string
    beforeRenderExpectedHeadRevision: number
    beforeRenderAt: string
    beforePersistTransitionId: string
    now(): string
  }
  persistence: {
    persistenceId: string
    jobId: string
    layoutProfileId: string
    persistedAt: string
  }
  events: {
    renderStartedAt: string
    renderCompletedAt: string
    persistStartedAt: string
    persistCompletedAt: string
    workflowCompletedAt: string
  }
  faultInjector?: (input: {
    point: FlowDocBackendPdfExportWorkflowFaultPointV1
    operationId: string
  }) => void
}

export type FlowDocBackendPdfExportWorkflowResultV1 =
  | {
      source: typeof FLOWDOC_BACKEND_PDF_EXPORT_WORKFLOW_V1_SOURCE
      status: "completed" | "terminal-replay" | "terminated"
      completion: FlowDocBackendPdfExportWorkflowCompletionV1
      events: FlowDocBackendPdfExportObservabilityEventV1[]
      persistenceReceipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null
      lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1
      execution: {
        operationAdmission: "created" | "idempotent-replay" | "terminal-replay"
        rendererExecuted: boolean
        persistenceExecuted: boolean
      }
      issues: []
      contracts: ReturnType<typeof workflowContracts>
    }
  | {
      source: typeof FLOWDOC_BACKEND_PDF_EXPORT_WORKFLOW_V1_SOURCE
      status: "blocked"
      completion: FlowDocBackendPdfExportWorkflowCompletionV1 | null
      events: FlowDocBackendPdfExportObservabilityEventV1[]
      persistenceReceipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null
      lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1 | null
      execution: {
        operationAdmission: "not-run" | "created" | "idempotent-replay"
        rendererExecuted: boolean
        persistenceExecuted: boolean
      }
      issues: FlowDocBackendPdfExportOperationIssueV1[]
      contracts: ReturnType<typeof workflowContracts>
    }

function workflowContracts() {
  return {
    endToEndCandidate: true as const,
    durableTerminalReplay: true as const,
    checksPersistenceBeforeRenderer: true as const,
    privacySafeObservability: true as const,
    eventBatchAtomicWithCompletion: true as const,
    automaticQueueWorker: false as const,
    backendRoute: false as const,
    authzExecution: false as const,
    concreteProductionRendererSelected: false as const,
    productionStorageProviderSelected: false as const,
    productionBinding: false as const,
  }
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function blocked(input: {
  issues: FlowDocBackendPdfExportOperationIssueV1[]
  completion?: FlowDocBackendPdfExportWorkflowCompletionV1 | null
  events?: FlowDocBackendPdfExportObservabilityEventV1[]
  receipt?: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null
  lifecycleHead?: FlowDocBackendPdfExportLifecycleHeadV1 | null
  admission?: "not-run" | "created" | "idempotent-replay"
  rendererExecuted?: boolean
  persistenceExecuted?: boolean
}): FlowDocBackendPdfExportWorkflowResultV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_WORKFLOW_V1_SOURCE,
    status: "blocked",
    completion: input.completion ?? null,
    events: input.events ?? [],
    persistenceReceipt: input.receipt ?? null,
    lifecycleHead: input.lifecycleHead ?? null,
    execution: {
      operationAdmission: input.admission ?? "not-run",
      rendererExecuted: input.rendererExecuted ?? false,
      persistenceExecuted: input.persistenceExecuted ?? false,
    },
    issues: input.issues,
    contracts: workflowContracts(),
  }
}

function eventId(workflowId: string, eventName: string, sequence: number): string {
  return `event:${flowDocBackendPdfExportFingerprintV1({ workflowId, eventName, sequence })}`
}

function durationMs(operation: FlowDocBackendPdfExportOperationV1, occurredAt: string): number {
  return Math.max(0, Date.parse(occurredAt) - Date.parse(operation.acceptedAt))
}

function createEventChain(input: {
  workflowId: string
  operation: FlowDocBackendPdfExportOperationV1
  lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1
  deduplicated: boolean
  terminal: {
    status: FlowDocBackendPdfExportWorkflowCompletionV1["terminalStatus"]
    stopReason: FlowDocBackendPdfExportWorkflowCompletionV1["stopReason"]
    eventName: FlowDocBackendPdfExportObservabilityEventNameV1
    failureCode: string | null
  }
  rendererStageReached: boolean
  receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null
  times: FlowDocBackendPdfExportWorkflowInputV1["events"]
}): { status: "ready"; events: FlowDocBackendPdfExportObservabilityEventV1[] }
  | { status: "blocked"; issues: FlowDocBackendPdfExportOperationIssueV1[] } {
  const admission = input.operation.admission
  const source = admission.exportIdentity.sourceIdentity
  const pageCount = input.receipt?.core.completion.artifact.pageCount ?? null
  const byteLength = input.receipt?.bytes.byteLength ?? null
  const definitions: Array<{
    eventName: FlowDocBackendPdfExportObservabilityEventNameV1
    outcome: FlowDocBackendPdfExportObservabilityEventV1["outcome"]
    occurredAt: string
    stopReason: FlowDocBackendPdfExportWorkflowCompletionV1["stopReason"] | null
    pageCount: number | null
    byteLength: number | null
    failureCode: string | null
  }> = [{
    eventName: "pdf-export.accepted",
    outcome: "progress",
    occurredAt: input.operation.acceptedAt,
    stopReason: null,
    pageCount: null,
    byteLength: null,
    failureCode: null,
  }]
  if (input.deduplicated) definitions.push({
    eventName: "pdf-export.deduplicated",
    outcome: "deduplicated",
    occurredAt: input.operation.acceptedAt,
    stopReason: null,
    pageCount: null,
    byteLength: null,
    failureCode: null,
  })
  if (input.terminal.status === "completed" || input.rendererStageReached) definitions.push({
      eventName: "pdf-export.render-started",
      outcome: "progress",
      occurredAt: input.times.renderStartedAt,
      stopReason: null,
      pageCount: null,
      byteLength: null,
      failureCode: null,
    })
  if (input.terminal.status === "completed") definitions.push(
    {
      eventName: "pdf-export.render-completed",
      outcome: "progress",
      occurredAt: input.times.renderCompletedAt,
      stopReason: null,
      pageCount,
      byteLength,
      failureCode: null,
    },
    {
      eventName: "pdf-export.persist-started",
      outcome: "progress",
      occurredAt: input.times.persistStartedAt,
      stopReason: null,
      pageCount,
      byteLength,
      failureCode: null,
    },
    {
      eventName: "pdf-export.persist-completed",
      outcome: "succeeded",
      occurredAt: input.times.persistCompletedAt,
      stopReason: "completed",
      pageCount,
      byteLength,
      failureCode: null,
    },
  )
  else definitions.push({
    eventName: input.terminal.eventName,
    outcome: input.terminal.status === "cancelled"
      ? "cancelled"
      : input.terminal.status === "resource-rejected" ? "rejected" : "failed",
    occurredAt: input.times.workflowCompletedAt,
    stopReason: input.terminal.stopReason,
    pageCount,
    byteLength,
    failureCode: input.terminal.failureCode,
  })

  const events: FlowDocBackendPdfExportObservabilityEventV1[] = []
  let previous: string | null = null
  for (const [sequence, definition] of definitions.entries()) {
    const created = createFlowDocBackendPdfExportObservabilityEventV1({
      eventId: eventId(input.workflowId, definition.eventName, sequence),
      operationId: input.operation.operationId,
      sequence,
      previousEventFingerprint: previous,
      eventName: definition.eventName,
      outcome: definition.outcome,
      occurredAt: definition.occurredAt,
      scopeFingerprint: flowDocBackendPdfExportScopeFingerprintV1(input.operation.scope),
      dimensions: {
        exportRequestId: admission.exportIdentity.exportRequestId,
        artifactId: admission.exportIdentity.artifactId,
        documentId: source.documentId,
        documentRevision: source.documentRevision,
        requestFingerprint: admission.exportIdentity.requestFingerprint,
        sourceContractFingerprint: admission.exportIdentity.sourceContractFingerprint,
        rendererProfileId: admission.exportIdentity.rendererProfileId,
        measurementProfileId: admission.exportIdentity.measurementProfileId,
        attempt: input.lifecycleHead.attemptCount,
        stopReason: definition.stopReason,
        pageCount: definition.pageCount,
        byteLength: definition.byteLength,
        durationMs: durationMs(input.operation, definition.occurredAt),
      },
      failureCode: definition.failureCode,
    })
    if (created.status === "blocked") return { status: "blocked", issues: created.issues }
    events.push(created.event)
    previous = created.event.eventFingerprint
  }
  return { status: "ready", events }
}

async function commitTerminal(input: {
  workflowInput: FlowDocBackendPdfExportWorkflowInputV1
  operation: FlowDocBackendPdfExportOperationV1
  lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1
  deduplicated: boolean
  terminalStatus: FlowDocBackendPdfExportWorkflowCompletionV1["terminalStatus"]
  stopReason: FlowDocBackendPdfExportWorkflowCompletionV1["stopReason"]
  terminalEventName: FlowDocBackendPdfExportObservabilityEventNameV1
  failureCode: string | null
  receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null
  rendererStageReached?: boolean
}) {
  const chain = createEventChain({
    workflowId: input.workflowInput.workflowId,
    operation: input.operation,
    lifecycleHead: input.lifecycleHead,
    deduplicated: input.deduplicated,
    terminal: {
      status: input.terminalStatus,
      stopReason: input.stopReason,
      eventName: input.terminalEventName,
      failureCode: input.failureCode,
    },
    receipt: input.receipt,
    rendererStageReached: input.rendererStageReached ?? input.receipt != null,
    times: input.workflowInput.events,
  })
  if (chain.status === "blocked") return { status: "blocked" as const, issues: chain.issues }
  const facts = {
    workflowId: input.workflowInput.workflowId,
    operation: input.operation,
    terminalStatus: input.terminalStatus,
    stopReason: input.stopReason,
    persistenceReceiptFingerprint: input.receipt?.persistenceReceiptFingerprint ?? null,
    lifecycleFingerprint: input.lifecycleHead.lifecycleFingerprint,
    completedAt: input.workflowInput.events.workflowCompletedAt,
    expectedEventCount: 0 as const,
    expectedPreviousEventFingerprint: null,
    events: chain.events,
  }
  const request = {
    ...facts,
    requestFingerprint: calculateFlowDocBackendPdfExportWorkflowRequestFingerprintV1(facts),
  }
  const committed = await input.workflowInput.observabilityRepository.commitTerminalWorkflow(request)
  return committed.status === "committed" || committed.status === "idempotent-replay"
    ? { status: committed.status, completion: committed.completion, events: committed.events, issues: [] as [] }
    : { status: "blocked" as const, issues: committed.issues }
}

function lifecycleFailure(head: FlowDocBackendPdfExportLifecycleHeadV1): {
  terminalStatus: FlowDocBackendPdfExportWorkflowCompletionV1["terminalStatus"]
  stopReason: FlowDocBackendPdfExportWorkflowCompletionV1["stopReason"]
  eventName: FlowDocBackendPdfExportObservabilityEventNameV1
} {
  const reason = head.stop?.reason
  if (reason === "deadline-exceeded") return {
    terminalStatus: "deadline-exceeded",
    stopReason: "deadline-exceeded",
    eventName: "pdf-export.deadline-exceeded",
  }
  if (
    reason === "cancelled-before-handoff"
    || reason === "cancelled-before-render"
    || reason === "cancelled-before-persist"
  ) return {
    terminalStatus: "cancelled",
    stopReason: reason,
    eventName: "pdf-export.cancelled",
  }
  if (reason === "shutdown-forced") return {
    terminalStatus: "failed",
    stopReason: "shutdown-forced",
    eventName: "pdf-export.failed",
  }
  return {
    terminalStatus: "failed",
    stopReason: "renderer-blocked",
    eventName: "pdf-export.failed",
  }
}

async function verifiedPersistence(input: {
  operation: FlowDocBackendPdfExportOperationV1
  workflowInput: FlowDocBackendPdfExportWorkflowInputV1
}): Promise<{ status: "found"; receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 }
  | { status: "not-found" }
  | { status: "blocked"; issues: FlowDocBackendPdfExportOperationIssueV1[] }> {
  const stored = await input.workflowInput.persistenceRepository.readByOperationId({
    ...input.operation.scope,
    operationId: input.operation.operationId,
  })
  if (stored.status === "not-found") return { status: "not-found" }
  if (stored.status !== "found") return { status: "blocked", issues: stored.issues }
  const parsed = parseFlowDocBackendPdfExportArtifactPersistenceReceiptV1(stored.receipt)
  if (parsed.status === "blocked") return { status: "blocked", issues: parsed.issues }
  if (parsed.receipt.operationFingerprint !== input.operation.operationFingerprint) return {
    status: "blocked",
    issues: [issue("pdf-export-workflow-persistence-operation-mismatch", "persistenceReceipt", "terminal persistence receipt must belong to the exact operation")],
  }
  const bytes = await input.workflowInput.contentStore.read({ storageKey: parsed.receipt.bytes.storageKey })
  if (
    bytes.status !== "found"
    || bytes.content.byteLength !== parsed.receipt.bytes.byteLength
    || bytes.content.sha256 !== parsed.receipt.bytes.sha256
  ) return {
    status: "blocked",
    issues: bytes.status === "found"
      ? [issue("pdf-export-workflow-persistence-bytes-mismatch", "contentStore", "workflow completion requires exact retained physical bytes")]
      : bytes.issues.length > 0 ? bytes.issues : [issue("pdf-export-workflow-persistence-bytes-missing", "contentStore", "workflow completion requires retained physical bytes")],
  }
  return { status: "found", receipt: parsed.receipt }
}

export async function runFlowDocBackendPdfExportEndToEndCandidateV1(
  input: FlowDocBackendPdfExportWorkflowInputV1,
): Promise<FlowDocBackendPdfExportWorkflowResultV1> {
  const parsedOperation = parseFlowDocBackendPdfExportOperationV1(input.operation)
  if (parsedOperation.status === "blocked") return blocked({ issues: parsedOperation.issues })
  const operation = parsedOperation.operation
  const terminal = await input.observabilityRepository.readTerminalWorkflow({
    ...operation.scope,
    operationId: operation.operationId,
  })
  if (terminal.status === "found") {
    const persistence = terminal.completion.terminalStatus === "completed"
      ? await verifiedPersistence({ operation, workflowInput: input })
      : { status: "not-found" as const }
    if (persistence.status === "blocked") return blocked({
      issues: persistence.issues,
      completion: terminal.completion,
      events: terminal.events,
    })
    const lifecycle = await input.lifecycleRepository.readLifecycle({ ...operation.scope, operationId: operation.operationId })
    if (lifecycle.status !== "found") return blocked({
      issues: lifecycle.status === "not-found"
        ? [issue("pdf-export-workflow-lifecycle-missing", "lifecycle", "terminal replay requires retained lifecycle evidence")]
        : lifecycle.issues,
      completion: terminal.completion,
      events: terminal.events,
      receipt: persistence.status === "found" ? persistence.receipt : null,
    })
    return {
      source: FLOWDOC_BACKEND_PDF_EXPORT_WORKFLOW_V1_SOURCE,
      status: "terminal-replay",
      completion: terminal.completion,
      events: terminal.events,
      persistenceReceipt: persistence.status === "found" ? persistence.receipt : null,
      lifecycleHead: lifecycle.head,
      execution: {
        operationAdmission: "terminal-replay",
        rendererExecuted: false,
        persistenceExecuted: false,
      },
      issues: [],
      contracts: workflowContracts(),
    }
  }
  if (terminal.status !== "not-found") return blocked({ issues: terminal.issues })

  const admitted = await input.operationRepository.admitOperation(operation)
  if (admitted.status !== "created" && admitted.status !== "idempotent-replay") return blocked({ issues: admitted.issues })
  const admissionStatus = admitted.status
  input.faultInjector?.({ point: "after-operation-admission", operationId: operation.operationId })

  const initialized = await input.lifecycleRepository.initializeLifecycle(operation)
  if (initialized.status !== "created" && initialized.status !== "idempotent-replay") return blocked({
    issues: initialized.issues,
    admission: admissionStatus,
  })
  let lifecycle = await input.lifecycleRepository.readLifecycle({ ...operation.scope, operationId: operation.operationId })
  if (lifecycle.status !== "found") return blocked({
    issues: lifecycle.status === "not-found" ? [issue("pdf-export-workflow-lifecycle-missing", "lifecycle", "initialized lifecycle must be readable")] : lifecycle.issues,
    admission: admissionStatus,
  })
  let head = lifecycle.head
  if (head.status === "pending") {
    const claimed = await input.lifecycleRepository.applyLifecycleTransition({
      transitionId: input.worker.claimTransitionId,
      ...operation.scope,
      operationId: operation.operationId,
      expectedHeadRevision: head.headRevision,
      transitionAt: input.worker.claimedAt,
      kind: "claim",
      claimToken: input.worker.claimToken,
      workerId: input.worker.workerId,
      claimExpiresAt: input.worker.claimExpiresAt,
    })
    if (claimed.status !== "applied" && claimed.status !== "idempotent-replay") return blocked({
      issues: claimed.issues,
      lifecycleHead: claimed.head,
      admission: admissionStatus,
    })
    head = claimed.head
  }
  if (head.status === "claimed" && head.claim?.claimToken !== input.worker.claimToken) return blocked({
    issues: [issue("pdf-export-workflow-claim-busy", "claimToken", "workflow candidate does not own the live lifecycle claim")],
    lifecycleHead: head,
    admission: admissionStatus,
  })
  if (head.status === "claimed" && head.checkpoint === "before-handoff") {
    const handoff = await input.lifecycleRepository.applyLifecycleTransition({
      transitionId: input.worker.beforeHandoffTransitionId,
      ...operation.scope,
      operationId: operation.operationId,
      expectedHeadRevision: head.headRevision,
      transitionAt: input.worker.beforeHandoffAt,
      kind: "pass-checkpoint",
      claimToken: input.worker.claimToken,
      nextCheckpoint: "before-render",
    })
    if (handoff.status !== "applied" && handoff.status !== "idempotent-replay") return blocked({
      issues: handoff.issues,
      lifecycleHead: handoff.head,
      admission: admissionStatus,
    })
    head = handoff.head
  }
  let persistence = await verifiedPersistence({ operation, workflowInput: input })
  if (persistence.status === "blocked") return blocked({ issues: persistence.issues, lifecycleHead: head, admission: admissionStatus })
  if (persistence.status === "not-found" && head.status === "stopped") {
    const failure = lifecycleFailure(head)
    const committed = await commitTerminal({
      workflowInput: input,
      operation,
      lifecycleHead: head,
      deduplicated: admissionStatus === "idempotent-replay",
      terminalStatus: failure.terminalStatus,
      stopReason: failure.stopReason,
      terminalEventName: failure.eventName,
      failureCode: head.stop?.reason ?? "lifecycle-stopped",
      receipt: null,
    })
    if (committed.status === "blocked") return blocked({ issues: committed.issues, lifecycleHead: head, admission: admissionStatus })
    return {
      source: FLOWDOC_BACKEND_PDF_EXPORT_WORKFLOW_V1_SOURCE,
      status: "terminated",
      completion: committed.completion,
      events: committed.events,
      persistenceReceipt: null,
      lifecycleHead: head,
      execution: { operationAdmission: admissionStatus, rendererExecuted: false, persistenceExecuted: false },
      issues: [],
      contracts: workflowContracts(),
    }
  }
  if (persistence.status === "not-found" && (head.status !== "claimed" || !["before-render", "before-persist"].includes(head.checkpoint))) return blocked({
    issues: [issue("pdf-export-workflow-lifecycle-not-renderable", "lifecycle", "workflow requires a claimed before-render or replayable before-persist head")],
    lifecycleHead: head,
    admission: admissionStatus,
  })
  if (persistence.status === "not-found") input.faultInjector?.({ point: "after-lifecycle-ready", operationId: operation.operationId })

  let rendererExecuted = false
  let persistenceExecuted = false
  if (persistence.status === "not-found") {
    const rendered = await runFlowDocBackendPdfExportRendererAttemptV1({
      renderAttemptId: input.rendererAttempt.renderAttemptId,
      completionId: input.rendererAttempt.completionId,
      operation,
      request: input.request,
      currentSource: input.currentSource,
      measuredDrawContract: input.measuredDrawContract,
      qualification: input.qualification,
      renderer: input.renderer,
      lifecycleRepository: input.lifecycleRepository,
      claimToken: input.worker.claimToken,
      beforeRender: {
        transitionId: input.rendererAttempt.beforeRenderTransitionId,
        expectedHeadRevision: input.rendererAttempt.beforeRenderExpectedHeadRevision,
        checkedAt: input.rendererAttempt.beforeRenderAt,
      },
      beforePersistTransitionId: input.rendererAttempt.beforePersistTransitionId,
      now: input.rendererAttempt.now,
    })
    rendererExecuted = rendered.renderer.executed
    if (rendered.status !== "ready-for-persistence") {
      lifecycle = await input.lifecycleRepository.readLifecycle({ ...operation.scope, operationId: operation.operationId })
      const terminalHead = lifecycle.status === "found" ? lifecycle.head : rendered.lifecycleHead
      if (terminalHead == null) return blocked({
        issues: rendered.issues,
        admission: admissionStatus,
        rendererExecuted,
      })
      const failure = lifecycleFailure(terminalHead)
      const committed = await commitTerminal({
        workflowInput: input,
        operation,
        lifecycleHead: terminalHead,
        deduplicated: admissionStatus === "idempotent-replay",
        terminalStatus: failure.terminalStatus,
        stopReason: failure.stopReason,
        terminalEventName: failure.eventName,
        failureCode: rendered.issues[0]?.code ?? "renderer-blocked",
        receipt: null,
        rendererStageReached: rendered.renderer.executed,
      })
      if (committed.status === "blocked") return blocked({
        issues: committed.issues,
        lifecycleHead: terminalHead,
        admission: admissionStatus,
        rendererExecuted,
      })
      return {
        source: FLOWDOC_BACKEND_PDF_EXPORT_WORKFLOW_V1_SOURCE,
        status: "terminated",
        completion: committed.completion,
        events: committed.events,
        persistenceReceipt: null,
        lifecycleHead: terminalHead,
        execution: { operationAdmission: admissionStatus, rendererExecuted, persistenceExecuted: false },
        issues: [],
        contracts: workflowContracts(),
      }
    }
    input.faultInjector?.({ point: "after-render", operationId: operation.operationId })
    const persisted = await persistFlowDocBackendPdfExportArtifactV1({
      persistenceId: input.persistence.persistenceId,
      jobId: input.persistence.jobId,
      layoutProfileId: input.persistence.layoutProfileId,
      persistedAt: input.persistence.persistedAt,
      claimToken: input.worker.claimToken,
      operation,
      rendererAttempt: rendered,
      lifecycleRepository: input.lifecycleRepository,
      contentStore: input.contentStore,
      persistenceRepository: input.persistenceRepository,
    })
    persistenceExecuted = true
    if (persisted.status === "blocked") return blocked({
      issues: persisted.issues,
      receipt: persisted.receipt,
      lifecycleHead: rendered.lifecycleHead,
      admission: admissionStatus,
      rendererExecuted,
      persistenceExecuted,
    })
    persistence = { status: "found", receipt: persisted.receipt }
    input.faultInjector?.({ point: "after-persistence", operationId: operation.operationId })
  }

  lifecycle = await input.lifecycleRepository.readLifecycle({ ...operation.scope, operationId: operation.operationId })
  if (lifecycle.status !== "found") return blocked({
    issues: lifecycle.status === "not-found" ? [issue("pdf-export-workflow-lifecycle-missing", "lifecycle", "success completion requires lifecycle evidence")] : lifecycle.issues,
    receipt: persistence.receipt,
    admission: admissionStatus,
    rendererExecuted,
    persistenceExecuted,
  })
  const committed = await commitTerminal({
    workflowInput: input,
    operation,
    lifecycleHead: lifecycle.head,
    deduplicated: admissionStatus === "idempotent-replay",
    terminalStatus: "completed",
    stopReason: "completed",
    terminalEventName: "pdf-export.persist-completed",
    failureCode: null,
    receipt: persistence.receipt,
  })
  if (committed.status === "blocked") return blocked({
    issues: committed.issues,
    receipt: persistence.receipt,
    lifecycleHead: lifecycle.head,
    admission: admissionStatus,
    rendererExecuted,
    persistenceExecuted,
  })
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_WORKFLOW_V1_SOURCE,
    status: committed.status === "committed" ? "completed" : "terminal-replay",
    completion: committed.completion,
    events: committed.events,
    persistenceReceipt: persistence.receipt,
    lifecycleHead: lifecycle.head,
    execution: { operationAdmission: admissionStatus, rendererExecuted, persistenceExecuted },
    issues: [],
    contracts: workflowContracts(),
  }
}
