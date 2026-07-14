import {
  finalizeVNextDocumentCompositionV1,
  parseVNextDocumentCompositionPagePlanV1,
  parseVNextDocumentV4HeadingPageMap,
  type VNextDocumentCompositionPagePlanV1,
  type VNextDocumentV4HeadingPageMap,
} from "@flowdoc/vnext-core"
import { loadFlowDocBackendCompositionChainV1 } from "./compositionSchedulerChainReader.js"
import {
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  exactCompositionValue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  finalizeFlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionJobHeadV1,
} from "./compositionSchedulerJobHead.js"
import type {
  FlowDocBackendCompositionRepositoryContextV1,
  FlowDocBackendCompositionRepositoryV1,
} from "./compositionSchedulerRepository.js"
import type { FlowDocBackendCompositionContentRefV1 } from "./compositionSchedulerSourcePin.js"

export const FLOWDOC_BACKEND_COMPOSITION_FINALIZATION_V1_SOURCE = "flowdoc-backend-composition-finalization"

export interface FlowDocBackendCompositionFinalizationRequestV1 {
  requestId: string
  jobId: string
  expectedHeadRevision: number
  expectedHeadFingerprint: string
}

export interface FlowDocBackendCompositionFinalizationAttemptV1 {
  attemptId: string
  leaseToken: string
  acquiredAt: string
  completedAt: string
  leaseExpiresAt: string
}

type FinalizationSuccess = {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_FINALIZATION_V1_SOURCE
  status: "completed" | "idempotent-replay"
  requestFingerprint: string
  jobHead: FlowDocBackendCompositionJobHeadV1
  pagePlan: VNextDocumentCompositionPagePlanV1
  headingPageMap: VNextDocumentV4HeadingPageMap
  issues: []
}

type FinalizationFailure = {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_FINALIZATION_V1_SOURCE
  status: "stale" | "conflict" | "busy" | "blocked" | "failed"
  requestFingerprint: string | null
  jobHead: FlowDocBackendCompositionJobHeadV1 | null
  pagePlan: null
  headingPageMap: null
  issues: FlowDocBackendCompositionContractIssue[]
}

export type FlowDocBackendCompositionFinalizationResultV1 = FinalizationSuccess | FinalizationFailure

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

function exactIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function validId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 512
}

function validRequest(value: FlowDocBackendCompositionFinalizationRequestV1): boolean {
  return validId(value.requestId) && validId(value.jobId)
    && Number.isInteger(value.expectedHeadRevision) && value.expectedHeadRevision >= 0
    && FINGERPRINT.test(value.expectedHeadFingerprint)
}

function validAttempt(value: FlowDocBackendCompositionFinalizationAttemptV1): boolean {
  return validId(value.attemptId) && validId(value.leaseToken)
    && exactIso(value.acquiredAt) && exactIso(value.completedAt) && exactIso(value.leaseExpiresAt)
    && Date.parse(value.completedAt) >= Date.parse(value.acquiredAt)
    && Date.parse(value.leaseExpiresAt) > Date.parse(value.completedAt)
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
  status: FinalizationFailure["status"],
  issues: FlowDocBackendCompositionContractIssue[],
  requestFingerprint: string | null,
  head: FlowDocBackendCompositionJobHeadV1 | null = null,
): FinalizationFailure {
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_FINALIZATION_V1_SOURCE,
    status,
    requestFingerprint,
    jobHead: head == null ? null : cloneCompositionJson(head),
    pagePlan: null,
    headingPageMap: null,
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

async function releaseLease(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  context: FlowDocBackendCompositionRepositoryContextV1
  head: FlowDocBackendCompositionJobHeadV1
  completedAt: string
  issue: FlowDocBackendCompositionContractIssue
  terminal: boolean
}) {
  const next = finalizeHead(input.context, input.head, {
    headRevision: input.head.headRevision + 1,
    status: input.terminal ? "blocked" : "ready-to-finalize",
    lease: null,
    retry: { ...input.head.retry, retryAfter: null },
    blocker: {
      code: input.issue.code,
      message: input.issue.message.slice(0, 512),
      path: input.issue.path.slice(0, 512),
      retryable: !input.terminal,
      recordedAt: input.completedAt,
    },
    updatedAt: input.completedAt,
  })
  if (next.status === "blocked") return { status: "invalid" as const, head: null, issues: next.issues }
  return input.repository.compareAndSwapHead({
    jobId: input.head.jobId,
    expectedHeadRevision: input.head.headRevision,
    expectedHeadFingerprint: input.head.fingerprint,
    nextHead: next.jobHead,
  })
}

