import {
  advanceVNextDocumentCompositionV1,
  finalizeVNextCompositionFragmentWindowV1,
  finalizeVNextDocumentCompositionManifestV1,
  initializeVNextDocumentCompositionV1,
  type VNextDocumentCompositionManifestV1,
  type VNextDocumentCompositionTransitionLimitsV1,
  type VNextCompositionFragmentWindowV1,
} from "@flowdoc/vnext-core"
import {
  compositionFingerprint,
  finalizeFlowDocBackendCompositionJobHeadV1,
  finalizeFlowDocBackendCompositionPageChunkV1,
  finalizeFlowDocBackendCompositionSourcePinV1,
  summarizeFlowDocBackendCompositionContentRefsV1,
  finalizeFlowDocBackendCompositionTransitionReceiptV1,
  type FlowDocBackendCompositionContentRefV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionPageChunkV1,
  type FlowDocBackendCompositionSourcePinV1,
  type FlowDocBackendCompositionTransitionReceiptV1,
} from "../../index.js"

const fp = (value: string) => compositionFingerprint({ value })
const createdAt = "2026-07-13T08:00:00.000Z"
const expiresAt = "2026-07-14T08:00:00.000Z"

export function contentRef(
  jobId: string,
  kind: FlowDocBackendCompositionContentRefV1["kind"],
  recordId: string,
  recordFingerprint: string,
  byteLength = 100,
): FlowDocBackendCompositionContentRefV1 {
  return { jobId, kind, recordId, recordFingerprint, byteLength }
}

function required<T>(value: T | null, message: string): T {
  if (value == null) throw new Error(message)
  return value
}

