import {
  finalizeVNextCompositionFragmentWindowV1,
  finalizeVNextDocumentCompositionManifestV1,
  type VNextCompositionNodeFamilyV1,
  type VNextCompositionRootNodeTypeV1,
  type VNextDocumentCompositionDemandV1,
} from "@flowdoc/vnext-core"
import {
  advanceFlowDocBackendCompositionV1,
  compositionFingerprint,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  finalizeFlowDocBackendCompositionV1,
  initializeFlowDocBackendCompositionV1,
  isFlowDocBackendCompositionProductionRepositoryV1,
  readFlowDocBackendCompositionProgressV1,
  type FlowDocBackendCompositionContentKindV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionProductionRepositoryV1,
  type FlowDocBackendCompositionRepositoryV1,
} from "../../index.js"

const fp = (value: string) => compositionFingerprint({ value })
const createdAt = "2026-07-13T08:00:00.000Z"
const expiresAt = "2026-07-14T08:00:00.000Z"

const profiles: Array<{
  family: VNextCompositionNodeFamilyV1
  rootNodeType: VNextCompositionRootNodeTypeV1
}> = [
  { family: "text-flow", rootNodeType: "text-block" },
  { family: "columns-flow", rootNodeType: "columns" },
  { family: "table-flow", rootNodeType: "table" },
  { family: "generated-flow", rootNodeType: "toc" },
  { family: "utility-flow", rootNodeType: "divider" },
  { family: "media-flow", rootNodeType: "image" },
]