async function replay(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  context: FlowDocBackendCompositionRepositoryContextV1
  request: FlowDocBackendCompositionFinalizationRequestV1
  requestFingerprint: string
}): Promise<FinalizationSuccess | FinalizationFailure | null> {
  const retained = await input.repository.readCommittedFinalization({
    jobId: input.request.jobId,
    requestId: input.request.requestId,
  })
  if (retained.status === "invalid") return failure("failed", retained.issues, input.requestFingerprint)
  if (retained.status === "not-found") return null
  if (retained.requestFingerprint !== input.requestFingerprint) return failure("conflict", [compositionIssue(
    "composition-finalization-request-conflict",
    "request.requestId",
    "finalization request id was already committed with different content",
  )], input.requestFingerprint)
  const planRead = await input.repository.readImmutable({
    jobId: retained.pagePlanRef.jobId,
    recordId: retained.pagePlanRef.recordId,
  })
  const mapRead = await input.repository.readImmutable({
    jobId: retained.headingPageMapRef.jobId,
    recordId: retained.headingPageMapRef.recordId,
  })
  if (
    planRead.status !== "found" || mapRead.status !== "found"
    || !exactCompositionValue(planRead.ref, retained.pagePlanRef)
    || !exactCompositionValue(mapRead.ref, retained.headingPageMapRef)
  ) return failure("failed", [compositionIssue(
    "composition-finalization-replay-output-missing",
    "request.requestId",
    "committed finalization replay requires both exact retained outputs",
  )], input.requestFingerprint, retained.head)
  const plan = parseVNextDocumentCompositionPagePlanV1(planRead.value)
  const map = parseVNextDocumentV4HeadingPageMap(mapRead.value)
  if (plan.status === "blocked" || map.status === "blocked") return failure("failed", [
    ...(plan.status === "blocked" ? coreIssues("pagePlan", plan.issues) : []),
    ...(map.status === "blocked" ? coreIssues("headingPageMap", map.issues) : []),
  ], input.requestFingerprint, retained.head)
  if (
    retained.head.finalOutput == null
    || plan.plan.compositionFingerprint !== map.map.documentPaginationFingerprint
    || retained.head.finalOutput.compositionFingerprint !== plan.plan.compositionFingerprint
  ) return failure("failed", [compositionIssue(
    "composition-finalization-replay-owner-mismatch",
    "jobHead.finalOutput",
    "retained outputs and completed head must share one composition owner",
  )], input.requestFingerprint, retained.head)
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_FINALIZATION_V1_SOURCE,
    status: "idempotent-replay",
    requestFingerprint: input.requestFingerprint,
    jobHead: cloneCompositionJson(retained.head),
    pagePlan: cloneCompositionJson(plan.plan),
    headingPageMap: cloneCompositionJson(map.map),
    issues: [],
  }
}

