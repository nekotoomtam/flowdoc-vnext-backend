import { createHash } from "node:crypto"
import {
  createVNextPdfExportHandoffV1,
  createVNextPdfExportProductionRenderCompletionV1,
  createVNextPdfExportReceiptV1,
  type VNextPdfExportProductionRenderCompletionV1,
  type VNextPdfExportReceiptV1,
  type VNextPdfExportRenderEvidenceV1,
  type VNextPdfExportRendererInputV1,
  type VNextPdfExportRequestV1,
  type VNextPdfExportSourceIdentityV1,
  type VNextPdfMeasuredDrawContractResultV1,
} from "@flowdoc/vnext-core"
import type { FlowDocBackendPdfExportLifecycleHeadV1 } from "./pdfExportLifecycle.js"
import type {
  FlowDocBackendPdfExportLifecycleRepositoryV1,
  FlowDocBackendPdfExportLifecycleTransitionResultV1,
} from "./pdfExportLifecycleRepository.js"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  parseFlowDocBackendPdfExportOperationV1,
  type FlowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"
import {
  flowDocBackendPdfExportCurrentRuntimeIdentityV1,
  parseFlowDocBackendPdfExportRendererQualificationV1,
  type FlowDocBackendPdfExportRendererQualificationV1,
} from "./pdfExportRendererQualification.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_ATTEMPT_V1_SOURCE =
  "flowdoc-backend-pdf-export-renderer-attempt" as const

export interface FlowDocBackendPdfExportRendererCheckpointInputV1 {
  paintCommandIndex: number
  totalPaintCommandCount: number
}

export type FlowDocBackendPdfExportRendererCheckpointDecisionV1 =
  | { status: "continue" }
  | {
      status: "cancel"
      reason:
        | "cancellation-requested"
        | "deadline-exceeded"
        | "claim-expired"
        | "claim-lost"
        | "lifecycle-unavailable"
        | "checkpoint-protocol-invalid"
    }

export interface FlowDocBackendPdfExportRendererControlV1 {
  checkpoint(
    input: FlowDocBackendPdfExportRendererCheckpointInputV1,
  ): Promise<FlowDocBackendPdfExportRendererCheckpointDecisionV1>
}

export type FlowDocBackendPdfExportRendererResultV1 =
  | {
      status: "rendered"
      bytes: Uint8Array
      renderEvidence: Extract<VNextPdfExportRenderEvidenceV1, { status: "rendered" }>
      issues: []
    }
  | {
      status: "cancelled"
      bytes: null
      renderEvidence: null
      issues: []
    }
  | {
      status: "blocked"
      bytes: null
      renderEvidence: null
      issues: Array<{ code: string; path: string; message: string }>
    }

export interface FlowDocBackendPdfExportRendererV1 {
  adapterId: string
  adapterVersion: string
  implementationFingerprint: string
  render(input: {
    rendererInput: VNextPdfExportRendererInputV1
    control: FlowDocBackendPdfExportRendererControlV1
  }): Promise<FlowDocBackendPdfExportRendererResultV1>
}

export interface FlowDocBackendPdfExportRendererAttemptInputV1 {
  renderAttemptId: string
  completionId: string
  operation: unknown
  request: VNextPdfExportRequestV1
  currentSource: VNextPdfExportSourceIdentityV1
  measuredDrawContract: VNextPdfMeasuredDrawContractResultV1
  qualification: unknown
  renderer: FlowDocBackendPdfExportRendererV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  claimToken: string
  beforeRender: {
    transitionId: string
    expectedHeadRevision: number
    checkedAt: string
    alreadyPassed?: boolean
  }
  beforePersistTransitionId: string
  now(): string
}

export interface FlowDocBackendPdfExportRendererAttemptRendererFactV1 {
  adapterId: string
  adapterVersion: string
  implementationFingerprint: string
  executed: boolean
  status: "not-run" | "rendered" | "cancelled" | "blocked"
  checkpointCount: number
  maximumObservedPaintCommandGap: number
  byteLength: number | null
  sha256: string | null
}

