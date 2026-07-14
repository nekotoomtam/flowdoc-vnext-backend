import {
  cloneCompositionJson,
  compositionIssue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  finalizeFlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionJobHeadV1,
} from "./compositionSchedulerJobHead.js"
import {
  createFlowDocBackendCompositionProgressV1,
  type FlowDocBackendCompositionProgressV1,
} from "./compositionSchedulerProgress.js"
import type {
  FlowDocBackendCompositionRepositoryContextV1,
  FlowDocBackendCompositionRepositoryV1,
} from "./compositionSchedulerRepository.js"

export const FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE = "flowdoc-backend-composition-lifecycle"

export interface FlowDocBackendCompositionHeadExpectationV1 {
  jobId: string
  expectedHeadRevision: number
  expectedHeadFingerprint: string
}

export type FlowDocBackendCompositionLifecycleResultV1 =
  | {
      source: typeof FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE
      status: "updated" | "idempotent-replay" | "not-needed"
      jobHead: FlowDocBackendCompositionJobHeadV1
      issues: []
    }
  | {
      source: typeof FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE
      status: "stale" | "busy" | "blocked" | "failed"
      jobHead: FlowDocBackendCompositionJobHeadV1 | null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionProgressReadResultV1 =
  | {
      source: typeof FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE
      status: "ready"
      progress: FlowDocBackendCompositionProgressV1
      issues: []
    }
  | {
      source: typeof FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE
      status: "blocked" | "failed"
      progress: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

function exactIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function validExpectation(value: FlowDocBackendCompositionHeadExpectationV1): boolean {
  return value.jobId.trim().length > 0 && value.jobId.length <= 512
    && Number.isInteger(value.expectedHeadRevision) && value.expectedHeadRevision >= 0
    && FINGERPRINT.test(value.expectedHeadFingerprint)
}

function result(
  status: FlowDocBackendCompositionLifecycleResultV1["status"],
  head: FlowDocBackendCompositionJobHeadV1 | null,
  issues: FlowDocBackendCompositionContractIssue[] = [],
): FlowDocBackendCompositionLifecycleResultV1 {
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE,
    status,
    jobHead: head == null ? null : cloneCompositionJson(head),
    issues,
  } as FlowDocBackendCompositionLifecycleResultV1
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

async function readExact(
  repository: FlowDocBackendCompositionRepositoryV1,
  expectation: FlowDocBackendCompositionHeadExpectationV1,
) {
  if (!validExpectation(expectation)) return {
    status: "invalid" as const,
    context: null,
    head: null,
    issues: [compositionIssue(
      "composition-lifecycle-expectation-invalid",
      "expectation",
      "job id, expected revision, and expected fingerprint must be valid",
    )],
  }
  const read = await repository.readHead(expectation.jobId)
  if (read.status !== "found") return read
  if (
    read.head.headRevision !== expectation.expectedHeadRevision
    || read.head.fingerprint !== expectation.expectedHeadFingerprint
  ) return {
    status: "stale" as const,
    context: read.context,
    head: read.head,
    issues: [compositionIssue(
      "composition-lifecycle-head-stale",
      "expectation.expectedHeadRevision",
      "lifecycle request does not target the current exact job head",
    )],
  }
  return read
}

async function commit(
  repository: FlowDocBackendCompositionRepositoryV1,
  context: FlowDocBackendCompositionRepositoryContextV1,
  current: FlowDocBackendCompositionJobHeadV1,
  changes: Partial<Omit<FlowDocBackendCompositionJobHeadV1, "fingerprint">>,
): Promise<FlowDocBackendCompositionLifecycleResultV1> {
  const next = finalizeHead(context, current, {
    ...changes,
    headRevision: current.headRevision + 1,
  })
  if (next.status === "blocked") return result("failed", current, next.issues)
  const committed = await repository.compareAndSwapHead({
    jobId: current.jobId,
    expectedHeadRevision: current.headRevision,
    expectedHeadFingerprint: current.fingerprint,
    nextHead: next.jobHead,
  })
  if (committed.status === "committed") return result("updated", committed.head)
  if (committed.status === "stale") return result("stale", committed.head, committed.issues)
  return result("failed", current, committed.issues)
}

export async function recoverExpiredFlowDocBackendCompositionLeaseV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  expectation: FlowDocBackendCompositionHeadExpectationV1
  observedAt: string
  retryAfter: string | null
}): Promise<FlowDocBackendCompositionLifecycleResultV1> {
  if (!exactIso(input.observedAt) || (input.retryAfter != null && !exactIso(input.retryAfter))) return result("blocked", null, [
    compositionIssue("composition-lease-recovery-time-invalid", "observedAt", "recovery times must be exact ISO date-times"),
  ])
  const read = await readExact(input.repository, input.expectation)
  if (read.status === "stale") return result("stale", read.head, read.issues)
  if (read.status !== "found") return result("failed", null, read.issues)
  const head = read.head
  if (head.status === "expired") return result("idempotent-replay", head)
  if (head.lease == null) return result("not-needed", head)
  if (Date.parse(input.observedAt) < Date.parse(head.lease.expiresAt)) return result("busy", head, [compositionIssue(
    "composition-lease-still-active",
    "observedAt",
    "lease cannot be recovered before its exact expiry",
  )])
  if (Date.parse(input.observedAt) >= Date.parse(head.expiresAt)) return commit(input.repository, read.context, head, {
    status: "expired",
    demand: null,
    lease: null,
    retry: { ...head.retry, retryAfter: null },
    blocker: null,
    updatedAt: head.expiresAt,
  })
  if (input.retryAfter != null && (
    Date.parse(input.retryAfter) < Date.parse(input.observedAt)
    || Date.parse(input.retryAfter) > Date.parse(head.expiresAt)
  )) return result("blocked", head, [compositionIssue(
    "composition-lease-recovery-retry-time-invalid",
    "retryAfter",
    "retryAfter must fall between recovery and job expiry",
  )])
  return commit(input.repository, read.context, head, {
    lease: null,
    retry: { ...head.retry, retryAfter: input.retryAfter },
    blocker: {
      code: "composition-lease-expired",
      message: "worker lease expired before an accepted head commit",
      path: "lease",
      retryable: true,
      recordedAt: input.observedAt,
    },
    updatedAt: input.observedAt,
  })
}

