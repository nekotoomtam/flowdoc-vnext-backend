import { describe, expect, it } from "vitest"
import {
  compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1,
  createFlowDocBackendCompositionHeadWithAvailabilityV1,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  decideFlowDocBackendCompositionTransientRetryV1,
  type FlowDocBackendCompositionRepositoryV1,
} from "../index.js"

describe("composition scheduler head persistence availability", () => {
  it("maps thrown head writes to bounded reconciliation facts without retrying", async () => {
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    let createAttempts = 0
    let compareAndSwapAttempts = 0
    const repository: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async createHead() {
        createAttempts += 1
        throw new Error("provider unavailable")
      },
      async compareAndSwapHead() {
        compareAndSwapAttempts += 1
        throw new Error("provider unavailable")
      },
    }
    const created = await createFlowDocBackendCompositionHeadWithAvailabilityV1(repository, {
      createRequestId: "create-unavailable",
      requestFingerprint: "ignored",
      sourcePin: null,
      manifest: null,
      head: null,
    })
    expect(created).toMatchObject({
      status: "unavailable",
      availability: {
        operation: "head-create",
        source: "adapter-exception",
        commitState: "unknown",
        retryable: true,
        retryAfterMilliseconds: 250,
        retryPolicy: {
          strategy: "exponential",
          reconcileBeforeRetry: true,
          maximumAttemptCount: 3,
          maximumDelayMilliseconds: 2_000,
        },
        reconcileWith: "create-request",
      },
    })
    if (created.status !== "unavailable") throw new Error("head availability fixture did not block")
    expect(decideFlowDocBackendCompositionTransientRetryV1({
      availability: created.availability,
      completedAttemptCount: 1,
    })).toEqual({ status: "retry", nextAttemptNumber: 2, delayMilliseconds: 250, reconcileWith: "create-request" })
    expect(decideFlowDocBackendCompositionTransientRetryV1({
      availability: created.availability,
      completedAttemptCount: 2,
    })).toEqual({ status: "retry", nextAttemptNumber: 3, delayMilliseconds: 500, reconcileWith: "create-request" })
    expect(decideFlowDocBackendCompositionTransientRetryV1({
      availability: created.availability,
      completedAttemptCount: 3,
    })).toEqual({ status: "exhausted", nextAttemptNumber: null, delayMilliseconds: null, reconcileWith: "create-request" })

    const common = {
      jobId: "availability-job",
      expectedHeadRevision: 0,
      expectedHeadFingerprint: "ignored",
      nextHead: null,
    }
    const fingerprint = `sha256:${"0".repeat(64)}`
    await expect(compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1(repository, common)).resolves.toMatchObject({
      status: "unavailable",
      availability: { reconcileWith: "head-read" },
    })
    await expect(compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1(repository, {
      ...common,
      committedRequest: {
        requestId: "transition-request",
        requestFingerprint: "ignored",
        receiptRef: {
          jobId: common.jobId,
          recordId: "receipt",
          kind: "transition-receipt",
          recordFingerprint: fingerprint,
          byteLength: 1,
        },
      },
    })).resolves.toMatchObject({
      status: "unavailable",
      availability: { reconcileWith: "committed-request" },
    })
    await expect(compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1(repository, {
      ...common,
      committedFinalization: {
        requestId: "finalization-request",
        requestFingerprint: "ignored",
        pagePlanRef: {
          jobId: common.jobId,
          recordId: "page-plan",
          kind: "page-plan",
          recordFingerprint: fingerprint,
          byteLength: 1,
        },
        headingPageMapRef: {
          jobId: common.jobId,
          recordId: "heading-page-map",
          kind: "heading-page-map",
          recordFingerprint: fingerprint,
          byteLength: 1,
        },
      },
    })).resolves.toMatchObject({
      status: "unavailable",
      availability: { reconcileWith: "committed-finalization" },
    })
    expect(createAttempts).toBe(1)
    expect(compareAndSwapAttempts).toBe(3)
  })
})