interface FlowDocBackendPdfExportRendererAttemptBaseV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_ATTEMPT_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-renderer-attempt"
  renderAttemptId: string
  operationId: string | null
  qualificationFingerprint: string | null
  handoffFingerprint: string | null
  lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1 | null
  renderer: FlowDocBackendPdfExportRendererAttemptRendererFactV1
  contracts: {
    exactCoreHandoff: true
    exactCoreReceipt: boolean
    exactCoreRenderCompletion: boolean
    cooperativeCancellation: true
    lifecycleCheckpointBinding: true
    returnsBytesOnlyAfterValidation: true
    fileWrites: false
    storageWrites: false
    artifactProjection: false
    observabilityWrites: false
    backendRoute: false
    authzExecution: false
    concreteProductionRendererSelected: false
    productionBinding: false
  }
  executionFingerprint: string
}

export type FlowDocBackendPdfExportRendererAttemptResultV1 =
  | (FlowDocBackendPdfExportRendererAttemptBaseV1 & {
      status: "ready-for-persistence"
      bytes: Uint8Array
      receipt: VNextPdfExportReceiptV1
      completion: VNextPdfExportProductionRenderCompletionV1
      issues: []
    })
  | (FlowDocBackendPdfExportRendererAttemptBaseV1 & {
      status: "cancelled" | "blocked"
      bytes: null
      receipt: null
      completion: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    })

interface CheckpointTraceV1 {
  indexes: number[]
  maximumObservedGap: number
  protocolIssue: FlowDocBackendPdfExportOperationIssueV1 | null
  stopDecision: Extract<FlowDocBackendPdfExportRendererCheckpointDecisionV1, { status: "cancel" }> | null
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function runtimeMatches(qualification: FlowDocBackendPdfExportRendererQualificationV1): boolean {
  const current = flowDocBackendPdfExportCurrentRuntimeIdentityV1()
  return qualification.runtime.nodeVersion === current.nodeVersion
    && qualification.runtime.platform === current.platform
    && qualification.runtime.architecture === current.architecture
}

function rendererFact(input: {
  renderer: FlowDocBackendPdfExportRendererV1
  executed: boolean
  status: FlowDocBackendPdfExportRendererAttemptRendererFactV1["status"]
  trace: CheckpointTraceV1
  byteLength?: number | null
  sha256?: string | null
}): FlowDocBackendPdfExportRendererAttemptRendererFactV1 {
  return {
    adapterId: input.renderer.adapterId,
    adapterVersion: input.renderer.adapterVersion,
    implementationFingerprint: input.renderer.implementationFingerprint,
    executed: input.executed,
    status: input.status,
    checkpointCount: input.trace.indexes.length,
    maximumObservedPaintCommandGap: input.trace.maximumObservedGap,
    byteLength: input.byteLength ?? null,
    sha256: input.sha256 ?? null,
  }
}

function contracts(input: {
  receipt: boolean
  completion: boolean
}): FlowDocBackendPdfExportRendererAttemptBaseV1["contracts"] {
  return {
    exactCoreHandoff: true,
    exactCoreReceipt: input.receipt,
    exactCoreRenderCompletion: input.completion,
    cooperativeCancellation: true,
    lifecycleCheckpointBinding: true,
    returnsBytesOnlyAfterValidation: true,
    fileWrites: false,
    storageWrites: false,
    artifactProjection: false,
    observabilityWrites: false,
    backendRoute: false,
    authzExecution: false,
    concreteProductionRendererSelected: false,
    productionBinding: false,
  }
}

function executionFingerprint(input: {
  renderAttemptId: string
  operationId: string | null
  status: FlowDocBackendPdfExportRendererAttemptResultV1["status"]
  qualificationFingerprint: string | null
  handoffFingerprint: string | null
  lifecycleFingerprint: string | null
  renderer: FlowDocBackendPdfExportRendererAttemptRendererFactV1
  receiptFingerprint: string | null
  completionFingerprint: string | null
  issueCodes: string[]
}): string {
  return flowDocBackendPdfExportFingerprintV1(input)
}

function terminal(input: {
  status: "cancelled" | "blocked"
  renderAttemptId: string
  operationId: string | null
  qualificationFingerprint: string | null
  handoffFingerprint: string | null
  lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1 | null
  renderer: FlowDocBackendPdfExportRendererAttemptRendererFactV1
  issues: FlowDocBackendPdfExportOperationIssueV1[]
}): FlowDocBackendPdfExportRendererAttemptResultV1 {
  const facts = {
    renderAttemptId: input.renderAttemptId,
    operationId: input.operationId,
    status: input.status,
    qualificationFingerprint: input.qualificationFingerprint,
    handoffFingerprint: input.handoffFingerprint,
    lifecycleFingerprint: input.lifecycleHead?.lifecycleFingerprint ?? null,
    renderer: input.renderer,
    receiptFingerprint: null,
    completionFingerprint: null,
    issueCodes: input.issues.map((entry) => entry.code),
  }
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_ATTEMPT_V1_SOURCE,
    contractVersion: 1,
    kind: "pdf-export-renderer-attempt",
    renderAttemptId: input.renderAttemptId,
    operationId: input.operationId,
    status: input.status,
    qualificationFingerprint: input.qualificationFingerprint,
    handoffFingerprint: input.handoffFingerprint,
    lifecycleHead: input.lifecycleHead == null ? null : cloneFlowDocBackendPdfExportJsonV1(input.lifecycleHead),
    renderer: cloneFlowDocBackendPdfExportJsonV1(input.renderer),
    bytes: null,
    receipt: null,
    completion: null,
    issues: cloneFlowDocBackendPdfExportJsonV1(input.issues),
    contracts: contracts({ receipt: false, completion: false }),
    executionFingerprint: executionFingerprint(facts),
  }
}

