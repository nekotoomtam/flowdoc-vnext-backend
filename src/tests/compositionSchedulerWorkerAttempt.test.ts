import { describe, expect, it } from "vitest"
import {
  compositionFingerprint,
  createFlowDocBackendCompositionHeadUnavailableResultV1,
  createFlowDocBackendCompositionWorkerStorageAttemptV1,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  reconcileFlowDocBackendCompositionWorkerStorageAttemptV1,
  retryFlowDocBackendCompositionWorkerStorageAttemptV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionRepositoryV1,
  type FlowDocBackendCompositionWorkerHeadMutationV1,
} from "../index.js"
import { createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })
const unavailableAt = "2026-07-13T08:02:00.000Z"

function leasedHead(
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
  token: string,
): FlowDocBackendCompositionJobHeadV1 {
  const { fingerprint: _fingerprint, ...facts } = fixture.waitingHead
  const result = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    value: {
      ...facts,
      headRevision: 1,
      lease: {
        attemptId: `attempt-${token}`,
        leaseToken: token,
        acquiredAt: "2026-07-13T08:01:00.000Z",
        expiresAt: "2026-07-13T08:05:00.000Z",
      },
      retry: { attemptCount: 1, retryAfter: null },
      updatedAt: "2026-07-13T08:01:00.000Z",
    },
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.jobHead
}

