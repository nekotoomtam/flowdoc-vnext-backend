import {
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  isCompositionRecord,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1,
  createFlowDocBackendCompositionHeadWithAvailabilityV1,
} from "./compositionSchedulerHeadPersistence.js"
import type { FlowDocBackendCompositionJobHeadV1 } from "./compositionSchedulerJobHead.js"
import {
  decideFlowDocBackendCompositionTransientRetryV1,
  FLOWDOC_BACKEND_COMPOSITION_DEFAULT_TRANSIENT_RETRY_AFTER_MS,
  FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_STORAGE_ATTEMPTS,
  FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_RETRY_AFTER_MS,
  type FlowDocBackendCompositionHeadUnavailableResultV1,
  type FlowDocBackendCompositionTransientAvailabilityV1,
} from "./compositionSchedulerProductionRepository.js"
import type { FlowDocBackendCompositionRepositoryV1 } from "./compositionSchedulerRepository.js"

export const FLOWDOC_BACKEND_COMPOSITION_WORKER_STORAGE_ATTEMPT_V1_SOURCE =
  "flowdoc-backend-composition-worker-storage-attempt"
export const FLOWDOC_BACKEND_COMPOSITION_MAX_RECONCILIATION_FAILURES = 3

type HeadCreateInput = Parameters<FlowDocBackendCompositionRepositoryV1["createHead"]>[0]
type HeadCompareAndSwapInput = Parameters<FlowDocBackendCompositionRepositoryV1["compareAndSwapHead"]>[0]

export type FlowDocBackendCompositionWorkerHeadMutationV1 =
  | { operation: "head-create"; input: HeadCreateInput }
  | { operation: "head-compare-and-swap"; input: HeadCompareAndSwapInput }

interface WorkerStorageAttemptBaseV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_WORKER_STORAGE_ATTEMPT_V1_SOURCE
  schemaVersion: 1
  kind: "composition-worker-storage-attempt"
  jobId: string
  mutationFingerprint: string
  fingerprint: string
  completedWriteAttemptCount: number
  reconciliationFailureCount: number
  availability: FlowDocBackendCompositionTransientAvailabilityV1
  unavailableAt: string
}

export interface FlowDocBackendCompositionWorkerReconcileStateV1 extends WorkerStorageAttemptBaseV1 {
  phase: "reconcile"
  reconcileNotBefore: string | null
}

export interface FlowDocBackendCompositionWorkerRetryReadyStateV1 extends WorkerStorageAttemptBaseV1 {
  phase: "retry-ready"
  nextWriteAttemptNumber: number
  retryNotBefore: string
}

export type FlowDocBackendCompositionWorkerStorageAttemptStateV1 =
  | FlowDocBackendCompositionWorkerReconcileStateV1
  | FlowDocBackendCompositionWorkerRetryReadyStateV1

export type FlowDocBackendCompositionWorkerAttemptStateResultV1 =
  | { status: "ready"; state: FlowDocBackendCompositionWorkerReconcileStateV1; issues: [] }
  | { status: "blocked"; state: null; issues: FlowDocBackendCompositionContractIssue[] }

type ReconciliationEvidence = FlowDocBackendCompositionTransientAvailabilityV1["reconcileWith"]

export type FlowDocBackendCompositionWorkerReconciliationResultV1 =
  | {
      status: "committed"
      evidence: ReconciliationEvidence
      state: FlowDocBackendCompositionWorkerReconcileStateV1
      jobHead: FlowDocBackendCompositionJobHeadV1
      issues: []
    }
  | {
      status: "retry-ready"
      evidence: ReconciliationEvidence
      state: FlowDocBackendCompositionWorkerRetryReadyStateV1
      jobHead: FlowDocBackendCompositionJobHeadV1 | null
      issues: []
    }
  | {
      status: "exhausted" | "superseded" | "conflict" | "failed" | "reconciliation-exhausted"
      evidence: ReconciliationEvidence
      state: FlowDocBackendCompositionWorkerReconcileStateV1
      jobHead: FlowDocBackendCompositionJobHeadV1 | null
      issues: FlowDocBackendCompositionContractIssue[]
    }
  | {
      status: "reconciliation-unavailable"
      evidence: ReconciliationEvidence
      state: FlowDocBackendCompositionWorkerReconcileStateV1
      jobHead: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionWorkerRetryResultV1 =
  | {
      status: "committed"
      state: FlowDocBackendCompositionWorkerRetryReadyStateV1
      jobHead: FlowDocBackendCompositionJobHeadV1
      issues: []
    }
  | {
      status: "unavailable"
      state: FlowDocBackendCompositionWorkerReconcileStateV1
      jobHead: null
      issues: FlowDocBackendCompositionContractIssue[]
    }
  | {
      status: "superseded" | "conflict" | "failed" | "blocked"
      state: FlowDocBackendCompositionWorkerRetryReadyStateV1
      jobHead: FlowDocBackendCompositionJobHeadV1 | null
      issues: FlowDocBackendCompositionContractIssue[]
    }

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

function exactIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
}

