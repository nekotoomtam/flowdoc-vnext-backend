import type { VNextCompositionNodeFamilyV1, VNextCompositionRootNodeTypeV1 } from "@flowdoc/vnext-core"
import {
  FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
  blockedCompositionResult,
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  readyCompositionResult,
  type FlowDocBackendCompositionContractResult,
} from "./compositionSchedulerContractSupport.js"
import {
  parseFlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionBlockerV1,
  type FlowDocBackendCompositionJobHeadContextV1,
  type FlowDocBackendCompositionJobStatusV1,
  type FlowDocBackendCompositionOutputRefsV1,
} from "./compositionSchedulerJobHead.js"

export const FLOWDOC_BACKEND_COMPOSITION_PROGRESS_V1_SOURCE = "flowdoc-backend-composition-progress"

export interface FlowDocBackendCompositionProgressDemandV1 {
  demandFingerprint: string
  itemIndex: number
  sectionId: string
  zoneId: string
  rootNodeId: string
  rootNodeType: VNextCompositionRootNodeTypeV1
  family: VNextCompositionNodeFamilyV1
}

export interface FlowDocBackendCompositionProgressV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_PROGRESS_V1_SOURCE
  schemaVersion: typeof FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION
  kind: "composition-progress"
  jobId: string
  documentId: string
  sourceRevision: number
  sourceCurrent: boolean
  headRevision: number
  status: FlowDocBackendCompositionJobStatusV1
  transitionNumber: number
  counts: {
    pageCount: number
    placementCount: number
    headingCount: number
    retainedRecordCount: number
    retainedByteCount: number
    bodyItemCompletionCount: number
    familyPageCount: number
    pageAdvanceCount: number
  }
  demand: FlowDocBackendCompositionProgressDemandV1 | null
  structuralContinuation: boolean
  leaseExpiresAt: string | null
  retry: {
    attemptCount: number
    retryAfter: string | null
  }
  blocker: FlowDocBackendCompositionBlockerV1 | null
  finalOutput: FlowDocBackendCompositionOutputRefsV1 | null
  expiresAt: string
  observedAt: string
  contracts: {
    exposesCursor: false
    exposesOpenPage: false
    exposesFamilyWindow: false
    exposesStoragePaths: false
    rendererOutput: false
    editorCommandPolicy: false
  }
  fingerprint: string
}

export type FlowDocBackendCompositionProgressResultV1 = FlowDocBackendCompositionContractResult<
  FlowDocBackendCompositionProgressV1,
  "progress"
>

export function createFlowDocBackendCompositionProgressV1(input: {
  context: FlowDocBackendCompositionJobHeadContextV1
  sourceCurrent: boolean
  observedAt: string
}): FlowDocBackendCompositionProgressResultV1 {
  if (!Number.isFinite(Date.parse(input.observedAt)) || new Date(input.observedAt).toISOString() !== input.observedAt) {
    return blockedCompositionResult("progress", [
      compositionIssue("composition-progress-time-invalid", "observedAt", "observedAt must be an exact ISO date-time"),
    ])
  }
  const parsed = parseFlowDocBackendCompositionJobHeadV1(input.context)
  if (parsed.status === "blocked") return blockedCompositionResult("progress", parsed.issues)
  const head = parsed.jobHead
  const sourcePin = input.context.sourcePin as { documentId?: unknown; baseRevision?: unknown }
  const documentId = typeof sourcePin.documentId === "string" ? sourcePin.documentId : null
  const sourceRevision = typeof sourcePin.baseRevision === "number" ? sourcePin.baseRevision : null
  if (documentId == null || sourceRevision == null) return blockedCompositionResult("progress", [
    compositionIssue("composition-progress-source-invalid", "sourcePin", "validated source pin must expose document and revision facts"),
  ])
  const demand = head.demand == null ? null : {
    demandFingerprint: head.demand.fingerprint,
    itemIndex: head.demand.itemIndex,
    sectionId: head.demand.sectionId,
    zoneId: head.demand.zoneId,
    rootNodeId: head.demand.rootNodeId,
    rootNodeType: head.demand.rootNodeType,
    family: head.demand.family,
  }
  const facts = {
    source: FLOWDOC_BACKEND_COMPOSITION_PROGRESS_V1_SOURCE as typeof FLOWDOC_BACKEND_COMPOSITION_PROGRESS_V1_SOURCE,
    schemaVersion: FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
    kind: "composition-progress" as const,
    jobId: head.jobId,
    documentId,
    sourceRevision,
    sourceCurrent: input.sourceCurrent,
    headRevision: head.headRevision,
    status: head.status,
    transitionNumber: head.transitionNumber,
    counts: {
      pageCount: head.chain.pageCount,
      placementCount: head.chain.placementCount,
      headingCount: head.chain.headingCount,
      retainedRecordCount: head.retention.recordCount,
      retainedByteCount: head.retention.byteCount,
      bodyItemCompletionCount: head.cursor.cumulativeWork.bodyItemsCompleted,
      familyPageCount: head.cursor.cumulativeWork.familyPagesConsumed,
      pageAdvanceCount: head.cursor.cumulativeWork.pageAdvances,
    },
    demand,
    structuralContinuation: head.status === "ready-to-advance",
    leaseExpiresAt: head.lease?.expiresAt ?? null,
    retry: cloneCompositionJson(head.retry),
    blocker: cloneCompositionJson(head.blocker),
    finalOutput: cloneCompositionJson(head.finalOutput),
    expiresAt: head.expiresAt,
    observedAt: input.observedAt,
    contracts: {
      exposesCursor: false as const,
      exposesOpenPage: false as const,
      exposesFamilyWindow: false as const,
      exposesStoragePaths: false as const,
      rendererOutput: false as const,
      editorCommandPolicy: false as const,
    },
  }
  return readyCompositionResult("progress", { ...facts, fingerprint: compositionFingerprint(facts) })
}