function createMutation(
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
): FlowDocBackendCompositionWorkerHeadMutationV1 {
  return {
    operation: "head-create",
    input: {
      createRequestId: "worker-create-request",
      requestFingerprint: fp("worker-create-request"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    },
  }
}

function casMutation(
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
  nextHead = leasedHead(fixture, "worker"),
): FlowDocBackendCompositionWorkerHeadMutationV1 {
  return {
    operation: "head-compare-and-swap",
    input: {
      jobId: fixture.waitingHead.jobId,
      expectedHeadRevision: fixture.waitingHead.headRevision,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead,
    },
  }
}

function pending(
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1,
  completedWriteAttemptCount = 1,
) {
  const reconcileWith = mutation.operation === "head-create"
    ? "create-request"
    : mutation.input.committedFinalization != null
      ? "committed-finalization"
      : mutation.input.committedRequest != null ? "committed-request" : "head-read"
  const unavailable = createFlowDocBackendCompositionHeadUnavailableResultV1({
    operation: mutation.operation,
    reconcileWith,
    message: "test unavailable",
  })
  const result = createFlowDocBackendCompositionWorkerStorageAttemptV1({
    mutation,
    unavailable,
    completedWriteAttemptCount,
    unavailableAt,
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.state
}

describe("composition scheduler worker storage attempt", () => {
  it("reconciles creation identity before an exact bounded retry", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const mutation = createMutation(fixture)
    const reconciled = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: pending(mutation),
      observedAt: unavailableAt,
    })
    expect(reconciled).toMatchObject({
      status: "retry-ready",
      evidence: "create-request",
      state: { nextWriteAttemptNumber: 2, retryNotBefore: "2026-07-13T08:02:00.250Z" },
    })
    if (reconciled.status !== "retry-ready") throw new Error("creation retry was not ready")
    await expect(retryFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: reconciled.state,
      startedAt: "2026-07-13T08:02:00.249Z",
    })).resolves.toMatchObject({ status: "blocked" })
    await expect(retryFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: reconciled.state,
      startedAt: reconciled.state.retryNotBefore,
    })).resolves.toMatchObject({ status: "committed", jobHead: fixture.waitingHead })

    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: pending(mutation, 3),
      observedAt: unavailableAt,
    })).resolves.toMatchObject({ status: "committed", evidence: "create-request" })
  })

  it("reads exact head evidence before retry, exhaustion, or supersession", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await repository.createHead(createMutation(fixture).input as Parameters<FlowDocBackendCompositionRepositoryV1["createHead"]>[0])
    const mutation = casMutation(fixture)
    const before = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: pending(mutation),
      observedAt: unavailableAt,
    })
    expect(before).toMatchObject({ status: "retry-ready", evidence: "head-read", jobHead: fixture.waitingHead })
    if (before.status !== "retry-ready") throw new Error("CAS retry was not ready")
    await expect(retryFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: before.state,
      startedAt: "2026-07-13T08:05:00.000Z",
    })).resolves.toMatchObject({
      status: "blocked",
      issues: [{ code: "composition-worker-retry-lease-window-invalid" }],
    })
    await expect(retryFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: before.state,
      startedAt: before.state.retryNotBefore,
    })).resolves.toMatchObject({ status: "committed" })
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: pending(mutation, 3),
      observedAt: unavailableAt,
    })).resolves.toMatchObject({ status: "committed", evidence: "head-read" })

    const untouched = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await untouched.createHead(createMutation(fixture).input as Parameters<FlowDocBackendCompositionRepositoryV1["createHead"]>[0])
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository: untouched,
      mutation,
      state: pending(mutation, 3),
      observedAt: unavailableAt,
    })).resolves.toMatchObject({ status: "exhausted", jobHead: fixture.waitingHead })

    const other = casMutation(fixture, leasedHead(fixture, "other"))
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation: other,
      state: pending(other),
      observedAt: unavailableAt,
    })).resolves.toMatchObject({ status: "superseded" })
  })

  it("uses committed request and finalization indices as exact evidence", async () => {
    const fixture = createCompositionSchedulerFixture()
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const receiptRef = {
      jobId: fixture.waitingHead.jobId,
      kind: "transition-receipt" as const,
      recordId: "worker-receipt",
      recordFingerprint: fp("worker-receipt"),
      byteLength: 10,
    }
    const transitionMutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
      operation: "head-compare-and-swap",
      input: {
        jobId: fixture.waitingHead.jobId,
        expectedHeadRevision: 1,
        expectedHeadFingerprint: fp("leased-head"),
        nextHead: fixture.readyToFinalizeHead,
        committedRequest: {
          requestId: "worker-transition",
          requestFingerprint: fp("worker-transition"),
          receiptRef,
        },
      },
    }
    const pagePlanRef = {
      jobId: fixture.waitingHead.jobId,
      kind: "page-plan" as const,
      recordId: "worker-plan",
      recordFingerprint: fp("worker-plan"),
      byteLength: 10,
    }
    const headingPageMapRef = {
      jobId: fixture.waitingHead.jobId,
      kind: "heading-page-map" as const,
      recordId: "worker-map",
      recordFingerprint: fp("worker-map"),
      byteLength: 10,
    }
    const completedHead = { ...fixture.readyToFinalizeHead, headRevision: 3 } as FlowDocBackendCompositionJobHeadV1
    const finalizationMutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
      operation: "head-compare-and-swap",
      input: {
        jobId: fixture.waitingHead.jobId,
        expectedHeadRevision: 2,
        expectedHeadFingerprint: fixture.readyToFinalizeHead.fingerprint,
        nextHead: completedHead,
        committedFinalization: {
          requestId: "worker-finalization",
          requestFingerprint: fp("worker-finalization"),
          pagePlanRef,
          headingPageMapRef,
        },
      },
    }
    const repository: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async readCommittedRequest() {
        return {
          status: "found",
          requestFingerprint: transitionMutation.operation === "head-compare-and-swap"
            ? transitionMutation.input.committedRequest!.requestFingerprint : "",
          receiptRef,
          head: fixture.readyToFinalizeHead,
          issues: [],
        }
      },
      async readCommittedFinalization() {
        return {
          status: "found",
          requestFingerprint: finalizationMutation.operation === "head-compare-and-swap"
            ? finalizationMutation.input.committedFinalization!.requestFingerprint : "",
          pagePlanRef,
          headingPageMapRef,
          head: completedHead,
          issues: [],
        }
      },
    }
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation: transitionMutation,
      state: pending(transitionMutation),
      observedAt: unavailableAt,
    })).resolves.toMatchObject({ status: "committed", evidence: "committed-request" })
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation: finalizationMutation,
      state: pending(finalizationMutation),
      observedAt: unavailableAt,
    })).resolves.toMatchObject({ status: "committed", evidence: "committed-finalization" })
  })

  it("bounds reconciliation read failures without consuming write attempts", async () => {
    const fixture = createCompositionSchedulerFixture()
    const mutation = casMutation(fixture)
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const repository: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async readHead() { throw new Error("read unavailable") },
    }
    const first = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: pending(mutation),
      observedAt: unavailableAt,
    })
    expect(first).toMatchObject({
      status: "reconciliation-unavailable",
      state: {
        completedWriteAttemptCount: 1,
        reconciliationFailureCount: 1,
        reconcileNotBefore: "2026-07-13T08:02:00.250Z",
      },
    })
    if (first.status !== "reconciliation-unavailable") throw new Error("first reconciliation did not defer")
    const second = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: first.state,
      observedAt: first.state.reconcileNotBefore!,
    })
    expect(second).toMatchObject({
      status: "reconciliation-unavailable",
      state: { completedWriteAttemptCount: 1, reconciliationFailureCount: 2 },
    })
    if (second.status !== "reconciliation-unavailable") throw new Error("second reconciliation did not defer")
    const third = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: second.state,
      observedAt: second.state.reconcileNotBefore!,
    })
    expect(third).toMatchObject({
      status: "reconciliation-exhausted",
      state: { completedWriteAttemptCount: 1, reconciliationFailureCount: 3 },
    })
    if (third.status !== "reconciliation-exhausted") throw new Error("reconciliation did not exhaust")
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation,
      state: third.state,
      observedAt: "2026-07-13T08:10:00.000Z",
    })).resolves.toMatchObject({
      status: "reconciliation-exhausted",
      state: { completedWriteAttemptCount: 1, reconciliationFailureCount: 3 },
    })
  })

  it("rejects mutation drift before reconciliation or retry", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await repository.createHead(createMutation(fixture).input as Parameters<FlowDocBackendCompositionRepositoryV1["createHead"]>[0])
    const original = casMutation(fixture)
    const drifted = casMutation(fixture, leasedHead(fixture, "drifted"))
    const restoredState = JSON.parse(JSON.stringify(pending(original))) as ReturnType<typeof pending>
    expect(restoredState.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation: original,
      state: restoredState,
      observedAt: unavailableAt,
    })).resolves.toMatchObject({ status: "retry-ready" })
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation: original,
      state: { ...restoredState, completedWriteAttemptCount: 2 },
      observedAt: unavailableAt,
    })).resolves.toMatchObject({
      status: "failed",
      issues: [{ code: "composition-worker-storage-attempt-invalid" }],
    })
    await expect(reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository,
      mutation: drifted,
      state: pending(original),
      observedAt: unavailableAt,
    })).resolves.toMatchObject({
      status: "failed",
      issues: [{ code: "composition-worker-storage-attempt-invalid" }],
    })

    const unavailable = createFlowDocBackendCompositionHeadUnavailableResultV1({
      operation: "head-compare-and-swap",
      reconcileWith: "head-read",
      message: "tampered policy",
    })
    unavailable.availability.retryPolicy.maximumAttemptCount = 4
    expect(createFlowDocBackendCompositionWorkerStorageAttemptV1({
      mutation: original,
      unavailable,
      completedWriteAttemptCount: 1,
      unavailableAt,
    })).toMatchObject({
      status: "blocked",
      issues: [{ code: "composition-worker-storage-attempt-invalid" }],
    })

    if (original.operation !== "head-compare-and-swap") throw new Error("CAS fixture changed operation")
    const malformed: FlowDocBackendCompositionWorkerHeadMutationV1 = {
      operation: "head-compare-and-swap",
      input: {
        ...original.input,
        committedRequest: {
          requestId: "",
          requestFingerprint: fp("malformed"),
          receiptRef: {
            jobId: fixture.sourcePin.jobId,
            kind: "transition-receipt",
            recordId: "malformed",
            recordFingerprint: fp("malformed-ref"),
            byteLength: 1,
          },
        },
      },
    }
    const malformedUnavailable = createFlowDocBackendCompositionHeadUnavailableResultV1({
      operation: "head-compare-and-swap",
      reconcileWith: "committed-request",
      message: "malformed mutation",
    })
    expect(createFlowDocBackendCompositionWorkerStorageAttemptV1({
      mutation: malformed,
      unavailable: malformedUnavailable,
      completedWriteAttemptCount: 1,
      unavailableAt,
    })).toMatchObject({ status: "blocked" })
  })
})