function validRef(value: unknown, jobId: string, kind: string): boolean {
  return isCompositionRecord(value)
    && value.jobId === jobId
    && value.kind === kind
    && validId(value.recordId)
    && typeof value.recordFingerprint === "string"
    && FINGERPRINT.test(value.recordFingerprint)
    && typeof value.byteLength === "number"
    && Number.isInteger(value.byteLength)
    && value.byteLength >= 0
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString()
}

function head(value: unknown): FlowDocBackendCompositionJobHeadV1 | null {
  if (
    !isCompositionRecord(value)
    || typeof value.jobId !== "string"
    || value.jobId.length === 0
    || value.jobId.length > 512
    || typeof value.headRevision !== "number"
    || !Number.isInteger(value.headRevision)
    || value.headRevision < 0
    || typeof value.fingerprint !== "string"
    || !FINGERPRINT.test(value.fingerprint)
  ) return null
  return value as unknown as FlowDocBackendCompositionJobHeadV1
}

function exactHeadIdentity(left: FlowDocBackendCompositionJobHeadV1, right: FlowDocBackendCompositionJobHeadV1): boolean {
  return left.jobId === right.jobId
    && left.headRevision === right.headRevision
    && left.fingerprint === right.fingerprint
}

function exactRefIdentity(left: unknown, right: unknown): boolean {
  if (!isCompositionRecord(left) || !isCompositionRecord(right)) return false
  return left.jobId === right.jobId
    && left.kind === right.kind
    && left.recordId === right.recordId
    && left.recordFingerprint === right.recordFingerprint
    && left.byteLength === right.byteLength
}

function mutationFacts(mutation: FlowDocBackendCompositionWorkerHeadMutationV1): {
  jobId: string
  fingerprint: string
  reconcileWith: ReconciliationEvidence
  nextHead: FlowDocBackendCompositionJobHeadV1
} | null {
  const nextHead = head(mutation.operation === "head-create" ? mutation.input.head : mutation.input.nextHead)
  if (nextHead == null) return null
  if (mutation.operation === "head-create") {
    if (
      nextHead.headRevision !== 0
      || !validId(mutation.input.createRequestId)
      || typeof mutation.input.requestFingerprint !== "string"
      || !FINGERPRINT.test(mutation.input.requestFingerprint)
    ) return null
    try {
      return {
        jobId: nextHead.jobId,
        fingerprint: compositionFingerprint({
          source: FLOWDOC_BACKEND_COMPOSITION_WORKER_STORAGE_ATTEMPT_V1_SOURCE,
          contractVersion: 1,
          mutation,
        }),
        reconcileWith: "create-request",
        nextHead,
      }
    } catch {
      return null
    }
  }
  if (
    mutation.input.jobId !== nextHead.jobId
    || !Number.isInteger(mutation.input.expectedHeadRevision)
    || mutation.input.expectedHeadRevision < 0
    || !FINGERPRINT.test(mutation.input.expectedHeadFingerprint)
    || nextHead.headRevision !== mutation.input.expectedHeadRevision + 1
    || (mutation.input.committedRequest != null && mutation.input.committedFinalization != null)
  ) return null
  if (mutation.input.committedRequest != null && (
    !validId(mutation.input.committedRequest.requestId)
    || !FINGERPRINT.test(mutation.input.committedRequest.requestFingerprint)
    || !validRef(mutation.input.committedRequest.receiptRef, mutation.input.jobId, "transition-receipt")
  )) return null
  if (mutation.input.committedFinalization != null && (
    !validId(mutation.input.committedFinalization.requestId)
    || !FINGERPRINT.test(mutation.input.committedFinalization.requestFingerprint)
    || !validRef(mutation.input.committedFinalization.pagePlanRef, mutation.input.jobId, "page-plan")
    || !validRef(
      mutation.input.committedFinalization.headingPageMapRef,
      mutation.input.jobId,
      "heading-page-map",
    )
  )) return null
  const reconcileWith = mutation.input.committedFinalization != null
    ? "committed-finalization"
    : mutation.input.committedRequest != null ? "committed-request" : "head-read"
  try {
    return {
      jobId: mutation.input.jobId,
      fingerprint: compositionFingerprint({
        source: FLOWDOC_BACKEND_COMPOSITION_WORKER_STORAGE_ATTEMPT_V1_SOURCE,
        contractVersion: 1,
        mutation,
      }),
      reconcileWith,
      nextHead,
    }
  } catch {
    return null
  }
}