function createManifest(pageCount: number) {
  const documentStructure = fp(`backend-scale-structure:${pageCount}`)
  const resolvedProjection = fp(`backend-scale-projection:${pageCount}`)
  const result = finalizeVNextDocumentCompositionManifestV1({
    source: "vnext-document-composition-manifest",
    contractVersion: 1,
    kind: "document-composition-manifest",
    documentId: `backend-scale-document-${pageCount}`,
    documentStructureFingerprint: documentStructure,
    resolvedProjectionFingerprint: resolvedProjection,
    sections: [{
      sectionIndex: 0,
      sectionId: "main",
      pageGeometry: {
        pageWidthPt: 120,
        pageHeightPt: 140,
        bodyOriginXPt: 10,
        bodyOriginYPt: 10,
        bodyWidthPt: 100,
        bodyHeightPt: 100,
      },
      staticZones: [{ role: "header", zoneId: "header", evidenceFingerprint: fp("backend-scale-header") }],
    }],
    bodyItems: Array.from({ length: pageCount }, (_, itemIndex) => {
      const profile = profiles[itemIndex % profiles.length]
      const rootNodeId = `root-${itemIndex}`
      const measurement = fp(`measurement:${rootNodeId}`)
      return {
        itemIndex,
        sectionIndex: 0,
        sectionId: "main",
        zoneOrder: 0,
        zoneId: "body",
        sourceOrder: itemIndex,
        rootNodeId,
        rootNodeType: profile.rootNodeType,
        family: profile.family,
        headingLevel: profile.rootNodeType === "text-block" ? 1 as const : null,
        ownerPins: {
          documentStructure,
          resolvedProjection,
          familySource: fp(`source:${rootNodeId}`),
          measurement,
        },
        initialCursor: {
          contractVersion: 1 as const,
          kind: "composition-family-cursor-ref" as const,
          family: profile.family,
          rootNodeId,
          ownerFingerprint: measurement,
          stateFingerprint: fp(`initial:${rootNodeId}`),
          complete: false,
        },
      }
    }),
    limits: {
      maximumDocumentPageCount: pageCount + 10,
      maximumDocumentPlacementCount: pageCount + 10,
      maximumOpenPagePlacementCount: 10,
    },
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.manifest
}

function contentWindow(demand: VNextDocumentCompositionDemandV1, headingLevel: number | null) {
  const cursorAfter = {
    ...demand.cursorBefore,
    stateFingerprint: fp(`complete:${demand.rootNodeId}`),
    complete: true,
  }
  const result = finalizeVNextCompositionFragmentWindowV1({
    source: "vnext-composition-fragment-window",
    contractVersion: 1,
    kind: "composition-fragment-window",
    family: demand.family,
    documentId: demand.documentId,
    sectionId: demand.sectionId,
    zoneId: demand.zoneId,
    rootNodeId: demand.rootNodeId,
    rootNodeType: demand.rootNodeType,
    sourceOrder: demand.sourceOrder,
    ownerPins: { ...demand.ownerPins, pagination: fp(`pagination:${demand.rootNodeId}`) },
    capacity: demand.capacity,
    cursorBefore: demand.cursorBefore,
    status: "complete",
    cursorAfter,
    pages: [{
      windowPageIndex: 0,
      flowEffect: "place-content",
      availableHeightPt: demand.capacity.firstPageAvailableHeightPt,
      usedHeightPt: 100,
      remainingHeightPt: demand.capacity.firstPageAvailableHeightPt - 100,
      cursorBefore: demand.cursorBefore,
      cursorAfter,
      fragments: [{
        fragmentId: `${demand.rootNodeId}:f0`,
        fragmentIndex: 0,
        sourceNodeId: demand.rootNodeId,
        blockOffsetPt: 0,
        blockExtentPt: 100,
        continuation: { fromPrevious: false, toNext: false },
        familyEvidenceFingerprint: fp(`evidence:${demand.rootNodeId}`),
        heading: headingLevel == null ? null : {
          headingNodeId: demand.rootNodeId,
          level: headingLevel as 1 | 2 | 3 | 4 | 5 | 6,
        },
      }],
    }],
    work: { pageCount: 1, fragmentCount: 1, cursorCommitCount: 1 },
    issues: [],
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.window
}

function freshWindow(demand: VNextDocumentCompositionDemandV1) {
  const result = finalizeVNextCompositionFragmentWindowV1({
    source: "vnext-composition-fragment-window",
    contractVersion: 1,
    kind: "composition-fragment-window",
    family: demand.family,
    documentId: demand.documentId,
    sectionId: demand.sectionId,
    zoneId: demand.zoneId,
    rootNodeId: demand.rootNodeId,
    rootNodeType: demand.rootNodeType,
    sourceOrder: demand.sourceOrder,
    ownerPins: { ...demand.ownerPins, pagination: fp(`fresh:${demand.rootNodeId}`) },
    capacity: demand.capacity,
    cursorBefore: demand.cursorBefore,
    status: "fresh-page-required",
    cursorAfter: demand.cursorBefore,
    pages: [],
    work: { pageCount: 0, fragmentCount: 0, cursorCommitCount: 0 },
    issues: [],
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.window
}

function attemptTimes(sequence: number) {
  const acquired = Date.parse(createdAt) + sequence * 10
  return {
    acquiredAt: new Date(acquired).toISOString(),
    completedAt: new Date(acquired + 1).toISOString(),
    leaseExpiresAt: new Date(acquired + 5).toISOString(),
  }
}

export interface FlowDocBackendCompositionScaleMetrics {
  immutableWriteCount: number
  immutableBatchWriteCount: number
  immutableWriteBytes: number
  immutableWritesByKind: Record<FlowDocBackendCompositionContentKindV1, number>
  directReadCount: number
  fingerprintReadCount: number
  compareAndSwapCount: number
  resumeReadCount: number
  maximumHeadBytes: number
  elapsedMs: number
  finalizationMs: number
}

export async function runFlowDocBackendCompositionScale(pageCount: number, options: {
  repository?: FlowDocBackendCompositionRepositoryV1
  reopenRepository?: () => Promise<FlowDocBackendCompositionRepositoryV1>
} = {}) {
  const startedAt = performance.now()
  const manifest = createManifest(pageCount)
  const packageFingerprint = fp(`backend-scale-package:${pageCount}`)
  let base = options.repository ?? createInMemoryFlowDocBackendCompositionRepositoryV1()
  const writesByKind = Object.fromEntries([
    "source-snapshot", "composition-manifest", "family-window", "closed-page-chunk",
    "transition-receipt", "page-plan", "heading-page-map",
  ].map((kind) => [kind, 0])) as Record<FlowDocBackendCompositionContentKindV1, number>
  const metrics: FlowDocBackendCompositionScaleMetrics = {
    immutableWriteCount: 0,
    immutableBatchWriteCount: 0,
    immutableWriteBytes: 0,
    immutableWritesByKind: writesByKind,
    directReadCount: 0,
    fingerprintReadCount: 0,
    compareAndSwapCount: 0,
    resumeReadCount: 0,
    maximumHeadBytes: 0,
    elapsedMs: 0,
    finalizationMs: 0,
  }
  const observeHead = (head: FlowDocBackendCompositionJobHeadV1 | null) => {
    if (head != null) metrics.maximumHeadBytes = Math.max(metrics.maximumHeadBytes, Buffer.byteLength(JSON.stringify(head), "utf8"))
  }
  const observeWrites = (records: readonly { ref: unknown }[]) => {
    for (const record of records) {
      const ref = record.ref as { byteLength: number; kind: FlowDocBackendCompositionContentKindV1 }
      metrics.immutableWriteCount += 1
      metrics.immutableWriteBytes += ref.byteLength
      metrics.immutableWritesByKind[ref.kind] += 1
    }
  }
  const repository: FlowDocBackendCompositionRepositoryV1 = {
    ...base,
    async putImmutable(input) {
      const result = await base.putImmutable(input)
      if (result.status === "written") observeWrites([input])
      return result
    },
    async readImmutable(input) {
      metrics.directReadCount += 1
      return base.readImmutable(input)
    },
    async readImmutableByFingerprint(input) {
      metrics.fingerprintReadCount += 1
      return base.readImmutableByFingerprint(input)
    },
    async readHead(jobId) {
      return base.readHead(jobId)
    },
    async readCommittedRequest(input) {
      return base.readCommittedRequest(input)
    },
    async readCommittedFinalization(input) {
      return base.readCommittedFinalization(input)
    },
    async createHead(input) {
      const result = await base.createHead(input)
      observeHead(result.head)
      return result
    },
    async compareAndSwapHead(input) {
      metrics.compareAndSwapCount += 1
      const result = await base.compareAndSwapHead(input)
      observeHead(result.head)
      return result
    },
  }
  const initialProduction = isFlowDocBackendCompositionProductionRepositoryV1(base) ? base : null
  if (initialProduction != null) Object.assign(repository, {
    productionSource: initialProduction.productionSource,
    async putImmutableWithPhysicalAdmission(input: Parameters<FlowDocBackendCompositionProductionRepositoryV1["putImmutableWithPhysicalAdmission"]>[0]) {
      if (!isFlowDocBackendCompositionProductionRepositoryV1(base)) throw new Error("reopened scale repository lost production admission")
      const result = await base.putImmutableWithPhysicalAdmission(input)
      if (result.status === "written") observeWrites([input])
      return result
    },
    async putImmutableBatchWithPhysicalAdmission(input: Parameters<FlowDocBackendCompositionProductionRepositoryV1["putImmutableBatchWithPhysicalAdmission"]>[0]) {
      if (!isFlowDocBackendCompositionProductionRepositoryV1(base)) throw new Error("reopened scale repository lost production batch admission")
      const result = await base.putImmutableBatchWithPhysicalAdmission(input)
      metrics.immutableBatchWriteCount += 1
      if (result.status === "written") {
        if (result.writtenRecordCount !== input.records.length) {
          throw new Error("scale instrumentation does not accept mixed replay batches")
        }
        observeWrites(input.records)
      }
      return result
    },
    async readImmutableBatch(input: Parameters<FlowDocBackendCompositionProductionRepositoryV1["readImmutableBatch"]>[0]) {
      if (!isFlowDocBackendCompositionProductionRepositoryV1(base)) throw new Error("reopened scale repository lost production batch reads")
      return base.readImmutableBatch(input)
    },
    async inspectPhysicalUsage(jobId: string) {
      if (!isFlowDocBackendCompositionProductionRepositoryV1(base)) throw new Error("reopened scale repository lost production usage inspection")
      return base.inspectPhysicalUsage(jobId)
    },
    async cleanupUnreachable(input: Parameters<FlowDocBackendCompositionProductionRepositoryV1["cleanupUnreachable"]>[0]) {
      if (!isFlowDocBackendCompositionProductionRepositoryV1(base)) throw new Error("reopened scale repository lost production cleanup")
      return base.cleanupUnreachable(input)
    },
  })

  const initialized = await initializeFlowDocBackendCompositionV1({
    repository,
    request: {
      requestId: "initialize-backend-scale",
      jobId: `backend-scale-job-${pageCount}`,
      documentId: manifest.documentId,
      baseRevision: 12,
      profiles: {
        layoutProfileId: "layout-profile-v1",
        measurementProfileId: "measurement-profile-v1",
        compositionProfileId: "composition-profile-v1",
      },
      transitionLimits: {
        maximumClosedPageCount: 4,
        maximumPlacementCount: 20,
        maximumFamilyPageCount: 4,
        maximumFamilyFragmentCount: 20,
      },
      executionLimits: {
        maximumTransitionCount: pageCount * 3,
        maximumAttemptCount: pageCount * 3,
        maximumRetainedByteCount: 100_000_000,
      },
      createdAt,
      expiresAt,
    },
    source: {
      currentRevision: 12,
      packageFingerprint,
      resolvedProjectionFingerprint: manifest.resolvedProjectionFingerprint,
      sourceSnapshot: {
        kind: "composition-source-snapshot",
        documentId: manifest.documentId,
        fingerprint: packageFingerprint,
      },
      manifest,
    },
  })
  if (initialized.status !== "ready") throw new Error(`scale initialization failed: ${initialized.status}`)
  let head = initialized.jobHead
  const families = new Set<VNextCompositionNodeFamilyV1>()
  let sequence = 1
  let resumed = false
  while (head.status !== "ready-to-finalize") {
    if (sequence > pageCount * 3) throw new Error("scale scheduler exceeded bounded transition count")
    if (!resumed && sequence === pageCount) {
      if (options.reopenRepository != null) base = await options.reopenRepository()
      const restored = await repository.readHead(head.jobId)
      if (restored.status !== "found") throw new Error("scale restart could not restore the committed head")
      head = restored.head
      metrics.resumeReadCount += 1
      resumed = true
    }
    let window = null
    if (head.status === "waiting-window") {
      if (head.demand == null) throw new Error("waiting scale head lost demand")
      families.add(head.demand.family)
      const item = manifest.bodyItems[head.demand.itemIndex]
      window = head.demand.capacity.firstPageAvailableHeightPt < head.demand.capacity.pageBodyHeightPt
        ? freshWindow(head.demand)
        : contentWindow(head.demand, item.headingLevel)
    } else if (head.status !== "ready-to-advance") throw new Error(`scale job entered ${head.status}`)
    const times = attemptTimes(sequence)
    const result = await advanceFlowDocBackendCompositionV1({
      repository,
      request: {
        requestId: `scale-transition-${sequence}`,
        jobId: head.jobId,
        expectedHeadRevision: head.headRevision,
        expectedHeadFingerprint: head.fingerprint,
        demandFingerprint: head.demand?.fingerprint ?? null,
        windowFingerprint: window?.fingerprint ?? null,
      },
      attempt: {
        attemptId: `scale-attempt-${sequence}`,
        leaseToken: `scale-lease-${sequence}`,
        ...times,
      },
      window,
    })
    if (result.status !== "advanced") throw new Error(`scale advancement failed: ${result.status}/${result.issues[0]?.code}`)
    head = result.jobHead
    sequence += 1
  }
  const finalizationStartedAt = performance.now()
  const finalizationTimes = attemptTimes(sequence)
  const finalized = await finalizeFlowDocBackendCompositionV1({
    repository,
    request: {
      requestId: "finalize-backend-scale",
      jobId: head.jobId,
      expectedHeadRevision: head.headRevision,
      expectedHeadFingerprint: head.fingerprint,
    },
    attempt: {
      attemptId: "scale-finalization-attempt",
      leaseToken: "scale-finalization-lease",
      ...finalizationTimes,
    },
  })
  metrics.finalizationMs = performance.now() - finalizationStartedAt
  metrics.elapsedMs = performance.now() - startedAt
  if (finalized.status !== "completed") throw new Error(`scale finalization failed: ${finalized.status}/${finalized.issues[0]?.code}`)
  const progress = await readFlowDocBackendCompositionProgressV1({
    repository,
    jobId: head.jobId,
    currentSourceRevision: 12,
    observedAt: attemptTimes(sequence + 1).completedAt,
  })
  if (progress.status !== "ready") throw new Error("scale progress failed")
  return {
    manifest,
    finalized,
    progress: progress.progress,
    metrics,
    families: [...families],
  }
}