export function createCompositionSchedulerFixture(): {
  manifest: VNextDocumentCompositionManifestV1
  sourcePin: FlowDocBackendCompositionSourcePinV1
  waitingHead: FlowDocBackendCompositionJobHeadV1
  window: VNextCompositionFragmentWindowV1
  pageChunk: FlowDocBackendCompositionPageChunkV1
  receipt: FlowDocBackendCompositionTransitionReceiptV1
  readyToFinalizeHead: FlowDocBackendCompositionJobHeadV1
} {
  const jobId = "composition-job-contract"
  const documentId = "composition-document-contract"
  const documentStructure = fp("structure")
  const resolvedProjection = fp("projection")
  const measurement = fp("measurement")
  const manifestResult = finalizeVNextDocumentCompositionManifestV1({
    source: "vnext-document-composition-manifest",
    contractVersion: 1,
    kind: "document-composition-manifest",
    documentId,
    documentStructureFingerprint: documentStructure,
    resolvedProjectionFingerprint: resolvedProjection,
    sections: [{
      sectionIndex: 0,
      sectionId: "section-main",
      pageGeometry: {
        pageWidthPt: 120,
        pageHeightPt: 140,
        bodyOriginXPt: 10,
        bodyOriginYPt: 10,
        bodyWidthPt: 100,
        bodyHeightPt: 100,
      },
      staticZones: [],
    }],
    bodyItems: [{
      itemIndex: 0,
      sectionIndex: 0,
      sectionId: "section-main",
      zoneOrder: 0,
      zoneId: "body",
      sourceOrder: 0,
      rootNodeId: "text-root",
      rootNodeType: "text-block",
      family: "text-flow",
      headingLevel: 1,
      ownerPins: {
        documentStructure,
        resolvedProjection,
        familySource: fp("family-source"),
        measurement,
      },
      initialCursor: {
        contractVersion: 1,
        kind: "composition-family-cursor-ref",
        family: "text-flow",
        rootNodeId: "text-root",
        ownerFingerprint: measurement,
        stateFingerprint: fp("initial-cursor"),
        complete: false,
      },
    }],
    limits: {
      maximumDocumentPageCount: 10,
      maximumDocumentPlacementCount: 20,
      maximumOpenPagePlacementCount: 10,
    },
  })
  if (manifestResult.status === "blocked") throw new Error(manifestResult.issues[0]?.message)
  const manifest = manifestResult.manifest
  const transitionLimits: VNextDocumentCompositionTransitionLimitsV1 = {
    maximumClosedPageCount: 4,
    maximumPlacementCount: 20,
    maximumFamilyPageCount: 4,
    maximumFamilyFragmentCount: 20,
  }
  const initial = initializeVNextDocumentCompositionV1({ manifest, limits: transitionLimits })
  if (initial.status !== "partial" || initial.demand == null) throw new Error("fixture initialization did not demand a window")

  const sourcePinResult = finalizeFlowDocBackendCompositionSourcePinV1({
    source: "flowdoc-backend-composition-source-pin",
    schemaVersion: 1,
    kind: "composition-source-pin",
    jobId,
    documentId,
    packageVersion: 3,
    documentVersion: 4,
    baseRevision: 7,
    packageFingerprint: fp("package"),
    resolvedProjectionFingerprint: resolvedProjection,
    manifestFingerprint: manifest.fingerprint,
    sourceSnapshotRef: contentRef(jobId, "source-snapshot", "source-snapshot-1", fp("source-snapshot"), 500),
    manifestRef: contentRef(jobId, "composition-manifest", "manifest-1", manifest.fingerprint, JSON.stringify(manifest).length),
    profiles: {
      layoutProfileId: "layout-profile-v1",
      measurementProfileId: "measurement-profile-v1",
      compositionProfileId: "composition-profile-v1",
    },
    transitionLimits,
    executionLimits: {
      maximumTransitionCount: 100,
      maximumAttemptCount: 200,
      maximumRetainedByteCount: 10_000_000,
    },
    createdAt,
    expiresAt,
  })
  if (sourcePinResult.status === "blocked") throw new Error(sourcePinResult.issues[0]?.message)
  const sourcePin = sourcePinResult.sourcePin
  const initialRetention = summarizeFlowDocBackendCompositionContentRefsV1([
    sourcePin.sourceSnapshotRef,
    sourcePin.manifestRef,
  ])

  const waitingResult = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin,
    manifest,
    value: {
      source: "flowdoc-backend-composition-job-head",
      schemaVersion: 1,
      kind: "composition-job-head",
      jobId,
      headRevision: 0,
      sourcePinFingerprint: sourcePin.fingerprint,
      manifestFingerprint: manifest.fingerprint,
      status: "waiting-window",
      transitionNumber: 0,
      cursor: initial.cursorAfter,
      openPage: initial.openPageAfter,
      demand: initial.demand,
      chain: {
        transitionReceiptTipFingerprint: null,
        closedPageChunkTipFingerprint: null,
        closedPagePrefixFingerprint: null,
        pageCount: 0,
        placementCount: 0,
        headingCount: 0,
      },
      retention: initialRetention,
      lease: null,
      retry: { attemptCount: 0, retryAfter: null },
      blocker: null,
      finalOutput: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    },
  })
  if (waitingResult.status === "blocked") throw new Error(waitingResult.issues[0]?.message)

  const demand = initial.demand
  const cursorAfter = { ...demand.cursorBefore, stateFingerprint: fp("complete-cursor"), complete: true }
  const windowResult = finalizeVNextCompositionFragmentWindowV1({
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
    ownerPins: { ...demand.ownerPins, pagination: fp("pagination") },
    capacity: demand.capacity,
    cursorBefore: demand.cursorBefore,
    status: "complete",
    cursorAfter,
    pages: [{
      windowPageIndex: 0,
      flowEffect: "place-content",
      availableHeightPt: demand.capacity.firstPageAvailableHeightPt,
      usedHeightPt: 40,
      remainingHeightPt: demand.capacity.firstPageAvailableHeightPt - 40,
      cursorBefore: demand.cursorBefore,
      cursorAfter,
      fragments: [{
        fragmentId: "text-root-fragment-0",
        fragmentIndex: 0,
        sourceNodeId: "text-root",
        blockOffsetPt: 0,
        blockExtentPt: 40,
        continuation: { fromPrevious: false, toNext: false },
        familyEvidenceFingerprint: fp("family-evidence"),
        heading: { headingNodeId: "text-root", level: 1 },
      }],
    }],
    work: { pageCount: 1, fragmentCount: 1, cursorCommitCount: 1 },
    issues: [],
  })
  if (windowResult.status === "blocked") throw new Error(windowResult.issues[0]?.message)
  const window = windowResult.window
  const completed = advanceVNextDocumentCompositionV1({
    manifest,
    cursor: initial.cursorAfter,
    openPage: initial.openPageAfter,
    window,
    limits: transitionLimits,
  })
  if (completed.status !== "complete") throw new Error("fixture transition did not complete")
  const pages = required(completed.closedPages, "fixture did not close final page")
  const windowRef = contentRef(jobId, "family-window", "window-1", window.fingerprint, JSON.stringify(window).length)
  const pageChunkResult = finalizeFlowDocBackendCompositionPageChunkV1({
    sourcePin,
    manifest,
    value: {
      source: "flowdoc-backend-composition-page-chunk",
      schemaVersion: 1,
      kind: "composition-closed-page-chunk",
      jobId,
      transitionNumber: 1,
      manifestFingerprint: manifest.fingerprint,
      windowRef,
      previousChunkFingerprint: null,
      closedPrefixBeforeFingerprint: null,
      closedPrefixAfterFingerprint: completed.cursorAfter.closedPrefix.fingerprint,
      pageCountBefore: 0,
      placementCountBefore: 0,
      headingCountBefore: 0,
      pages,
      createdAt,
    },
  })
  if (pageChunkResult.status === "blocked") throw new Error(pageChunkResult.issues[0]?.message)
  const pageChunk = pageChunkResult.pageChunk
  const pageChunkRef = contentRef(jobId, "closed-page-chunk", "chunk-1", pageChunk.fingerprint, JSON.stringify(pageChunk).length)
  const receiptResult = finalizeFlowDocBackendCompositionTransitionReceiptV1({
    sourcePin,
    manifest,
    value: {
      source: "flowdoc-backend-composition-transition-receipt",
      schemaVersion: 1,
      kind: "composition-transition-receipt",
      jobId,
      transitionNumber: 1,
      transitionRequestId: "transition-request-1",
      requestFingerprint: fp("transition-request"),
      attemptId: "attempt-1",
      headRevisionBefore: 1,
      headRevisionAfter: 2,
      manifestFingerprint: manifest.fingerprint,
      demandBeforeFingerprint: demand.fingerprint,
      windowRef,
      transitionFingerprint: completed.fingerprint,
      cursorBeforeFingerprint: initial.cursorAfter.fingerprint,
      cursorAfterFingerprint: completed.cursorAfter.fingerprint,
      openPageAfterFingerprint: null,
      demandAfterFingerprint: null,
      pageChunkRef,
      previousReceiptFingerprint: null,
      status: "complete",
      reason: "document-complete",
      work: completed.work,
      createdAt,
    },
  })
  if (receiptResult.status === "blocked") throw new Error(receiptResult.issues[0]?.message)
  const receipt = receiptResult.receipt
  const receiptRef = contentRef(jobId, "transition-receipt", "receipt-1", receipt.fingerprint, JSON.stringify(receipt).length)
  const transitionRetention = summarizeFlowDocBackendCompositionContentRefsV1([windowRef, pageChunkRef, receiptRef])
  const { fingerprint: _waitingFingerprint, ...waitingFacts } = waitingResult.jobHead
  const readyResult = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin,
    manifest,
    value: {
      ...waitingFacts,
      headRevision: 2,
      status: "ready-to-finalize",
      transitionNumber: 1,
      cursor: completed.cursorAfter,
      openPage: null,
      demand: null,
      chain: {
        transitionReceiptTipFingerprint: receipt.fingerprint,
        closedPageChunkTipFingerprint: pageChunk.fingerprint,
        closedPagePrefixFingerprint: completed.cursorAfter.closedPrefix.fingerprint,
        pageCount: completed.cursorAfter.closedPrefix.pageCount,
        placementCount: completed.cursorAfter.closedPrefix.placementCount,
        headingCount: completed.cursorAfter.closedPrefix.headingCount,
      },
      retention: {
        recordCount: initialRetention.recordCount + transitionRetention.recordCount,
        byteCount: initialRetention.byteCount + transitionRetention.byteCount,
      },
      updatedAt: createdAt,
    },
  })
  if (readyResult.status === "blocked") throw new Error(readyResult.issues[0]?.message)

  return {
    manifest,
    sourcePin,
    waitingHead: waitingResult.jobHead,
    window,
    pageChunk,
    receipt,
    readyToFinalizeHead: readyResult.jobHead,
  }
}