function validAvailability(
  availability: FlowDocBackendCompositionTransientAvailabilityV1,
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1,
  facts: NonNullable<ReturnType<typeof mutationFacts>>,
): boolean {
  return availability.kind === "transient-storage"
    && availability.operation === mutation.operation
    && availability.commitState === "unknown"
    && availability.retryable === true
    && availability.retryAfterMilliseconds === FLOWDOC_BACKEND_COMPOSITION_DEFAULT_TRANSIENT_RETRY_AFTER_MS
    && availability.retryPolicy.strategy === "exponential"
    && availability.retryPolicy.reconcileBeforeRetry === true
    && availability.retryPolicy.maximumAttemptCount === FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_STORAGE_ATTEMPTS
    && availability.retryPolicy.maximumDelayMilliseconds === FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_RETRY_AFTER_MS
    && availability.reconcileWith === facts.reconcileWith
}

function invalidStateIssue(): FlowDocBackendCompositionContractIssue[] {
  return [compositionIssue(
    "composition-worker-storage-attempt-invalid",
    "state",
    "worker storage state must match one exact mutation, availability lane, attempt budget, and time",
  )]
}

function validBaseState(
  state: FlowDocBackendCompositionWorkerStorageAttemptStateV1,
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1,
  facts: NonNullable<ReturnType<typeof mutationFacts>>,
): boolean {
  let exactFingerprint = false
  try {
    const { fingerprint, ...stateFacts } = state
    exactFingerprint = fingerprint === compositionFingerprint(stateFacts)
  } catch {
    return false
  }
  return state.source === FLOWDOC_BACKEND_COMPOSITION_WORKER_STORAGE_ATTEMPT_V1_SOURCE
    && state.schemaVersion === 1
    && state.kind === "composition-worker-storage-attempt"
    && state.jobId === facts.jobId
    && state.mutationFingerprint === facts.fingerprint
    && exactFingerprint
    && Number.isInteger(state.completedWriteAttemptCount)
    && state.completedWriteAttemptCount >= 1
    && state.completedWriteAttemptCount <= state.availability.retryPolicy.maximumAttemptCount
    && Number.isInteger(state.reconciliationFailureCount)
    && state.reconciliationFailureCount >= 0
    && state.reconciliationFailureCount <= FLOWDOC_BACKEND_COMPOSITION_MAX_RECONCILIATION_FAILURES
    && exactIso(state.unavailableAt)
    && validAvailability(state.availability, mutation, facts)
}

function finalizedState<T extends Omit<FlowDocBackendCompositionWorkerStorageAttemptStateV1, "fingerprint">>(
  state: T,
): T & { fingerprint: string } {
  return { ...state, fingerprint: compositionFingerprint(state) }
}

