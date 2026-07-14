import {
  initializeVNextDocumentCompositionV1,
  parseVNextDocumentCompositionManifestV1,
  type VNextDocumentCompositionTransitionLimitsV1,
} from "@flowdoc/vnext-core"
import {
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  isCompositionRecord,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  finalizeFlowDocBackendCompositionJobHeadWithValidatedContextV1,
  type FlowDocBackendCompositionJobHeadV1,
} from "./compositionSchedulerJobHead.js"
import { stageFlowDocBackendCompositionImmutableBatchV1 } from "./compositionSchedulerImmutableStaging.js"
import { finalizeFlowDocBackendCompositionPageChunkWithValidatedOwnersV1 } from "./compositionSchedulerTransitionRecords.js"
import {
  type FlowDocBackendCompositionRepositoryV1,
} from "./compositionSchedulerRepository.js"
import {
  finalizeFlowDocBackendCompositionSourcePinV1,
  summarizeFlowDocBackendCompositionContentRefsV1,
  type FlowDocBackendCompositionContentRefV1,
  type FlowDocBackendCompositionExecutionLimitsV1,
  type FlowDocBackendCompositionSourcePinV1,
} from "./compositionSchedulerSourcePin.js"

export const FLOWDOC_BACKEND_COMPOSITION_INITIALIZATION_V1_SOURCE = "flowdoc-backend-composition-initialization"

export interface FlowDocBackendCompositionInitializationRequestV1 {
  requestId: string
  jobId: string
  documentId: string
  baseRevision: number
  profiles: FlowDocBackendCompositionSourcePinV1["profiles"]
  transitionLimits: VNextDocumentCompositionTransitionLimitsV1
  executionLimits: FlowDocBackendCompositionExecutionLimitsV1
  createdAt: string
  expiresAt: string
}

export interface FlowDocBackendCompositionInitializationSourceV1 {
  currentRevision: number
  packageFingerprint: string
  resolvedProjectionFingerprint: string
  sourceSnapshot: Record<string, unknown> & { fingerprint: string }
  manifest: unknown
}

export type FlowDocBackendCompositionInitializationResultV1 =
  | {
      source: typeof FLOWDOC_BACKEND_COMPOSITION_INITIALIZATION_V1_SOURCE
      status: "ready" | "idempotent-replay"
      requestFingerprint: string
      sourcePin: FlowDocBackendCompositionSourcePinV1
      jobHead: FlowDocBackendCompositionJobHeadV1
      issues: []
    }
  | {
      source: typeof FLOWDOC_BACKEND_COMPOSITION_INITIALIZATION_V1_SOURCE
      status: "stale" | "blocked"
      requestFingerprint: string | null
      sourcePin: null
      jobHead: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function ref(
  jobId: string,
  kind: FlowDocBackendCompositionContentRefV1["kind"],
  recordId: string,
  value: { fingerprint: string },
): FlowDocBackendCompositionContentRefV1 {
  return { jobId, kind, recordId, recordFingerprint: value.fingerprint, byteLength: bytes(value) }
}

function validRequest(input: FlowDocBackendCompositionInitializationRequestV1): boolean {
  return input.requestId.trim().length > 0 && input.requestId.length <= 512
    && input.jobId.trim().length > 0 && input.jobId.length <= 512
    && input.documentId.trim().length > 0 && input.documentId.length <= 512
    && Number.isInteger(input.baseRevision) && input.baseRevision >= 0
    && Number.isFinite(Date.parse(input.createdAt)) && new Date(input.createdAt).toISOString() === input.createdAt
    && Number.isFinite(Date.parse(input.expiresAt)) && new Date(input.expiresAt).toISOString() === input.expiresAt
    && Date.parse(input.expiresAt) > Date.parse(input.createdAt)
}

function blocked(
  status: "stale" | "blocked",
  issues: FlowDocBackendCompositionContractIssue[],
  requestFingerprint: string | null = null,
): FlowDocBackendCompositionInitializationResultV1 {
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_INITIALIZATION_V1_SOURCE,
    status,
    requestFingerprint,
    sourcePin: null,
    jobHead: null,
    issues,
  }
}