export async function scheduleFlowDocBackendCompositionRetryV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  expectation: FlowDocBackendCompositionHeadExpectationV1
  scheduledAt: string
  retryAfter: string
}): Promise<FlowDocBackendCompositionLifecycleResultV1> {
  if (!exactIso(input.scheduledAt) || !exactIso(input.retryAfter)) return result("blocked", null, [compositionIssue(
    "composition-retry-time-invalid",
    "retryAfter",
    "retry schedule requires exact ISO date-times",
  )])
  const read = await readExact(input.repository, input.expectation)
  if (read.status === "stale") return result("stale", read.head, read.issues)
  if (read.status !== "found") return result("failed", null, read.issues)
  const head = read.head
  if (
    !["waiting-window", "ready-to-advance", "ready-to-finalize"].includes(head.status)
    || head.lease != null || head.blocker?.retryable !== true
  ) return result("blocked", head, [compositionIssue(
    "composition-retry-state-invalid",
    "jobHead",
    "retry scheduling requires an unleased active head with a retryable blocker",
  )])
  if (
    Date.parse(input.scheduledAt) < Date.parse(head.updatedAt)
    || Date.parse(input.retryAfter) <= Date.parse(input.scheduledAt)
    || Date.parse(input.retryAfter) > Date.parse(head.expiresAt)
  ) return result("blocked", head, [compositionIssue(
    "composition-retry-window-invalid",
    "retryAfter",
    "retry window must follow the current head update and remain within job lifetime",
  )])
  return commit(input.repository, read.context, head, {
    retry: { ...head.retry, retryAfter: input.retryAfter },
    updatedAt: input.scheduledAt,
  })
}

