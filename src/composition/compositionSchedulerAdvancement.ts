import {
  advanceVNextDocumentCompositionV1,
  parseVNextCompositionFragmentWindowV1,
} from "@flowdoc/vnext-core"
import {
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  finalizeFlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionJobStatusV1,
} from "./compositionSchedulerJobHead.js"
import {
  type FlowDocBackendCompositionRepositoryContextV1,
  type FlowDocBackendCompositionRepositoryV1,
} from "./compositionSchedulerRepository.js"
import {
  type FlowDocBackendCompositionContentRefV1,
} from "./compositionSchedulerSourcePin.js"
import {
  finalizeFlowDocBackendCompositionPageChunkV1,
  finalizeFlowDocBackendCompositionTransitionReceiptV1,
  parseFlowDocBackendCompositionTransitionReceiptV1,
  type FlowDocBackendCompositionTransitionReceiptV1,
} from "./compositionSchedulerTransitionRecords.js"

export const FLOWDOC_BACKEND_COMPOSITION_ADVANCEMENT_V1_SOURCE = "flowdoc-backend-composition-advancement"

export interface FlowDocBackendCompositionAdvancementRequestV1 {
  requestId: string
  jobId: string
  expectedHeadRevision: number
  expectedHeadFingerprint: string
  demandFingerprint: string | null
  windowFingerprint: string | null
}

export interface FlowDocBackendCompositionAdvancementAttemptV1 {
  attemptId: string
  leaseToken: string
  acquiredAt: string
  completedAt: string
  leaseExpiresAt: string
}

interface AdvancementSuccess {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_ADVANCEMENT_V1_SOURCE
  status: "advanced" | "idempotent-replay"
  requestFingerprint: string
  jobHead: FlowDocBackendCompositionJobHeadV1
  receipt: FlowDocBackendCompositionTransitionReceiptV1
  windowRef: FlowDocBackendCompositionContentRefV1 | null
  pageChunkRef: FlowDocBackendCompositionContentRefV1 | null
  issues: []
}

interface AdvancementFailure {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_ADVANCEMENT_V1_SOURCE
  status: "stale" | "conflict" | "busy" | "rejected" | "blocked" | "failed"
  requestFingerprint: string | null
  jobHead: FlowDocBackendCompositionJobHeadV1 | null
  receipt: null
  windowRef: null
  pageChunkRef: null
  issues: FlowDocBackendCompositionContractIssue[]
}

export type FlowDocBackendCompositionAdvancementResultV1 = AdvancementSuccess | AdvancementFailure

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

function exactIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 512
}

function validRequest(request: FlowDocBackendCompositionAdvancementRequestV1): boolean {
  return validId(request.requestId) && validId(request.jobId)
    && Number.isInteger(request.expectedHeadRevision) && request.expectedHeadRevision >= 0
    && FINGERPRINT.test(request.expectedHeadFingerprint)
    && (request.demandFingerprint == null || FINGERPRINT.test(request.demandFingerprint))
    && (request.windowFingerprint == null || FINGERPRINT.test(request.windowFingerprint))
}

function validAttempt(attempt: FlowDocBackendCompositionAdvancementAttemptV1): boolean {
  return validId(attempt.attemptId) && validId(attempt.leaseToken)
    && exactIso(attempt.acquiredAt) && exactIso(attempt.completedAt) && exactIso(attempt.leaseExpiresAt)
    && Date.parse(attempt.completedAt) >= Date.parse(attempt.acquiredAt)
    && Date.parse(attempt.leaseExpiresAt) > Date.parse(attempt.completedAt)
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

function failure(
  status: AdvancementFailure["status"],
  issues: FlowDocBackendCompositionContractIssue[],
  requestFingerprint: string | null,
  jobHead: FlowDocBackendCompositionJobHeadV1 | null = null,
): AdvancementFailure {
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_ADVANCEMENT_V1_SOURCE,
    status,
    requestFingerprint,
    jobHead: jobHead == null ? null : cloneCompositionJson(jobHead),
    receipt: null,
    windowRef: null,
    pageChunkRef: null,
    issues,
  }
}

function coreIssues(
  prefix: string,
  issues: readonly { code: string; message: string; path: string }[],
): FlowDocBackendCompositionContractIssue[] {
  return issues.map((item) => compositionIssue(
    item.code,
    `${prefix}${item.path.length === 0 ? "" : `.${item.path}`}`,
    item.message,
  ))
}