export async function initializeFlowDocBackendCompositionV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  request: FlowDocBackendCompositionInitializationRequestV1
  source: FlowDocBackendCompositionInitializationSourceV1
}): Promise<FlowDocBackendCompositionInitializationResultV1> {
  if (!validRequest(input.request)) return blocked("blocked", [
    compositionIssue("composition-initialization-request-invalid", "request", "initialization request identity and lifetime are invalid"),
  ])
  const requestFingerprint = compositionFingerprint({
    ...input.request,
    packageFingerprint: input.source.packageFingerprint,
    resolvedProjectionFingerprint: input.source.resolvedProjectionFingerprint,
    sourceSnapshotFingerprint: input.source.sourceSnapshot?.fingerprint,
    manifestFingerprint: isCompositionRecord(input.source.manifest) ? input.source.manifest.fingerprint : null,
  })
  if (input.source.currentRevision !== input.request.baseRevision) return blocked("stale", [
    compositionIssue(
      "composition-source-revision-stale",
      "request.baseRevision",
      `base revision ${input.request.baseRevision} does not match current revision ${input.source.currentRevision}`,
    ),
  ], requestFingerprint)
  if (
    !isCompositionRecord(input.source.sourceSnapshot)
    || input.source.sourceSnapshot.fingerprint !== input.source.packageFingerprint
  ) return blocked("blocked", [
    compositionIssue("composition-source-snapshot-invalid", "source.sourceSnapshot", "source snapshot must expose the exact package fingerprint"),
  ], requestFingerprint)
  const manifestResult = parseVNextDocumentCompositionManifestV1(input.source.manifest)
  if (manifestResult.status === "blocked") return blocked("blocked", manifestResult.issues.map((item) => compositionIssue(
    item.code, `source.manifest${item.path.length === 0 ? "" : `.${item.path}`}`, item.message,
  )), requestFingerprint)
  const manifest = manifestResult.manifest
  if (
    manifest.documentId !== input.request.documentId
    || manifest.resolvedProjectionFingerprint !== input.source.resolvedProjectionFingerprint
  ) return blocked("blocked", [
    compositionIssue("composition-initialization-owner-mismatch", "source.manifest", "manifest must match request document and resolved projection"),
  ], requestFingerprint)

  const sourceSnapshotRef = ref(
    input.request.jobId,
    "source-snapshot",
    `${input.request.jobId}:source`,
    input.source.sourceSnapshot as { fingerprint: string },
  )
  const manifestRef = ref(input.request.jobId, "composition-manifest", `${input.request.jobId}:manifest`, manifest)
  const sourcePinResult = finalizeFlowDocBackendCompositionSourcePinV1({
    source: "flowdoc-backend-composition-source-pin",
    schemaVersion: 1,
    kind: "composition-source-pin",
    jobId: input.request.jobId,
    documentId: input.request.documentId,
    packageVersion: 3,
    documentVersion: 4,
    baseRevision: input.request.baseRevision,
    packageFingerprint: input.source.packageFingerprint,
    resolvedProjectionFingerprint: input.source.resolvedProjectionFingerprint,
    manifestFingerprint: manifest.fingerprint,
    sourceSnapshotRef,
    manifestRef,
    profiles: input.request.profiles,
    transitionLimits: input.request.transitionLimits,
    executionLimits: input.request.executionLimits,
    createdAt: input.request.createdAt,
    expiresAt: input.request.expiresAt,
  })
  if (sourcePinResult.status === "blocked") return blocked("blocked", sourcePinResult.issues, requestFingerprint)
  const sourcePin = sourcePinResult.sourcePin
  const core = initializeVNextDocumentCompositionV1({ manifest, limits: input.request.transitionLimits })
  if (core.status === "blocked") return blocked("blocked", core.issues.map((item) => compositionIssue(
    item.code, `core${item.path.length === 0 ? "" : `.${item.path}`}`, item.message,
  )), requestFingerprint)

  let chunkRef: FlowDocBackendCompositionContentRefV1 | null = null
  let chunkValue: { fingerprint: string } | null = null
  if (core.closedPages.length > 0) {
    const chunkResult = finalizeFlowDocBackendCompositionPageChunkWithValidatedOwnersV1({
      sourcePin,
      manifest,
      value: {
        source: "flowdoc-backend-composition-page-chunk",
        schemaVersion: 1,
        kind: "composition-closed-page-chunk",
        jobId: input.request.jobId,
        transitionNumber: 0,
        manifestFingerprint: manifest.fingerprint,
        windowRef: null,
        previousChunkFingerprint: null,
        closedPrefixBeforeFingerprint: null,
        closedPrefixAfterFingerprint: core.cursorAfter.closedPrefix.fingerprint,
        pageCountBefore: 0,
        placementCountBefore: 0,
        headingCountBefore: 0,
        pages: core.closedPages,
        createdAt: input.request.createdAt,
      },
    })
    if (chunkResult.status === "blocked") return blocked("blocked", chunkResult.issues, requestFingerprint)
    chunkValue = chunkResult.pageChunk
    chunkRef = ref(input.request.jobId, "closed-page-chunk", `${input.request.jobId}:chunk:0`, chunkResult.pageChunk)
  }

  const immutableRecords = [
    { ref: sourceSnapshotRef, value: input.source.sourceSnapshot },
    { ref: manifestRef, value: manifest },
    ...(chunkRef == null ? [] : [{ ref: chunkRef, value: chunkValue }]),
  ]
  const retention = summarizeFlowDocBackendCompositionContentRefsV1(immutableRecords.map((item) => item.ref))
  if (retention.byteCount > sourcePin.executionLimits.maximumRetainedByteCount) return blocked("blocked", [compositionIssue(
    "composition-retained-byte-limit-exceeded",
    "request.executionLimits.maximumRetainedByteCount",
    "initial source, manifest, and page evidence exceed the pinned retained-byte limit",
  )], requestFingerprint)
  if (immutableRecords.some((immutable) => immutable.value == null)) return blocked("blocked", [compositionIssue(
    "composition-initialization-record-invalid",
    "immutableRecords",
    "initial immutable records must be finalized before storage",
  )], requestFingerprint)
  const stored = await stageFlowDocBackendCompositionImmutableBatchV1({
    repository: input.repository,
    records: immutableRecords as Array<{ ref: FlowDocBackendCompositionContentRefV1; value: unknown }>,
    storedAt: input.request.createdAt,
    maximumPhysicalByteCount: sourcePin.executionLimits.maximumRetainedByteCount,
  })
  if (stored.status !== "written" && stored.status !== "idempotent-replay") {
    return blocked("blocked", stored.issues, requestFingerprint)
  }

  const status = core.status === "complete"
    ? "ready-to-finalize"
    : core.reason === "output-limit" ? "ready-to-advance" : "waiting-window"
  const headResult = finalizeFlowDocBackendCompositionJobHeadWithValidatedContextV1({
    sourcePin,
    manifest,
    value: {
      source: "flowdoc-backend-composition-job-head",
      schemaVersion: 1,
      kind: "composition-job-head",
      jobId: input.request.jobId,
      headRevision: 0,
      sourcePinFingerprint: sourcePin.fingerprint,
      manifestFingerprint: manifest.fingerprint,
      status,
      transitionNumber: 0,
      cursor: core.cursorAfter,
      openPage: core.openPageAfter,
      demand: core.demand,
      chain: {
        transitionReceiptTipFingerprint: null,
        closedPageChunkTipFingerprint: chunkRef?.recordFingerprint ?? null,
        closedPagePrefixFingerprint: core.cursorAfter.closedPrefix.fingerprint,
        pageCount: core.cursorAfter.closedPrefix.pageCount,
        placementCount: core.cursorAfter.closedPrefix.placementCount,
        headingCount: core.cursorAfter.closedPrefix.headingCount,
      },
      retention,
      lease: null,
      retry: { attemptCount: 0, retryAfter: null },
      blocker: null,
      finalOutput: null,
      createdAt: input.request.createdAt,
      updatedAt: input.request.createdAt,
      expiresAt: input.request.expiresAt,
    },
  })
  if (headResult.status === "blocked") return blocked("blocked", headResult.issues, requestFingerprint)
  const created = await input.repository.createHead({
    createRequestId: input.request.requestId,
    requestFingerprint,
    sourcePin,
    manifest,
    head: headResult.jobHead,
  })
  if (created.status !== "created" && created.status !== "idempotent-replay") return blocked("blocked", created.issues, requestFingerprint)
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_INITIALIZATION_V1_SOURCE,
    status: created.status === "created" ? "ready" : "idempotent-replay",
    requestFingerprint,
    sourcePin: cloneCompositionJson(sourcePin),
    jobHead: cloneCompositionJson(created.head),
    issues: [],
  }
}