export function createFlowDocBackendCompositionWorkerStorageAttemptV1(input: {
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1
  unavailable: FlowDocBackendCompositionHeadUnavailableResultV1
  completedWriteAttemptCount: number
  unavailableAt: string
}): FlowDocBackendCompositionWorkerAttemptStateResultV1 {
  const facts = mutationFacts(input.mutation)
  if (
    facts == null
    || !exactIso(input.unavailableAt)
    || !Number.isInteger(input.completedWriteAttemptCount)
    || input.completedWriteAttemptCount < 1
    || input.completedWriteAttemptCount > input.unavailable.availability.retryPolicy.maximumAttemptCount
    || !validAvailability(input.unavailable.availability, input.mutation, facts)
  ) return { status: "blocked", state: null, issues: invalidStateIssue() }
  return {
    status: "ready",
    state: finalizedState({
      source: FLOWDOC_BACKEND_COMPOSITION_WORKER_STORAGE_ATTEMPT_V1_SOURCE,
      schemaVersion: 1,
      kind: "composition-worker-storage-attempt",
      phase: "reconcile",
      jobId: facts.jobId,
      mutationFingerprint: facts.fingerprint,
      completedWriteAttemptCount: input.completedWriteAttemptCount,
      reconciliationFailureCount: 0,
      availability: cloneCompositionJson(input.unavailable.availability),
      unavailableAt: input.unavailableAt,
      reconcileNotBefore: null,
    }),
    issues: [],
  }
}

function retryOrExhausted(
  state: FlowDocBackendCompositionWorkerReconcileStateV1,
  observedHead: FlowDocBackendCompositionJobHeadV1 | null,
): FlowDocBackendCompositionWorkerReconciliationResultV1 {
  const decision = decideFlowDocBackendCompositionTransientRetryV1({
    availability: state.availability,
    completedAttemptCount: state.completedWriteAttemptCount,
  })
  if (decision.status === "exhausted") return {
    status: "exhausted",
    evidence: state.availability.reconcileWith,
    state,
    jobHead: observedHead == null ? null : cloneCompositionJson(observedHead),
    issues: [compositionIssue(
      "composition-worker-storage-attempts-exhausted",
      "state.completedWriteAttemptCount",
      "exact reconciliation found no committed mutation after the bounded write attempt budget",
    )],
  }
  const {
    fingerprint: _fingerprint,
    reconcileNotBefore: _reconcileNotBefore,
    ...baseState
  } = state
  return {
    status: "retry-ready",
    evidence: state.availability.reconcileWith,
    state: finalizedState({
      ...baseState,
      phase: "retry-ready",
      nextWriteAttemptNumber: decision.nextAttemptNumber,
      retryNotBefore: addMilliseconds(state.unavailableAt, decision.delayMilliseconds),
    }),
    jobHead: observedHead == null ? null : cloneCompositionJson(observedHead),
    issues: [],
  }
}

function reconciliationReadUnavailable(
  state: FlowDocBackendCompositionWorkerReconcileStateV1,
  observedAt: string,
): FlowDocBackendCompositionWorkerReconciliationResultV1 {
  const failureCount = state.reconciliationFailureCount + 1
  const { fingerprint: _fingerprint, ...stateFacts } = state
  const nextState: FlowDocBackendCompositionWorkerReconcileStateV1 = finalizedState({
    ...stateFacts,
    reconciliationFailureCount: failureCount,
    reconcileNotBefore: failureCount >= FLOWDOC_BACKEND_COMPOSITION_MAX_RECONCILIATION_FAILURES
      ? null
      : addMilliseconds(
          observedAt,
          Math.min(
            FLOWDOC_BACKEND_COMPOSITION_DEFAULT_TRANSIENT_RETRY_AFTER_MS * 2 ** (failureCount - 1),
            FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_RETRY_AFTER_MS,
          ),
        ),
  })
  const exhausted = failureCount >= FLOWDOC_BACKEND_COMPOSITION_MAX_RECONCILIATION_FAILURES
  return {
    status: exhausted ? "reconciliation-exhausted" : "reconciliation-unavailable",
    evidence: state.availability.reconcileWith,
    state: nextState,
    jobHead: null,
    issues: [compositionIssue(
      exhausted
        ? "composition-worker-reconciliation-exhausted"
        : "composition-worker-reconciliation-unavailable",
      "repository",
      exhausted
        ? "reconciliation reads exhausted without asserting the head write outcome"
        : "reconciliation read ended with unavailable storage and must be retried without another write",
    )],
  }
}

function committed(
  state: FlowDocBackendCompositionWorkerReconcileStateV1,
  headValue: FlowDocBackendCompositionJobHeadV1,
): FlowDocBackendCompositionWorkerReconciliationResultV1 {
  return {
    status: "committed",
    evidence: state.availability.reconcileWith,
    state,
    jobHead: cloneCompositionJson(headValue),
    issues: [],
  }
}