function finalizeHead(
  context: FlowDocBackendCompositionRepositoryContextV1,
  head: FlowDocBackendCompositionJobHeadV1,
  changes: Partial<Omit<FlowDocBackendCompositionJobHeadV1, "fingerprint">>,
) {
  const { fingerprint: _fingerprint, ...facts } = head
  return finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin: context.sourcePin,
    manifest: context.manifest,
    value: { ...facts, ...changes },
  })
}

async function exactReplay(
  repository: FlowDocBackendCompositionRepositoryV1,
  context: FlowDocBackendCompositionRepositoryContextV1,
  request: FlowDocBackendCompositionAdvancementRequestV1,
  requestFingerprint: string,
): Promise<AdvancementSuccess | AdvancementFailure | null> {
  const committed = await repository.readCommittedRequest({ jobId: request.jobId, requestId: request.requestId })
  if (committed.status === "invalid") return failure("failed", committed.issues, requestFingerprint)
  if (committed.status === "not-found") return null
  if (committed.requestFingerprint !== requestFingerprint) return failure("conflict", [compositionIssue(
    "composition-transition-request-conflict",
    "request.requestId",
    "transition request id was already committed with different content",
  )], requestFingerprint)
  const retained = await repository.readImmutable({
    jobId: committed.receiptRef.jobId,
    recordId: committed.receiptRef.recordId,
  })
  if (retained.status !== "found") return failure("failed", [compositionIssue(
    "composition-transition-replay-receipt-missing",
    "request.requestId",
    "committed transition replay requires its retained receipt",
  ), ...retained.issues], requestFingerprint, committed.head)
  const parsed = parseFlowDocBackendCompositionTransitionReceiptV1({
    sourcePin: context.sourcePin,
    manifest: context.manifest,
    value: retained.value,
  })
  if (parsed.status === "blocked") return failure("failed", parsed.issues, requestFingerprint, committed.head)
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_ADVANCEMENT_V1_SOURCE,
    status: "idempotent-replay",
    requestFingerprint,
    jobHead: cloneCompositionJson(committed.head),
    receipt: cloneCompositionJson(parsed.receipt),
    windowRef: cloneCompositionJson(parsed.receipt.windowRef),
    pageChunkRef: cloneCompositionJson(parsed.receipt.pageChunkRef),
    issues: [],
  }
}

async function clearLease(
  repository: FlowDocBackendCompositionRepositoryV1,
  context: FlowDocBackendCompositionRepositoryContextV1,
  leasedHead: FlowDocBackendCompositionJobHeadV1,
  completedAt: string,
  blocker: { code: string; message: string; path: string; retryable: boolean },
  terminal: boolean,
) {
  const next = finalizeHead(context, leasedHead, {
    headRevision: leasedHead.headRevision + 1,
    status: terminal ? "blocked" : leasedHead.status,
    demand: terminal ? null : leasedHead.demand,
    lease: null,
    blocker: { ...blocker, message: blocker.message.slice(0, 512), path: blocker.path.slice(0, 512), recordedAt: completedAt },
    updatedAt: completedAt,
  })
  if (next.status === "blocked") return { status: "invalid" as const, head: null, issues: next.issues }
  return repository.compareAndSwapHead({
    jobId: leasedHead.jobId,
    expectedHeadRevision: leasedHead.headRevision,
    expectedHeadFingerprint: leasedHead.fingerprint,
    nextHead: next.jobHead,
  })
}