export async function cancelFlowDocBackendCompositionV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  expectation: FlowDocBackendCompositionHeadExpectationV1
  requestedAt: string
}): Promise<FlowDocBackendCompositionLifecycleResultV1> {
  if (!exactIso(input.requestedAt)) return result("blocked", null, [compositionIssue(
    "composition-cancellation-time-invalid",
    "requestedAt",
    "requestedAt must be an exact ISO date-time",
  )])
  const read = await readExact(input.repository, input.expectation)
  if (read.status === "stale") return result("stale", read.head, read.issues)
  if (read.status !== "found") return result("failed", null, read.issues)
  const head = read.head
  if (head.status === "cancelled") return result("idempotent-replay", head)
  if (["completed", "blocked", "expired"].includes(head.status)) return result("blocked", head, [compositionIssue(
    "composition-cancellation-state-invalid",
    "jobHead.status",
    "completed, blocked, or expired composition jobs cannot be cancelled",
  )])
  if (
    Date.parse(input.requestedAt) < Date.parse(head.updatedAt)
    || Date.parse(input.requestedAt) >= Date.parse(head.expiresAt)
  ) return result("blocked", head, [compositionIssue(
    "composition-cancellation-window-invalid",
    "requestedAt",
    "cancellation must occur after the current update and before job expiry",
  )])
  return commit(input.repository, read.context, head, {
    status: "cancelled",
    demand: null,
    lease: null,
    retry: { ...head.retry, retryAfter: null },
    blocker: null,
    updatedAt: input.requestedAt,
  })
}

export async function expireFlowDocBackendCompositionV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  expectation: FlowDocBackendCompositionHeadExpectationV1
  observedAt: string
}): Promise<FlowDocBackendCompositionLifecycleResultV1> {
  if (!exactIso(input.observedAt)) return result("blocked", null, [compositionIssue(
    "composition-expiry-time-invalid",
    "observedAt",
    "observedAt must be an exact ISO date-time",
  )])
  const read = await readExact(input.repository, input.expectation)
  if (read.status === "stale") return result("stale", read.head, read.issues)
  if (read.status !== "found") return result("failed", null, read.issues)
  const head = read.head
  if (head.status === "expired") return result("idempotent-replay", head)
  if (["completed", "blocked", "cancelled"].includes(head.status)) return result("blocked", head, [compositionIssue(
    "composition-expiry-state-invalid",
    "jobHead.status",
    "completed, blocked, or cancelled composition jobs cannot enter execution expiry",
  )])
  if (Date.parse(input.observedAt) < Date.parse(head.expiresAt)) return result("not-needed", head)
  return commit(input.repository, read.context, head, {
    status: "expired",
    demand: null,
    lease: null,
    retry: { ...head.retry, retryAfter: null },
    blocker: null,
    updatedAt: head.expiresAt,
  })
}

export async function readFlowDocBackendCompositionProgressV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  jobId: string
  currentSourceRevision: number
  observedAt: string
}): Promise<FlowDocBackendCompositionProgressReadResultV1> {
  const read = await input.repository.readHead(input.jobId)
  if (read.status !== "found") return {
    source: FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE,
    status: "failed",
    progress: null,
    issues: read.issues,
  }
  const projected = createFlowDocBackendCompositionProgressV1({
    context: { value: read.head, sourcePin: read.context.sourcePin, manifest: read.context.manifest },
    sourceCurrent: input.currentSourceRevision === read.context.sourcePin.baseRevision,
    observedAt: input.observedAt,
  })
  return projected.status === "ready"
    ? { source: FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE, status: "ready", progress: projected.progress, issues: [] }
    : { source: FLOWDOC_BACKEND_COMPOSITION_LIFECYCLE_V1_SOURCE, status: "blocked", progress: null, issues: projected.issues }
}
