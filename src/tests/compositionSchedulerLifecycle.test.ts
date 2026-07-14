import { describe, expect, it } from "vitest"
import {
  advanceFlowDocBackendCompositionV1,
  cancelFlowDocBackendCompositionV1,
  compositionFingerprint,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  expireFlowDocBackendCompositionV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  readFlowDocBackendCompositionProgressV1,
  recoverExpiredFlowDocBackendCompositionLeaseV1,
  scheduleFlowDocBackendCompositionRetryV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionRepositoryV1,
} from "../index.js"
import { createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })

async function seed() {
  const fixture = createCompositionSchedulerFixture()
  const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
  await repository.createHead({
    createRequestId: "create-lifecycle",
    requestFingerprint: fp("create-lifecycle"),
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    head: fixture.waitingHead,
  })
  return { fixture, repository }
}

function expectation(head: FlowDocBackendCompositionJobHeadV1) {
  return {
    jobId: head.jobId,
    expectedHeadRevision: head.headRevision,
    expectedHeadFingerprint: head.fingerprint,
  }
}

function leased(fixture: ReturnType<typeof createCompositionSchedulerFixture>) {
  const { fingerprint: _fingerprint, ...facts } = fixture.waitingHead
  const result = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    value: {
      ...facts,
      headRevision: 1,
      lease: {
        attemptId: "attempt-abandoned",
        leaseToken: "lease-abandoned",
        acquiredAt: "2026-07-13T08:01:00.000Z",
        expiresAt: "2026-07-13T08:02:00.000Z",
      },
      retry: { attemptCount: 1, retryAfter: null },
      updatedAt: "2026-07-13T08:01:00.000Z",
    },
  })
  if (result.status === "blocked") throw new Error("leased lifecycle fixture invalid")
  return result.jobHead
}

describe("durable composition scheduler lifecycle", () => {
  it("returns head-read availability when a lifecycle CAS outcome is unknown", async () => {
    const { fixture, repository: base } = await seed()
    const repository: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async compareAndSwapHead() { throw new Error("provider unavailable") },
    }
    await expect(cancelFlowDocBackendCompositionV1({
      repository,
      expectation: expectation(fixture.waitingHead),
      requestedAt: "2026-07-13T08:01:00.000Z",
    })).resolves.toMatchObject({
      status: "unavailable",
      jobHead: null,
      availability: {
        operation: "head-compare-and-swap",
        commitState: "unknown",
        retryable: true,
        reconcileWith: "head-read",
      },
    })
  })

  it("recovers only an expired lease, retains backoff, and gates early advancement", async () => {
    const { fixture, repository } = await seed()
    const abandoned = leased(fixture)
    await repository.compareAndSwapHead({
      jobId: abandoned.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: abandoned,
    })
    await expect(recoverExpiredFlowDocBackendCompositionLeaseV1({
      repository,
      expectation: expectation(abandoned),
      observedAt: "2026-07-13T08:01:30.000Z",
      retryAfter: null,
    })).resolves.toMatchObject({ status: "busy", jobHead: { lease: { leaseToken: "lease-abandoned" } } })

    const recovered = await recoverExpiredFlowDocBackendCompositionLeaseV1({
      repository,
      expectation: expectation(abandoned),
      observedAt: "2026-07-13T08:03:00.000Z",
      retryAfter: "2026-07-13T08:04:00.000Z",
    })
    expect(recovered).toMatchObject({
      status: "updated",
      jobHead: {
        headRevision: 2,
        lease: null,
        retry: { attemptCount: 1, retryAfter: "2026-07-13T08:04:00.000Z" },
        blocker: { code: "composition-lease-expired", retryable: true },
      },
    })
    if (recovered.status !== "updated") throw new Error("lease recovery failed")
    await expect(advanceFlowDocBackendCompositionV1({
      repository,
      request: {
        requestId: "advance-before-retry",
        jobId: recovered.jobHead.jobId,
        expectedHeadRevision: recovered.jobHead.headRevision,
        expectedHeadFingerprint: recovered.jobHead.fingerprint,
        demandFingerprint: recovered.jobHead.demand!.fingerprint,
        windowFingerprint: fixture.window.fingerprint,
      },
      attempt: {
        attemptId: "attempt-too-early",
        leaseToken: "lease-too-early",
        acquiredAt: "2026-07-13T08:03:30.000Z",
        completedAt: "2026-07-13T08:03:31.000Z",
        leaseExpiresAt: "2026-07-13T08:05:00.000Z",
      },
      window: fixture.window,
    })).resolves.toMatchObject({ status: "busy", issues: [{ code: "composition-advancement-retry-deferred" }] })

    await expect(scheduleFlowDocBackendCompositionRetryV1({
      repository,
      expectation: expectation(recovered.jobHead),
      scheduledAt: "2026-07-13T08:03:30.000Z",
      retryAfter: "2026-07-13T08:05:00.000Z",
    })).resolves.toMatchObject({ status: "updated", jobHead: { headRevision: 3, retry: { retryAfter: "2026-07-13T08:05:00.000Z" } } })
  })

  it("cancels an active lease atomically and makes the old worker stale", async () => {
    const { fixture, repository } = await seed()
    const active = leased(fixture)
    await repository.compareAndSwapHead({
      jobId: active.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: active,
    })
    const cancelled = await cancelFlowDocBackendCompositionV1({
      repository,
      expectation: expectation(active),
      requestedAt: "2026-07-13T08:01:30.000Z",
    })
    expect(cancelled).toMatchObject({
      status: "updated",
      jobHead: { status: "cancelled", headRevision: 2, demand: null, lease: null },
    })
    if (cancelled.status !== "updated") throw new Error("cancellation failed")
    await expect(repository.compareAndSwapHead({
      jobId: active.jobId,
      expectedHeadRevision: active.headRevision,
      expectedHeadFingerprint: active.fingerprint,
      nextHead: active,
    })).resolves.toMatchObject({ status: "stale", head: { fingerprint: cancelled.jobHead.fingerprint } })
  })

  it("expires only after the pinned lifetime and projects source-aware progress", async () => {
    const { fixture, repository } = await seed()
    await expect(expireFlowDocBackendCompositionV1({
      repository,
      expectation: expectation(fixture.waitingHead),
      observedAt: "2026-07-13T09:00:00.000Z",
    })).resolves.toMatchObject({ status: "not-needed" })
    const expired = await expireFlowDocBackendCompositionV1({
      repository,
      expectation: expectation(fixture.waitingHead),
      observedAt: "2026-07-14T08:00:01.000Z",
    })
    expect(expired).toMatchObject({
      status: "updated",
      jobHead: { status: "expired", headRevision: 1, demand: null, lease: null, updatedAt: fixture.sourcePin.expiresAt },
    })
    if (expired.status !== "updated") throw new Error("expiry failed")
    await expect(readFlowDocBackendCompositionProgressV1({
      repository,
      jobId: expired.jobHead.jobId,
      currentSourceRevision: fixture.sourcePin.baseRevision + 1,
      observedAt: "2026-07-14T08:00:01.000Z",
    })).resolves.toMatchObject({
      status: "ready",
      progress: { status: "expired", sourceCurrent: false, demand: null, leaseExpiresAt: null },
    })
  })
})