export async function advanceFlowDocBackendCompositionV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  request: FlowDocBackendCompositionAdvancementRequestV1
  attempt: FlowDocBackendCompositionAdvancementAttemptV1
  window: unknown | null
}): Promise<FlowDocBackendCompositionAdvancementResultV1> {
  if (!validRequest(input.request) || !validAttempt(input.attempt)) return failure("blocked", [compositionIssue(
    "composition-advancement-request-invalid",
    "request",
    "advancement request and attempt identities, fingerprints, revisions, and times must be valid",
  )], null)
  const parsedWindow = input.window == null ? null : parseVNextCompositionFragmentWindowV1(input.window)
  if (parsedWindow?.status === "blocked") return failure("blocked", coreIssues("window", parsedWindow.issues), null)
  const window = parsedWindow?.window ?? null
  if ((window?.fingerprint ?? null) !== input.request.windowFingerprint) return failure("blocked", [compositionIssue(
    "composition-advancement-window-fingerprint-mismatch",
    "request.windowFingerprint",
    "request window fingerprint must equal the supplied exact window",
  )], null)
  const requestFingerprint = compositionFingerprint({
    source: FLOWDOC_BACKEND_COMPOSITION_ADVANCEMENT_V1_SOURCE,
    contractVersion: 1,
    ...input.request,
  })
  const read = await input.repository.readHead(input.request.jobId)
  if (read.status !== "found") return failure("failed", read.issues, requestFingerprint)
  const replay = await exactReplay(input.repository, read.context, input.request, requestFingerprint)
  if (replay != null) return replay
  const head = read.head
  if (
    head.headRevision !== input.request.expectedHeadRevision
    || head.fingerprint !== input.request.expectedHeadFingerprint
  ) return failure("stale", [compositionIssue(
    "composition-advancement-head-stale",
    "request.expectedHeadRevision",
    "advancement request does not target the current exact job head",
  )], requestFingerprint, head)
  if (head.lease != null) return failure("busy", [compositionIssue(
    "composition-advancement-lease-active",
    "jobHead.lease",
    "the current job head already has an active lease",
  )], requestFingerprint, head)
  if (head.status !== "waiting-window" && head.status !== "ready-to-advance") return failure("blocked", [compositionIssue(
    "composition-advancement-status-invalid",
    "jobHead.status",
    "only waiting-window or ready-to-advance jobs can advance",
  )], requestFingerprint, head)
  if (head.retry.retryAfter != null && Date.parse(input.attempt.acquiredAt) < Date.parse(head.retry.retryAfter)) {
    return failure("busy", [compositionIssue(
      "composition-advancement-retry-deferred",
      "jobHead.retry.retryAfter",
      "advancement cannot acquire a lease before the retained retry time",
    )], requestFingerprint, head)
  }
  if (Date.parse(input.attempt.acquiredAt) < Date.parse(head.updatedAt) || Date.parse(input.attempt.leaseExpiresAt) > Date.parse(head.expiresAt)) {
    return failure("blocked", [compositionIssue(
      "composition-advancement-lease-time-invalid",
      "attempt",
      "attempt lease must begin after the current head update and end before job expiry",
    )], requestFingerprint, head)
  }
  if (
    head.retry.attemptCount >= read.context.sourcePin.executionLimits.maximumAttemptCount
    || head.transitionNumber >= read.context.sourcePin.executionLimits.maximumTransitionCount
  ) return failure("blocked", [compositionIssue(
    "composition-advancement-limit-exceeded",
    "jobHead",
    "the pinned attempt or transition limit has been reached",
  )], requestFingerprint, head)

  if (head.status === "waiting-window") {
    if (
      head.demand == null || window == null
      || input.request.demandFingerprint !== head.demand.fingerprint
    ) return failure("rejected", [compositionIssue(
      "composition-advancement-demand-window-mismatch",
      "request",
      "waiting-window requires the current exact demand and one supplied family window",
    )], requestFingerprint, head)
  } else if (input.request.demandFingerprint != null || window != null) return failure("rejected", [compositionIssue(
    "composition-advancement-continuation-window-invalid",
    "request",
    "ready-to-advance requires exact null demand and null window continuation",
  )], requestFingerprint, head)

  const leased = finalizeHead(read.context, head, {
    headRevision: head.headRevision + 1,
    lease: {
      attemptId: input.attempt.attemptId,
      leaseToken: input.attempt.leaseToken,
      acquiredAt: input.attempt.acquiredAt,
      expiresAt: input.attempt.leaseExpiresAt,
    },
    retry: { attemptCount: head.retry.attemptCount + 1, retryAfter: null },
    blocker: null,
    updatedAt: input.attempt.acquiredAt,
  })
  if (leased.status === "blocked") return failure("failed", leased.issues, requestFingerprint, head)
  const acquired = await input.repository.compareAndSwapHead({
    jobId: head.jobId,
    expectedHeadRevision: head.headRevision,
    expectedHeadFingerprint: head.fingerprint,
    nextHead: leased.jobHead,
  })
  if (acquired.status !== "committed") {
    if (acquired.status === "stale") return failure("stale", acquired.issues, requestFingerprint, acquired.head)
    return failure(acquired.status === "conflict" ? "conflict" : "failed", acquired.issues, requestFingerprint)
  }
  const leasedHead = acquired.head
  const core = advanceVNextDocumentCompositionV1({
    manifest: read.context.manifest,
    cursor: head.cursor,
    openPage: head.openPage,
    window,
    limits: read.context.sourcePin.transitionLimits,
  })
  if (core.status === "blocked") {
    const retryable = core.reason === "window-rejected"
    const first = core.issues[0] ?? { code: core.reason, message: `core blocked ${core.reason}`, path: "" }
    const released = await clearLease(input.repository, read.context, leasedHead, input.attempt.completedAt, {
      code: first.code,
      message: first.message,
      path: first.path,
      retryable,
    }, !retryable)
    if (released.status !== "committed") return failure(
      released.status === "stale" ? "stale" : "failed",
      [...coreIssues("core", core.issues), ...released.issues],
      requestFingerprint,
      released.status === "stale" ? released.head : leasedHead,
    )
    return failure(retryable ? "rejected" : "blocked", coreIssues("core", core.issues), requestFingerprint, released.head)
  }

  const transitionNumber = head.transitionNumber + 1
  let windowRef: FlowDocBackendCompositionContentRefV1 | null = null
  let pageChunkRef: FlowDocBackendCompositionContentRefV1 | null = null
  const staged: { ref: FlowDocBackendCompositionContentRefV1; value: { fingerprint: string } }[] = []
  if (window != null) {
    windowRef = ref(head.jobId, "family-window", `window:${window.fingerprint.slice(7)}`, window)
    staged.push({ ref: windowRef, value: window })
  }
  if (core.closedPages.length > 0) {
    const chunk = finalizeFlowDocBackendCompositionPageChunkV1({
      sourcePin: read.context.sourcePin,
      manifest: read.context.manifest,
      value: {
        source: "flowdoc-backend-composition-page-chunk",
        schemaVersion: 1,
        kind: "composition-closed-page-chunk",
        jobId: head.jobId,
        transitionNumber,
        manifestFingerprint: head.manifestFingerprint,
        windowRef,
        previousChunkFingerprint: head.chain.closedPageChunkTipFingerprint,
        closedPrefixBeforeFingerprint: head.chain.closedPagePrefixFingerprint,
        closedPrefixAfterFingerprint: core.cursorAfter.closedPrefix.fingerprint,
        pageCountBefore: head.chain.pageCount,
        placementCountBefore: head.chain.placementCount,
        headingCountBefore: head.chain.headingCount,
        pages: core.closedPages,
        createdAt: input.attempt.completedAt,
      },
    })
    if (chunk.status === "blocked") {
      const released = await clearLease(input.repository, read.context, leasedHead, input.attempt.completedAt, {
        code: "composition-page-chunk-stage-invalid",
        message: chunk.issues[0]?.message ?? "page chunk staging failed",
        path: chunk.issues[0]?.path ?? "",
        retryable: true,
      }, false)
      return failure(
        "failed",
        [...chunk.issues, ...released.issues],
        requestFingerprint,
        released.status === "committed" ? released.head : leasedHead,
      )
    }
    pageChunkRef = ref(head.jobId, "closed-page-chunk", `chunk:${transitionNumber}:${chunk.pageChunk.fingerprint.slice(7)}`, chunk.pageChunk)
    staged.push({ ref: pageChunkRef, value: chunk.pageChunk })
  }

  for (const item of staged) {
    const stored = await input.repository.putImmutable(item)
    if (stored.status !== "written" && stored.status !== "idempotent-replay") {
      const released = await clearLease(input.repository, read.context, leasedHead, input.attempt.completedAt, {
        code: "composition-transition-staging-failed",
        message: stored.issues[0]?.message ?? "immutable transition staging failed",
        path: stored.issues[0]?.path ?? "",
        retryable: true,
      }, false)
      return failure("failed", [...stored.issues, ...released.issues], requestFingerprint, released.status === "committed" ? released.head : leasedHead)
    }
  }

  const receiptResult = finalizeFlowDocBackendCompositionTransitionReceiptV1({
    sourcePin: read.context.sourcePin,
    manifest: read.context.manifest,
    value: {
      source: "flowdoc-backend-composition-transition-receipt",
      schemaVersion: 1,
      kind: "composition-transition-receipt",
      jobId: head.jobId,
      transitionNumber,
      transitionRequestId: input.request.requestId,
      requestFingerprint,
      attemptId: input.attempt.attemptId,
      headRevisionBefore: leasedHead.headRevision,
      headRevisionAfter: leasedHead.headRevision + 1,
      manifestFingerprint: head.manifestFingerprint,
      demandBeforeFingerprint: head.demand?.fingerprint ?? null,
      windowRef,
      transitionFingerprint: core.fingerprint,
      cursorBeforeFingerprint: head.cursor.fingerprint,
      cursorAfterFingerprint: core.cursorAfter.fingerprint,
      openPageAfterFingerprint: core.openPageAfter?.fingerprint ?? null,
      demandAfterFingerprint: core.demand?.fingerprint ?? null,
      pageChunkRef,
      previousReceiptFingerprint: head.chain.transitionReceiptTipFingerprint,
      status: core.status,
      reason: core.reason,
      work: core.work,
      createdAt: input.attempt.completedAt,
    },
  })
  if (receiptResult.status === "blocked") {
    const released = await clearLease(input.repository, read.context, leasedHead, input.attempt.completedAt, {
      code: "composition-transition-receipt-invalid",
      message: receiptResult.issues[0]?.message ?? "transition receipt staging failed",
      path: receiptResult.issues[0]?.path ?? "",
      retryable: true,
    }, false)
    return failure(
      "failed",
      [...receiptResult.issues, ...released.issues],
      requestFingerprint,
      released.status === "committed" ? released.head : leasedHead,
    )
  }
  const receipt = receiptResult.receipt
  const receiptRef = ref(head.jobId, "transition-receipt", `receipt:${transitionNumber}:${receipt.fingerprint.slice(7)}`, receipt)
  const storedReceipt = await input.repository.putImmutable({ ref: receiptRef, value: receipt })
  if (storedReceipt.status !== "written" && storedReceipt.status !== "idempotent-replay") {
    const released = await clearLease(input.repository, read.context, leasedHead, input.attempt.completedAt, {
      code: "composition-transition-receipt-stage-failed",
      message: storedReceipt.issues[0]?.message ?? "transition receipt storage failed",
      path: storedReceipt.issues[0]?.path ?? "",
      retryable: true,
    }, false)
    return failure("failed", [...storedReceipt.issues, ...released.issues], requestFingerprint, released.status === "committed" ? released.head : leasedHead)
  }

  const status: FlowDocBackendCompositionJobStatusV1 = core.status === "complete"
    ? "ready-to-finalize"
    : core.reason === "output-limit" ? "ready-to-advance" : "waiting-window"
  const next = finalizeHead(read.context, leasedHead, {
    headRevision: leasedHead.headRevision + 1,
    status,
    transitionNumber,
    cursor: core.cursorAfter,
    openPage: core.openPageAfter,
    demand: core.demand,
    chain: {
      transitionReceiptTipFingerprint: receipt.fingerprint,
      closedPageChunkTipFingerprint: pageChunkRef?.recordFingerprint ?? head.chain.closedPageChunkTipFingerprint,
      closedPagePrefixFingerprint: core.cursorAfter.closedPrefix.fingerprint,
      pageCount: core.cursorAfter.closedPrefix.pageCount,
      placementCount: core.cursorAfter.closedPrefix.placementCount,
      headingCount: core.cursorAfter.closedPrefix.headingCount,
    },
    lease: null,
    blocker: null,
    updatedAt: input.attempt.completedAt,
  })
  if (next.status === "blocked") {
    const released = await clearLease(input.repository, read.context, leasedHead, input.attempt.completedAt, {
      code: "composition-transition-head-invalid",
      message: next.issues[0]?.message ?? "transition head commit failed validation",
      path: next.issues[0]?.path ?? "",
      retryable: true,
    }, false)
    return failure(
      "failed",
      [...next.issues, ...released.issues],
      requestFingerprint,
      released.status === "committed" ? released.head : leasedHead,
    )
  }
  const committed = await input.repository.compareAndSwapHead({
    jobId: head.jobId,
    expectedHeadRevision: leasedHead.headRevision,
    expectedHeadFingerprint: leasedHead.fingerprint,
    nextHead: next.jobHead,
    committedRequest: { requestId: input.request.requestId, requestFingerprint, receiptRef },
  })
  if (committed.status === "idempotent-replay") {
    const replayed = await exactReplay(input.repository, read.context, input.request, requestFingerprint)
    return replayed ?? failure("failed", [compositionIssue(
      "composition-transition-replay-missing",
      "request.requestId",
      "repository reported replay without retained request evidence",
    )], requestFingerprint, committed.head)
  }
  if (committed.status !== "committed") {
    if (committed.status === "stale") return failure("stale", committed.issues, requestFingerprint, committed.head)
    const released = await clearLease(input.repository, read.context, leasedHead, input.attempt.completedAt, {
      code: "composition-transition-commit-failed",
      message: committed.issues[0]?.message ?? "transition head commit failed",
      path: committed.issues[0]?.path ?? "",
      retryable: true,
    }, false)
    return failure(committed.status === "conflict" ? "conflict" : "failed", [...committed.issues, ...released.issues], requestFingerprint, released.status === "committed" ? released.head : leasedHead)
  }
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_ADVANCEMENT_V1_SOURCE,
    status: "advanced",
    requestFingerprint,
    jobHead: cloneCompositionJson(committed.head),
    receipt: cloneCompositionJson(receipt),
    windowRef: cloneCompositionJson(windowRef),
    pageChunkRef: cloneCompositionJson(pageChunkRef),
    issues: [],
  }
}