export async function finalizeFlowDocBackendCompositionV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  request: FlowDocBackendCompositionFinalizationRequestV1
  attempt: FlowDocBackendCompositionFinalizationAttemptV1
}): Promise<FlowDocBackendCompositionFinalizationResultV1> {
  if (!validRequest(input.request) || !validAttempt(input.attempt)) return failure("blocked", [compositionIssue(
    "composition-finalization-input-invalid",
    "request",
    "finalization request and attempt identities, fingerprints, revisions, and times must be valid",
  )], null)
  const requestFingerprint = compositionFingerprint({
    source: FLOWDOC_BACKEND_COMPOSITION_FINALIZATION_V1_SOURCE,
    contractVersion: 1,
    ...input.request,
  })
  const read = await input.repository.readHead(input.request.jobId)
  if (read.status !== "found") return failure("failed", read.issues, requestFingerprint)
  const exactReplay = await replay({ repository: input.repository, context: read.context, request: input.request, requestFingerprint })
  if (exactReplay != null) return exactReplay
  const head = read.head
  if (
    head.headRevision !== input.request.expectedHeadRevision
    || head.fingerprint !== input.request.expectedHeadFingerprint
  ) return failure("stale", [compositionIssue(
    "composition-finalization-head-stale",
    "request.expectedHeadRevision",
    "finalization request does not target the current exact job head",
  )], requestFingerprint, head)
  if (head.status !== "ready-to-finalize") return failure("blocked", [compositionIssue(
    "composition-finalization-status-invalid",
    "jobHead.status",
    "only a ready-to-finalize job can produce authoritative output",
  )], requestFingerprint, head)
  if (head.lease != null) return failure("busy", [compositionIssue(
    "composition-finalization-lease-active",
    "jobHead.lease",
    "finalization cannot start while the exact head has a lease",
  )], requestFingerprint, head)
  if (head.retry.retryAfter != null && Date.parse(input.attempt.acquiredAt) < Date.parse(head.retry.retryAfter)) return failure("busy", [compositionIssue(
    "composition-finalization-retry-deferred",
    "jobHead.retry.retryAfter",
    "finalization cannot acquire a lease before the retained retry time",
  )], requestFingerprint, head)
  if (
    Date.parse(input.attempt.acquiredAt) < Date.parse(head.updatedAt)
    || Date.parse(input.attempt.leaseExpiresAt) > Date.parse(head.expiresAt)
    || head.retry.attemptCount >= read.context.sourcePin.executionLimits.maximumAttemptCount
  ) return failure("blocked", [compositionIssue(
    "composition-finalization-attempt-invalid",
    "attempt",
    "finalization attempt must fit the pinned lifetime and attempt limit",
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
  if (acquired.status !== "committed") return acquired.status === "stale"
    ? failure("stale", acquired.issues, requestFingerprint, acquired.head)
    : failure(acquired.status === "conflict" ? "conflict" : "failed", acquired.issues, requestFingerprint)
  const leasedHead = acquired.head

  const chain = await loadFlowDocBackendCompositionChainV1({
    repository: input.repository,
    context: read.context,
    head: leasedHead,
  })
  if (chain.status === "blocked") {
    const first = chain.issues[0] ?? compositionIssue("composition-chain-invalid", "chain", "committed chain validation failed")
    const released = await releaseLease({
      repository: input.repository,
      context: read.context,
      head: leasedHead,
      completedAt: input.attempt.completedAt,
      issue: first,
      terminal: true,
    })
    return failure("blocked", [...chain.issues, ...released.issues], requestFingerprint, released.status === "committed" ? released.head : leasedHead)
  }
  const core = finalizeVNextDocumentCompositionV1({
    manifest: read.context.manifest,
    terminalCursor: head.cursor,
    closedPages: chain.chain.pages,
  })
  if (core.status === "blocked") {
    const issues = coreIssues("core", core.issues)
    const first = issues[0] ?? compositionIssue("composition-core-finalization-blocked", "core", "core finalization blocked")
    const released = await releaseLease({
      repository: input.repository,
      context: read.context,
      head: leasedHead,
      completedAt: input.attempt.completedAt,
      issue: first,
      terminal: true,
    })
    return failure("blocked", [...issues, ...released.issues], requestFingerprint, released.status === "committed" ? released.head : leasedHead)
  }
  const planRef = ref(head.jobId, "page-plan", `plan:${core.plan.fingerprint.slice(7)}`, core.plan)
  const mapRef = ref(head.jobId, "heading-page-map", `heading-map:${core.headingPageMap.fingerprint.slice(7)}`, core.headingPageMap)
  for (const output of [{ ref: planRef, value: core.plan }, { ref: mapRef, value: core.headingPageMap }]) {
    const stored = await input.repository.putImmutable(output)
    if (stored.status !== "written" && stored.status !== "idempotent-replay") {
      const first = stored.issues[0] ?? compositionIssue("composition-finalization-storage-failed", "output", "output storage failed")
      const released = await releaseLease({
        repository: input.repository,
        context: read.context,
        head: leasedHead,
        completedAt: input.attempt.completedAt,
        issue: first,
        terminal: false,
      })
      return failure("failed", [...stored.issues, ...released.issues], requestFingerprint, released.status === "committed" ? released.head : leasedHead)
    }
  }
  const next = finalizeHead(read.context, leasedHead, {
    headRevision: leasedHead.headRevision + 1,
    status: "completed",
    lease: null,
    blocker: null,
    finalOutput: {
      compositionFingerprint: core.plan.compositionFingerprint,
      pagePlanRef: planRef,
      headingPageMapRef: mapRef,
    },
    updatedAt: input.attempt.completedAt,
  })
  if (next.status === "blocked") {
    const first = next.issues[0] ?? compositionIssue(
      "composition-finalization-head-invalid",
      "jobHead",
      "completed job head failed backend contract validation",
    )
    const released = await releaseLease({
      repository: input.repository,
      context: read.context,
      head: leasedHead,
      completedAt: input.attempt.completedAt,
      issue: first,
      terminal: true,
    })
    return failure(
      "blocked",
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
    committedFinalization: {
      requestId: input.request.requestId,
      requestFingerprint,
      pagePlanRef: planRef,
      headingPageMapRef: mapRef,
    },
  })
  if (committed.status === "idempotent-replay") {
    const exact = await replay({ repository: input.repository, context: read.context, request: input.request, requestFingerprint })
    return exact ?? failure("failed", [compositionIssue(
      "composition-finalization-replay-missing",
      "request.requestId",
      "repository reported finalization replay without retained outputs",
    )], requestFingerprint, committed.head)
  }
  if (committed.status !== "committed") {
    if (committed.status === "stale") return failure("stale", committed.issues, requestFingerprint, committed.head)
    const first = committed.issues[0] ?? compositionIssue("composition-finalization-commit-failed", "jobHead", "final output commit failed")
    const released = await releaseLease({
      repository: input.repository,
      context: read.context,
      head: leasedHead,
      completedAt: input.attempt.completedAt,
      issue: first,
      terminal: false,
    })
    return failure(committed.status === "conflict" ? "conflict" : "failed", [...committed.issues, ...released.issues], requestFingerprint, released.status === "committed" ? released.head : leasedHead)
  }
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_FINALIZATION_V1_SOURCE,
    status: "completed",
    requestFingerprint,
    jobHead: cloneCompositionJson(committed.head),
    pagePlan: cloneCompositionJson(core.plan),
    headingPageMap: cloneCompositionJson(core.headingPageMap),
    issues: [],
  }
}