function terminal(
  status: "superseded" | "conflict" | "failed",
  state: FlowDocBackendCompositionWorkerReconcileStateV1,
  headValue: FlowDocBackendCompositionJobHeadV1 | null,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionWorkerReconciliationResultV1 {
  return {
    status,
    evidence: state.availability.reconcileWith,
    state,
    jobHead: headValue == null ? null : cloneCompositionJson(headValue),
    issues,
  }
}

export async function reconcileFlowDocBackendCompositionWorkerStorageAttemptV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1
  state: FlowDocBackendCompositionWorkerReconcileStateV1
  observedAt: string
}): Promise<FlowDocBackendCompositionWorkerReconciliationResultV1> {
  const facts = mutationFacts(input.mutation)
  if (
    facts == null
    || !validBaseState(input.state, input.mutation, facts)
    || input.state.phase !== "reconcile"
    || !exactIso(input.observedAt)
    || Date.parse(input.observedAt) < Date.parse(input.state.unavailableAt)
    || (input.state.reconcileNotBefore != null && (
      !exactIso(input.state.reconcileNotBefore)
      || Date.parse(input.observedAt) < Date.parse(input.state.reconcileNotBefore)
    ))
  ) return terminal("failed", input.state, null, invalidStateIssue())
  if (input.state.reconciliationFailureCount >= FLOWDOC_BACKEND_COMPOSITION_MAX_RECONCILIATION_FAILURES) {
    return {
      status: "reconciliation-exhausted",
      evidence: input.state.availability.reconcileWith,
      state: input.state,
      jobHead: null,
      issues: [compositionIssue(
        "composition-worker-reconciliation-exhausted",
        "state.reconciliationFailureCount",
        "reconciliation state already exhausted its bounded read failure budget",
      )],
    }
  }

  try {
    if (input.mutation.operation === "head-create") {
      const read = await input.repository.readHeadCreation(facts.jobId)
      if (read.status === "invalid") return terminal("failed", input.state, null, read.issues)
      if (read.status === "not-found") return retryOrExhausted(input.state, null)
      if (
        read.createRequestId === input.mutation.input.createRequestId
        && read.requestFingerprint === input.mutation.input.requestFingerprint
        && exactHeadIdentity(read.head, facts.nextHead)
      ) return committed(input.state, read.head)
      return terminal("conflict", input.state, read.head, [compositionIssue(
        "composition-worker-create-reconciliation-conflict",
        "mutation.input.createRequestId",
        "stored head creation identity does not match the exact worker mutation",
      )])
    }

    const mutationInput = input.mutation.input
    if (facts.reconcileWith === "head-read") {
      const read = await input.repository.readHead(facts.jobId)
      if (read.status !== "found") return terminal("failed", input.state, null, read.issues)
      if (exactHeadIdentity(read.head, facts.nextHead)) return committed(input.state, read.head)
      if (
        read.head.headRevision === mutationInput.expectedHeadRevision
        && read.head.fingerprint === mutationInput.expectedHeadFingerprint
      ) return retryOrExhausted(input.state, read.head)
      return terminal("superseded", input.state, read.head, [compositionIssue(
        "composition-worker-head-reconciliation-superseded",
        "jobHead",
        "current head is neither the expected head nor the exact proposed next head",
      )])
    }

    if (facts.reconcileWith === "committed-request") {
      const request = mutationInput.committedRequest
      if (request == null) return terminal("failed", input.state, null, invalidStateIssue())
      const read = await input.repository.readCommittedRequest({ jobId: facts.jobId, requestId: request.requestId })
      if (read.status === "invalid") return terminal("failed", input.state, null, read.issues)
      if (read.status === "not-found") return retryOrExhausted(input.state, null)
      if (
        read.requestFingerprint === request.requestFingerprint
        && exactRefIdentity(read.receiptRef, request.receiptRef)
        && exactHeadIdentity(read.head, facts.nextHead)
      ) return committed(input.state, read.head)
      return terminal("conflict", input.state, read.head, [compositionIssue(
        "composition-worker-request-reconciliation-conflict",
        "mutation.input.committedRequest",
        "committed request evidence does not match the exact worker mutation",
      )])
    }

    const request = mutationInput.committedFinalization
    if (request == null) return terminal("failed", input.state, null, invalidStateIssue())
    const read = await input.repository.readCommittedFinalization({ jobId: facts.jobId, requestId: request.requestId })
    if (read.status === "invalid") return terminal("failed", input.state, null, read.issues)
    if (read.status === "not-found") return retryOrExhausted(input.state, null)
    if (
      read.requestFingerprint === request.requestFingerprint
      && exactRefIdentity(read.pagePlanRef, request.pagePlanRef)
      && exactRefIdentity(read.headingPageMapRef, request.headingPageMapRef)
      && exactHeadIdentity(read.head, facts.nextHead)
    ) return committed(input.state, read.head)
    return terminal("conflict", input.state, read.head, [compositionIssue(
      "composition-worker-finalization-reconciliation-conflict",
      "mutation.input.committedFinalization",
      "committed finalization evidence does not match the exact worker mutation",
    )])
  } catch {
    return reconciliationReadUnavailable(input.state, input.observedAt)
  }
}