export function rebindCompositionSchedulerWaitingFixtureRetainedByteLimit(
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
  maximumRetainedByteCount: number,
): Pick<ReturnType<typeof createCompositionSchedulerFixture>, "manifest" | "sourcePin" | "waitingHead" | "window"> {
  const { fingerprint: _sourcePinFingerprint, ...sourcePinFacts } = fixture.sourcePin
  const sourcePinResult = finalizeFlowDocBackendCompositionSourcePinV1({
    ...sourcePinFacts,
    executionLimits: { ...sourcePinFacts.executionLimits, maximumRetainedByteCount },
  })
  if (sourcePinResult.status === "blocked") throw new Error(sourcePinResult.issues[0]?.message)
  const { fingerprint: _headFingerprint, ...headFacts } = fixture.waitingHead
  const headResult = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin: sourcePinResult.sourcePin,
    manifest: fixture.manifest,
    value: { ...headFacts, sourcePinFingerprint: sourcePinResult.sourcePin.fingerprint },
  })
  if (headResult.status === "blocked") throw new Error(headResult.issues[0]?.message)
  return {
    manifest: fixture.manifest,
    sourcePin: sourcePinResult.sourcePin,
    waitingHead: headResult.jobHead,
    window: fixture.window,
  }
}

export function createCompositionSchedulerContinuationFixture(): {
  manifest: VNextDocumentCompositionManifestV1
  sourcePin: FlowDocBackendCompositionSourcePinV1
  initialHead: FlowDocBackendCompositionJobHeadV1
  window: VNextCompositionFragmentWindowV1
  head: FlowDocBackendCompositionJobHeadV1
} {
  const jobId = "composition-job-continuation"
  const documentId = "composition-document-continuation"
  const documentStructure = fp("continuation-structure")
  const resolvedProjection = fp("continuation-projection")
  const measurement = fp("continuation-measurement")
  const manifestResult = finalizeVNextDocumentCompositionManifestV1({
    source: "vnext-document-composition-manifest",
    contractVersion: 1,
    kind: "document-composition-manifest",
    documentId,
    documentStructureFingerprint: documentStructure,
    resolvedProjectionFingerprint: resolvedProjection,
    sections: [{
      sectionIndex: 0,
      sectionId: "section-main",
      pageGeometry: {
        pageWidthPt: 120, pageHeightPt: 140,
        bodyOriginXPt: 10, bodyOriginYPt: 10, bodyWidthPt: 100, bodyHeightPt: 100,
      },
      staticZones: [],
    }],
    bodyItems: [{
      itemIndex: 0,
      sectionIndex: 0,
      sectionId: "section-main",
      zoneOrder: 0,
      zoneId: "body",
      sourceOrder: 0,
      rootNodeId: "page-break-root",
      rootNodeType: "page-break",
      family: "utility-flow",
      headingLevel: null,
      ownerPins: {
        documentStructure,
        resolvedProjection,
        familySource: fp("continuation-source"),
        measurement,
      },
      initialCursor: {
        contractVersion: 1,
        kind: "composition-family-cursor-ref",
        family: "utility-flow",
        rootNodeId: "page-break-root",
        ownerFingerprint: measurement,
        stateFingerprint: fp("continuation-initial"),
        complete: false,
      },
    }],
    limits: {
      maximumDocumentPageCount: 10,
      maximumDocumentPlacementCount: 10,
      maximumOpenPagePlacementCount: 10,
    },
  })
  if (manifestResult.status === "blocked") throw new Error(manifestResult.issues[0]?.message)
  const manifest = manifestResult.manifest
  const transitionLimits: VNextDocumentCompositionTransitionLimitsV1 = {
    maximumClosedPageCount: 1,
    maximumPlacementCount: 10,
    maximumFamilyPageCount: 2,
    maximumFamilyFragmentCount: 10,
  }
  const initial = initializeVNextDocumentCompositionV1({ manifest, limits: transitionLimits })
  if (initial.status !== "partial" || initial.demand == null) throw new Error("continuation fixture missing demand")
  const demand = initial.demand
  const cursorAfter = { ...demand.cursorBefore, stateFingerprint: fp("continuation-complete"), complete: true }
  const windowResult = finalizeVNextCompositionFragmentWindowV1({
    source: "vnext-composition-fragment-window",
    contractVersion: 1,
    kind: "composition-fragment-window",
    family: "utility-flow",
    documentId,
    sectionId: demand.sectionId,
    zoneId: demand.zoneId,
    rootNodeId: demand.rootNodeId,
    rootNodeType: "page-break",
    sourceOrder: demand.sourceOrder,
    ownerPins: { ...demand.ownerPins, pagination: fp("continuation-pagination") },
    capacity: demand.capacity,
    cursorBefore: demand.cursorBefore,
    status: "complete",
    cursorAfter,
    pages: [{
      windowPageIndex: 0,
      flowEffect: "force-page-advance",
      availableHeightPt: demand.capacity.firstPageAvailableHeightPt,
      usedHeightPt: 0,
      remainingHeightPt: demand.capacity.firstPageAvailableHeightPt,
      cursorBefore: demand.cursorBefore,
      cursorAfter,
      fragments: [],
    }],
    work: { pageCount: 1, fragmentCount: 0, cursorCommitCount: 1 },
    issues: [],
  })
  if (windowResult.status === "blocked") throw new Error(windowResult.issues[0]?.message)
  const advanced = advanceVNextDocumentCompositionV1({
    manifest,
    cursor: initial.cursorAfter,
    openPage: initial.openPageAfter,
    window: windowResult.window,
    limits: transitionLimits,
  })
  if (advanced.status !== "partial" || advanced.reason !== "output-limit" || advanced.demand !== null) {
    throw new Error("continuation fixture did not reach demand-free output limit")
  }
  const sourcePinResult = finalizeFlowDocBackendCompositionSourcePinV1({
    source: "flowdoc-backend-composition-source-pin",
    schemaVersion: 1,
    kind: "composition-source-pin",
    jobId,
    documentId,
    packageVersion: 3,
    documentVersion: 4,
    baseRevision: 8,
    packageFingerprint: fp("continuation-package"),
    resolvedProjectionFingerprint: resolvedProjection,
    manifestFingerprint: manifest.fingerprint,
    sourceSnapshotRef: contentRef(jobId, "source-snapshot", "continuation-source", fp("continuation-snapshot"), 500),
    manifestRef: contentRef(jobId, "composition-manifest", "continuation-manifest", manifest.fingerprint, JSON.stringify(manifest).length),
    profiles: {
      layoutProfileId: "layout-profile-v1",
      measurementProfileId: "measurement-profile-v1",
      compositionProfileId: "composition-profile-v1",
    },
    transitionLimits,
    executionLimits: {
      maximumTransitionCount: 100,
      maximumAttemptCount: 200,
      maximumRetainedByteCount: 10_000_000,
    },
    createdAt,
    expiresAt,
  })
  if (sourcePinResult.status === "blocked") throw new Error(sourcePinResult.issues[0]?.message)
  const sourcePin = sourcePinResult.sourcePin
  const initialRetention = summarizeFlowDocBackendCompositionContentRefsV1([
    sourcePin.sourceSnapshotRef,
    sourcePin.manifestRef,
  ])
  const initialHeadResult = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin,
    manifest,
    value: {
      source: "flowdoc-backend-composition-job-head",
      schemaVersion: 1,
      kind: "composition-job-head",
      jobId,
      headRevision: 0,
      sourcePinFingerprint: sourcePin.fingerprint,
      manifestFingerprint: manifest.fingerprint,
      status: "waiting-window",
      transitionNumber: 0,
      cursor: initial.cursorAfter,
      openPage: initial.openPageAfter,
      demand: initial.demand,
      chain: {
        transitionReceiptTipFingerprint: null,
        closedPageChunkTipFingerprint: null,
        closedPagePrefixFingerprint: null,
        pageCount: 0,
        placementCount: 0,
        headingCount: 0,
      },
      retention: initialRetention,
      lease: null,
      retry: { attemptCount: 0, retryAfter: null },
      blocker: null,
      finalOutput: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    },
  })
  if (initialHeadResult.status === "blocked") throw new Error(initialHeadResult.issues[0]?.message)
  const headResult = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin,
    manifest,
    value: {
      source: "flowdoc-backend-composition-job-head",
      schemaVersion: 1,
      kind: "composition-job-head",
      jobId,
      headRevision: 2,
      sourcePinFingerprint: sourcePin.fingerprint,
      manifestFingerprint: manifest.fingerprint,
      status: "ready-to-advance",
      transitionNumber: 1,
      cursor: advanced.cursorAfter,
      openPage: advanced.openPageAfter,
      demand: null,
      chain: {
        transitionReceiptTipFingerprint: fp("continuation-receipt"),
        closedPageChunkTipFingerprint: fp("continuation-chunk"),
        closedPagePrefixFingerprint: advanced.cursorAfter.closedPrefix.fingerprint,
        pageCount: advanced.cursorAfter.closedPrefix.pageCount,
        placementCount: advanced.cursorAfter.closedPrefix.placementCount,
        headingCount: advanced.cursorAfter.closedPrefix.headingCount,
      },
      retention: initialRetention,
      lease: null,
      retry: { attemptCount: 1, retryAfter: null },
      blocker: null,
      finalOutput: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    },
  })
  if (headResult.status === "blocked") throw new Error(headResult.issues[0]?.message)
  return {
    manifest,
    sourcePin,
    initialHead: initialHeadResult.jobHead,
    window: windowResult.window,
    head: headResult.jobHead,
  }
}