function qualificationMatches(input: {
  operation: FlowDocBackendPdfExportOperationV1
  qualification: FlowDocBackendPdfExportRendererQualificationV1
  renderer: FlowDocBackendPdfExportRendererV1
}): FlowDocBackendPdfExportOperationIssueV1[] {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (
    input.qualification.adapter.adapterId !== input.renderer.adapterId
    || input.qualification.adapter.adapterVersion !== input.renderer.adapterVersion
    || input.qualification.adapter.implementationFingerprint !== input.renderer.implementationFingerprint
  ) issues.push(issue(
    "pdf-export-renderer-adapter-qualification-mismatch",
    "renderer",
    "renderer identity and implementation fingerprint must match the exact qualification",
  ))
  if (
    input.qualification.profiles.rendererProfileId
      !== input.operation.admission.exportIdentity.rendererProfileId
    || input.qualification.profiles.measurementProfileId
      !== input.operation.admission.exportIdentity.measurementProfileId
  ) issues.push(issue(
    "pdf-export-renderer-profile-qualification-mismatch",
    "qualification.profiles",
    "qualification profiles must match the exact admitted renderer and measurement profiles",
  ))
  if (!runtimeMatches(input.qualification)) issues.push(issue(
    "pdf-export-renderer-runtime-qualification-mismatch",
    "qualification.runtime",
    "qualification runtime must match the current Node version, platform, and architecture",
  ))
  return issues
}

async function readLifecycle(input: {
  repository: FlowDocBackendPdfExportLifecycleRepositoryV1
  operation: FlowDocBackendPdfExportOperationV1
}): Promise<{ head: FlowDocBackendPdfExportLifecycleHeadV1 | null; issues: FlowDocBackendPdfExportOperationIssueV1[] }> {
  const result = await input.repository.readLifecycle({
    ...input.operation.scope,
    operationId: input.operation.operationId,
  })
  if (result.status === "found") return { head: result.head, issues: [] }
  if (result.status === "not-found") return {
    head: null,
    issues: [issue("pdf-export-renderer-lifecycle-not-found", "lifecycle", "renderer attempt requires the exact operation lifecycle")],
  }
  return { head: null, issues: result.issues }
}

function lifecycleStopDecision(input: {
  head: FlowDocBackendPdfExportLifecycleHeadV1
  claimToken: string
  now: string
}): FlowDocBackendPdfExportRendererCheckpointDecisionV1 {
  if (input.head.status === "stopped") {
    return {
      status: "cancel",
      reason: input.head.stop?.reason === "deadline-exceeded" ? "deadline-exceeded" : "cancellation-requested",
    }
  }
  if (input.head.status !== "claimed" || input.head.claim?.claimToken !== input.claimToken) {
    return { status: "cancel", reason: "claim-lost" }
  }
  if (Date.parse(input.now) >= Date.parse(input.head.deadlineAt)) {
    return { status: "cancel", reason: "deadline-exceeded" }
  }
  if (Date.parse(input.now) >= Date.parse(input.head.claim.expiresAt)) {
    return { status: "cancel", reason: "claim-expired" }
  }
  if (input.head.cancellation != null) return { status: "cancel", reason: "cancellation-requested" }
  return { status: "continue" }
}