export async function retryFlowDocBackendCompositionWorkerStorageAttemptV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1
  state: FlowDocBackendCompositionWorkerRetryReadyStateV1
  startedAt: string
}): Promise<FlowDocBackendCompositionWorkerRetryResultV1> {
  const facts = mutationFacts(input.mutation)
  const decision = facts == null ? null : decideFlowDocBackendCompositionTransientRetryV1({
    availability: input.state.availability,
    completedAttemptCount: input.state.completedWriteAttemptCount,
  })
  if (
    facts == null
    || !validBaseState(input.state, input.mutation, facts)
    || input.state.phase !== "retry-ready"
    || decision == null
    || decision.status !== "retry"
    || input.state.nextWriteAttemptNumber !== decision.nextAttemptNumber
    || input.state.retryNotBefore !== addMilliseconds(input.state.unavailableAt, decision.delayMilliseconds)
    || !exactIso(input.startedAt)
    || Date.parse(input.startedAt) < Date.parse(input.state.retryNotBefore)
  ) return {
    status: "blocked",
    state: input.state,
    jobHead: null,
    issues: invalidStateIssue(),
  }
  if (
    facts.nextHead.lease != null
    && (
      Date.parse(input.startedAt) < Date.parse(facts.nextHead.lease.acquiredAt)
      || Date.parse(input.startedAt) >= Date.parse(facts.nextHead.lease.expiresAt)
    )
  ) return {
    status: "blocked",
    state: input.state,
    jobHead: null,
    issues: [compositionIssue(
      "composition-worker-retry-lease-window-invalid",
      "mutation.input.nextHead.lease",
      "exact lease acquisition retry must start within the proposed lease window",
    )],
  }

  const write = input.mutation.operation === "head-create"
    ? await createFlowDocBackendCompositionHeadWithAvailabilityV1(input.repository, input.mutation.input)
    : await compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1(input.repository, input.mutation.input)
  if (write.status === "unavailable") {
    const next = createFlowDocBackendCompositionWorkerStorageAttemptV1({
      mutation: input.mutation,
      unavailable: write,
      completedWriteAttemptCount: input.state.nextWriteAttemptNumber,
      unavailableAt: input.startedAt,
    })
    return next.status === "ready"
      ? { status: "unavailable", state: next.state, jobHead: null, issues: write.issues }
      : { status: "failed", state: input.state, jobHead: null, issues: next.issues }
  }
  if (write.status === "created" || write.status === "committed" || write.status === "idempotent-replay") {
    if (!exactHeadIdentity(write.head, facts.nextHead)) return {
      status: "failed",
      state: input.state,
      jobHead: write.head,
      issues: [compositionIssue(
        "composition-worker-retry-head-mismatch",
        "repository",
        "successful exact retry returned a head different from the proposed next head",
      )],
    }
    return { status: "committed", state: input.state, jobHead: cloneCompositionJson(write.head), issues: [] }
  }
  if (write.status === "stale") return {
    status: "superseded",
    state: input.state,
    jobHead: cloneCompositionJson(write.head),
    issues: write.issues,
  }
  return {
    status: write.status === "conflict" ? "conflict" : "failed",
    state: input.state,
    jobHead: null,
    issues: write.issues,
  }
}