async function applyBeforePersistCheck(input: {
  operation: FlowDocBackendPdfExportOperationV1
  repository: FlowDocBackendPdfExportLifecycleRepositoryV1
  transitionId: string
  claimToken: string
  checkedAt: string
  replayHeadRevision?: number
}): Promise<FlowDocBackendPdfExportLifecycleTransitionResultV1> {
  let current = await input.repository.readLifecycle({
    ...input.operation.scope,
    operationId: input.operation.operationId,
  })
  if (current.status !== "found") return current.status === "not-found"
    ? { status: "not-found", head: null, receipt: null, issues: [] }
    : { status: current.status, head: null, receipt: null, issues: current.issues }
  const request = (
    head: FlowDocBackendPdfExportLifecycleHeadV1,
    expectedHeadRevision = head.headRevision,
  ) => Date.parse(input.checkedAt) >= Date.parse(head.deadlineAt)
    ? {
        transitionId: input.transitionId,
        ...input.operation.scope,
        operationId: input.operation.operationId,
        expectedHeadRevision,
        transitionAt: input.checkedAt,
        kind: "enforce-deadline" as const,
      }
    : {
        transitionId: input.transitionId,
        ...input.operation.scope,
        operationId: input.operation.operationId,
        expectedHeadRevision,
        transitionAt: input.checkedAt,
        kind: "check-checkpoint" as const,
        claimToken: input.claimToken,
      }
  if (input.replayHeadRevision != null) {
    const replay = await input.repository.applyLifecycleTransition(request(current.head, input.replayHeadRevision))
    if (replay.status !== "stale") return replay
  }
  let result = await input.repository.applyLifecycleTransition(request(current.head))
  if (result.status !== "stale") return result
  current = await input.repository.readLifecycle({
    ...input.operation.scope,
    operationId: input.operation.operationId,
  })
  if (current.status !== "found") return current.status === "not-found"
    ? { status: "not-found", head: null, receipt: null, issues: [] }
    : { status: current.status, head: null, receipt: null, issues: current.issues }
  result = await input.repository.applyLifecycleTransition(request(current.head))
  return result
}

function checkpointIssues(input: {
  trace: CheckpointTraceV1
  expectedPaintCommandCount: number
  qualification: FlowDocBackendPdfExportRendererQualificationV1
}): FlowDocBackendPdfExportOperationIssueV1[] {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (input.trace.protocolIssue != null) issues.push(input.trace.protocolIssue)
  if (
    input.trace.indexes.length < input.qualification.protocol.minimumCheckpointCount
    || input.trace.indexes[0] !== 0
    || input.trace.indexes.at(-1) !== input.expectedPaintCommandCount
  ) issues.push(issue(
    "pdf-export-renderer-checkpoint-coverage-invalid",
    "renderer.control",
    "renderer must cooperatively check at the initial and terminal paint-command boundaries",
  ))
  return issues
}

export async function runFlowDocBackendPdfExportRendererAttemptV1(
  input: FlowDocBackendPdfExportRendererAttemptInputV1,
): Promise<FlowDocBackendPdfExportRendererAttemptResultV1> {
  const emptyTrace: CheckpointTraceV1 = {
    indexes: [],
    maximumObservedGap: 0,
    protocolIssue: null,
    stopDecision: null,
  }
  const inputIssues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.renderAttemptId)) inputIssues.push(issue(
    "pdf-export-renderer-attempt-id-invalid", "renderAttemptId", "render attempt id must be bounded",
  ))
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.completionId)) inputIssues.push(issue(
    "pdf-export-renderer-completion-id-invalid", "completionId", "completion id must be bounded",
  ))
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.claimToken)) inputIssues.push(issue(
    "pdf-export-renderer-claim-token-invalid", "claimToken", "claim token must be bounded",
  ))
  if (
    !isFlowDocBackendPdfExportBoundedStringV1(input.beforeRender.transitionId)
    || !Number.isInteger(input.beforeRender.expectedHeadRevision)
    || input.beforeRender.expectedHeadRevision < 0
    || !exactIso(input.beforeRender.checkedAt)
    || (input.beforeRender.alreadyPassed != null && typeof input.beforeRender.alreadyPassed !== "boolean")
    || !isFlowDocBackendPdfExportBoundedStringV1(input.beforePersistTransitionId)
  ) inputIssues.push(issue(
    "pdf-export-renderer-lifecycle-transition-invalid",
    "beforeRender",
    "renderer lifecycle transition ids, revision, and time must be exact",
  ))
  const parsedOperation = parseFlowDocBackendPdfExportOperationV1(input.operation)
  const parsedQualification = parseFlowDocBackendPdfExportRendererQualificationV1(input.qualification)
  if (parsedOperation.status === "blocked") inputIssues.push(...parsedOperation.issues)
  if (parsedQualification.status === "blocked") inputIssues.push(...parsedQualification.issues)
  const operation = parsedOperation.status === "ready" ? parsedOperation.operation : null
  const qualification = parsedQualification.status === "ready" ? parsedQualification.qualification : null
  if (operation != null && qualification != null) inputIssues.push(...qualificationMatches({
    operation,
    qualification,
    renderer: input.renderer,
  }))
  if (inputIssues.length > 0 || operation == null || qualification == null) return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation?.operationId ?? null,
    qualificationFingerprint: qualification?.qualificationFingerprint ?? null,
    handoffFingerprint: null,
    lifecycleHead: null,
    renderer: rendererFact({ renderer: input.renderer, executed: false, status: "not-run", trace: emptyTrace }),
    issues: inputIssues,
  })

  const handoff = createVNextPdfExportHandoffV1({
    request: input.request,
    currentSource: input.currentSource,
    measuredDrawContract: input.measuredDrawContract,
  })
  const handoffIssues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (handoff.status !== "ready") handoff.issues.forEach((entry) => handoffIssues.push(issue(
    "pdf-export-renderer-core-handoff-blocked",
    `handoff.${entry.path}`,
    `${entry.code}: ${entry.message}`,
  )))
  else if (
    handoff.handoffFingerprint !== operation.admission.exportIdentity.handoffFingerprint
    || handoff.request.requestFingerprint !== operation.admission.exportIdentity.requestFingerprint
    || handoff.rendererInput.sourceContractFingerprint
      !== operation.admission.exportIdentity.sourceContractFingerprint
    || handoff.rendererInput.sourceContractContentFingerprint
      !== operation.admission.exportIdentity.sourceContractContentFingerprint
  ) handoffIssues.push(issue(
    "pdf-export-renderer-admission-handoff-mismatch",
    "handoff",
    "recreated Core handoff must match every exact admitted identity",
  ))
  if (handoff.status !== "ready" || handoffIssues.length > 0) return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: null,
    renderer: rendererFact({ renderer: input.renderer, executed: false, status: "not-run", trace: emptyTrace }),
    issues: handoffIssues,
  })

  const retainedBeforePersist = input.beforeRender.alreadyPassed === true
    ? await readLifecycle({ repository: input.lifecycleRepository, operation })
    : null
  const beforeRender = retainedBeforePersist == null
    ? await input.lifecycleRepository.applyLifecycleTransition({
        transitionId: input.beforeRender.transitionId,
        ...operation.scope,
        operationId: operation.operationId,
        expectedHeadRevision: input.beforeRender.expectedHeadRevision,
        transitionAt: input.beforeRender.checkedAt,
        kind: "pass-checkpoint",
        claimToken: input.claimToken,
        nextCheckpoint: "before-persist",
      })
    : retainedBeforePersist.head != null
      && retainedBeforePersist.head.status === "claimed"
      && retainedBeforePersist.head.checkpoint === "before-persist"
      && retainedBeforePersist.head.claim?.claimToken === input.claimToken
      && retainedBeforePersist.head.checkpointCheck?.claimToken === input.claimToken
      ? {
          status: "idempotent-replay" as const,
          head: retainedBeforePersist.head,
          receipt: null,
          issues: [] as [],
        }
      : {
          status: "blocked" as const,
          head: retainedBeforePersist.head,
          receipt: null,
          issues: retainedBeforePersist.issues.length > 0
            ? retainedBeforePersist.issues
            : [issue(
                "pdf-export-renderer-before-render-recovery-invalid",
                "lifecycle",
                "before-render recovery requires the exact retained before-persist checkpoint and live claim",
              )],
        }
  if (!["applied", "idempotent-replay"].includes(beforeRender.status)) return terminal({
    status: beforeRender.status === "blocked" && beforeRender.issues.some((entry) => [
      "pdf-export-lifecycle-terminal", "pdf-export-lifecycle-claim-stale",
      "pdf-export-lifecycle-claim-expired",
    ].includes(entry.code)) ? "cancelled" : "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: beforeRender.head,
    renderer: rendererFact({ renderer: input.renderer, executed: false, status: "not-run", trace: emptyTrace }),
    issues: beforeRender.issues.length > 0 ? beforeRender.issues : [issue(
      "pdf-export-renderer-before-render-transition-blocked",
      "lifecycle",
      `before-render transition returned ${beforeRender.status}`,
    )],
  })

  const live = await readLifecycle({ repository: input.lifecycleRepository, operation })
  if (live.head == null) return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: null,
    renderer: rendererFact({ renderer: input.renderer, executed: false, status: "not-run", trace: emptyTrace }),
    issues: live.issues,
  })
  const preflightAt = input.now()
  if (!exactIso(preflightAt)) return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: live.head,
    renderer: rendererFact({ renderer: input.renderer, executed: false, status: "not-run", trace: emptyTrace }),
    issues: [issue("pdf-export-renderer-clock-invalid", "now", "renderer clock must return exact ISO date-times")],
  })
  const preflight = lifecycleStopDecision({ head: live.head, claimToken: input.claimToken, now: preflightAt })
  if (preflight.status === "cancel") {
    const checked = await applyBeforePersistCheck({
      operation,
      repository: input.lifecycleRepository,
      transitionId: input.beforePersistTransitionId,
      claimToken: input.claimToken,
      checkedAt: preflightAt,
    })
    return terminal({
      status: "cancelled",
      renderAttemptId: input.renderAttemptId,
      operationId: operation.operationId,
      qualificationFingerprint: qualification.qualificationFingerprint,
      handoffFingerprint: handoff.handoffFingerprint,
      lifecycleHead: checked.head ?? live.head,
      renderer: rendererFact({ renderer: input.renderer, executed: false, status: "not-run", trace: emptyTrace }),
      issues: [issue("pdf-export-renderer-preflight-cancelled", "lifecycle", preflight.reason)],
    })
  }

  const trace: CheckpointTraceV1 = {
    indexes: [],
    maximumObservedGap: 0,
    protocolIssue: null,
    stopDecision: null,
  }
  const expectedPaintCommandCount = operation.admission.resources.measured.paintCommandCount
  const control: FlowDocBackendPdfExportRendererControlV1 = {
    async checkpoint(checkpoint) {
      if (trace.stopDecision != null) return trace.stopDecision
      const previous = trace.indexes.at(-1)
      const valid = Number.isInteger(checkpoint.paintCommandIndex)
        && checkpoint.paintCommandIndex >= 0
        && checkpoint.paintCommandIndex <= expectedPaintCommandCount
        && checkpoint.totalPaintCommandCount === expectedPaintCommandCount
        && (previous == null ? checkpoint.paintCommandIndex === 0 : checkpoint.paintCommandIndex >= previous)
      const gap = previous == null ? checkpoint.paintCommandIndex : checkpoint.paintCommandIndex - previous
      if (!valid || gap > qualification.protocol.maximumPaintCommandsBetweenChecks) {
        trace.protocolIssue = issue(
          "pdf-export-renderer-checkpoint-protocol-invalid",
          "renderer.control.checkpoint",
          "checkpoint indexes must be exact, monotonic, and within the qualified paint-command gap",
        )
        trace.stopDecision = { status: "cancel", reason: "checkpoint-protocol-invalid" }
        return trace.stopDecision
      }
      trace.indexes.push(checkpoint.paintCommandIndex)
      trace.maximumObservedGap = Math.max(trace.maximumObservedGap, gap)
      const checkedAt = input.now()
      if (!exactIso(checkedAt)) {
        trace.protocolIssue = issue("pdf-export-renderer-clock-invalid", "now", "renderer clock must return exact ISO date-times")
        trace.stopDecision = { status: "cancel", reason: "checkpoint-protocol-invalid" }
        return trace.stopDecision
      }
      const current = await readLifecycle({ repository: input.lifecycleRepository, operation })
      if (current.head == null) {
        trace.stopDecision = { status: "cancel", reason: "lifecycle-unavailable" }
        return trace.stopDecision
      }
      const decision = lifecycleStopDecision({ head: current.head, claimToken: input.claimToken, now: checkedAt })
      if (decision.status === "cancel") trace.stopDecision = decision
      return decision
    },
  }

  let rendered: FlowDocBackendPdfExportRendererResultV1
  try {
    rendered = await input.renderer.render({ rendererInput: handoff.rendererInput, control })
  } catch (error) {
    rendered = {
      status: "blocked",
      bytes: null,
      renderEvidence: null,
      issues: [{
        code: "renderer-threw",
        path: "renderer.render",
        message: error instanceof Error ? error.message : "renderer threw an unknown value",
      }],
    }
  }

  if (trace.stopDecision != null || rendered.status === "cancelled") {
    const checkedAt = input.now()
    const checked = exactIso(checkedAt) ? await applyBeforePersistCheck({
      operation,
      repository: input.lifecycleRepository,
      transitionId: input.beforePersistTransitionId,
      claimToken: input.claimToken,
      checkedAt,
    }) : null
    const cancelIssues = trace.protocolIssue != null
      ? [trace.protocolIssue]
      : [issue(
          "pdf-export-renderer-cooperatively-cancelled",
          "renderer",
          trace.stopDecision?.reason ?? "renderer returned cooperative cancellation",
        )]
    return terminal({
      status: trace.protocolIssue == null ? "cancelled" : "blocked",
      renderAttemptId: input.renderAttemptId,
      operationId: operation.operationId,
      qualificationFingerprint: qualification.qualificationFingerprint,
      handoffFingerprint: handoff.handoffFingerprint,
      lifecycleHead: checked?.head ?? live.head,
      renderer: rendererFact({ renderer: input.renderer, executed: true, status: "cancelled", trace }),
      issues: cancelIssues,
    })
  }

  if (rendered.status === "blocked") return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: live.head,
    renderer: rendererFact({ renderer: input.renderer, executed: true, status: "blocked", trace }),
    issues: rendered.issues.map((entry) => issue(entry.code, `renderer.${entry.path}`, entry.message)),
  })

  const coverageIssues = checkpointIssues({ trace, expectedPaintCommandCount, qualification })
  const bytes = rendered.bytes
  const bytesSha256 = createHash("sha256").update(bytes).digest("hex")
  const evidence = rendered.renderEvidence
  if (
    bytes.byteLength <= 0
    || Buffer.from(bytes).subarray(0, 5).toString("ascii") !== "%PDF-"
    || evidence.artifactId !== input.request.artifactId
    || evidence.format !== "pdf"
    || evidence.mediaType !== "application/pdf"
    || evidence.byteLength !== bytes.byteLength
    || evidence.sha256 !== bytesSha256
    || evidence.pageCount !== input.request.measuredDrawContract.pageCount
    || evidence.rendererProfileId !== qualification.profiles.rendererProfileId
    || evidence.measurementProfileId !== qualification.profiles.measurementProfileId
    || evidence.sourceContractFingerprint !== handoff.rendererInput.sourceContractFingerprint
    || evidence.sourceContractContentFingerprint !== handoff.rendererInput.sourceContractContentFingerprint
  ) coverageIssues.push(issue(
    "pdf-export-renderer-byte-evidence-mismatch",
    "renderer.renderEvidence",
    "renderer bytes and evidence must match every exact request, profile, contract, page, length, and SHA-256 fact",
  ))
  if (coverageIssues.length > 0) return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: live.head,
    renderer: rendererFact({
      renderer: input.renderer,
      executed: true,
      status: "blocked",
      trace,
      byteLength: bytes.byteLength,
      sha256: bytesSha256,
    }),
    issues: coverageIssues,
  })

  const receiptResult = createVNextPdfExportReceiptV1({ handoff, renderEvidence: evidence })
  if (receiptResult.status !== "accepted") return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: live.head,
    renderer: rendererFact({ renderer: input.renderer, executed: true, status: "blocked", trace }),
    issues: receiptResult.issues.map((entry) => issue(
      "pdf-export-renderer-core-receipt-blocked", `receipt.${entry.path}`, `${entry.code}: ${entry.message}`,
    )),
  })
  const completionResult = createVNextPdfExportProductionRenderCompletionV1({
    completionId: input.completionId,
    admission: operation.admission,
    request: input.request,
    measuredDrawContract: input.measuredDrawContract,
    receipt: receiptResult.receipt,
  })
  if (completionResult.status !== "ready-for-persistence") return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: live.head,
    renderer: rendererFact({ renderer: input.renderer, executed: true, status: "blocked", trace }),
    issues: completionResult.issues.map((entry) => issue(
      "pdf-export-renderer-core-completion-blocked", `completion.${entry.path}`, `${entry.code}: ${entry.message}`,
    )),
  })

  const beforePersistAt = input.now()
  if (!exactIso(beforePersistAt)) return terminal({
    status: "blocked",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: live.head,
    renderer: rendererFact({ renderer: input.renderer, executed: true, status: "blocked", trace }),
    issues: [issue("pdf-export-renderer-clock-invalid", "now", "renderer clock must return exact ISO date-times")],
  })
  const beforePersist = await applyBeforePersistCheck({
    operation,
    repository: input.lifecycleRepository,
    transitionId: input.beforePersistTransitionId,
    claimToken: input.claimToken,
    checkedAt: beforePersistAt,
    replayHeadRevision: beforeRender.head?.headRevision,
  })
  const persistReady = beforePersist.status === "applied" || beforePersist.status === "idempotent-replay"
    ? beforePersist
    : null
  if (persistReady == null
    || persistReady.head.status !== "claimed"
    || persistReady.head.checkpoint !== "before-persist"
    || persistReady.head.checkpointCheck?.claimToken !== input.claimToken) return terminal({
    status: "cancelled",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: beforePersist.head,
    renderer: rendererFact({
      renderer: input.renderer,
      executed: true,
      status: "cancelled",
      trace,
      byteLength: bytes.byteLength,
      sha256: bytesSha256,
    }),
    issues: beforePersist.issues.length > 0 ? beforePersist.issues : [issue(
      "pdf-export-renderer-before-persist-cancelled",
      "lifecycle",
      `before-persist transition returned ${beforePersist.status}`,
    )],
  })

  const finalRenderer = rendererFact({
    renderer: input.renderer,
    executed: true,
    status: "rendered",
    trace,
    byteLength: bytes.byteLength,
    sha256: bytesSha256,
  })
  const facts = {
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    status: "ready-for-persistence" as const,
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleFingerprint: persistReady.head.lifecycleFingerprint,
    renderer: finalRenderer,
    receiptFingerprint: receiptResult.receipt.receiptFingerprint,
    completionFingerprint: completionResult.completion.completionFingerprint,
    issueCodes: [] as string[],
  }
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_ATTEMPT_V1_SOURCE,
    contractVersion: 1,
    kind: "pdf-export-renderer-attempt",
    renderAttemptId: input.renderAttemptId,
    operationId: operation.operationId,
    status: "ready-for-persistence",
    qualificationFingerprint: qualification.qualificationFingerprint,
    handoffFingerprint: handoff.handoffFingerprint,
    lifecycleHead: cloneFlowDocBackendPdfExportJsonV1(persistReady.head),
    renderer: finalRenderer,
    bytes: new Uint8Array(bytes),
    receipt: cloneFlowDocBackendPdfExportJsonV1(receiptResult.receipt),
    completion: cloneFlowDocBackendPdfExportJsonV1(completionResult.completion),
    issues: [],
    contracts: contracts({ receipt: true, completion: true }),
    executionFingerprint: executionFingerprint(facts),
  }
}
