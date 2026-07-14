import { describe, expect, it } from "vitest"
import {
  compositionFingerprint,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionJobHeadV1,
} from "../index.js"
import { contentRef, createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const fp = (value: string) => compositionFingerprint({ value })
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8")

function leasedHead(
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
  leaseToken: string,
): FlowDocBackendCompositionJobHeadV1 {
  const { fingerprint: _fingerprint, ...facts } = fixture.waitingHead
  const result = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    value: {
      ...facts,
      headRevision: 1,
      lease: {
        attemptId: `attempt-${leaseToken}`,
        leaseToken,
        acquiredAt: "2026-07-13T08:00:00.000Z",
        expiresAt: "2026-07-13T08:05:00.000Z",
      },
    },
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.jobHead
}

describe("durable composition scheduler repository", () => {
  it("stores immutable records with exact replay and rejects record-id conflicts", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const ref = contentRef(
      fixture.sourcePin.jobId,
      "closed-page-chunk",
      "chunk-contract-1",
      fixture.pageChunk.fingerprint,
      bytes(fixture.pageChunk),
    )
    await expect(repository.putImmutable({ ref, value: fixture.pageChunk })).resolves.toMatchObject({ status: "written" })
    await expect(repository.putImmutable({ ref, value: fixture.pageChunk })).resolves.toMatchObject({ status: "idempotent-replay" })
    await expect(repository.putImmutable({
      ref: { ...ref, recordFingerprint: fp("other-chunk") },
      value: { ...fixture.pageChunk, fingerprint: fp("other-chunk") },
    })).resolves.toMatchObject({ status: "conflict" })
    await expect(repository.putImmutable({
      ref: { ...ref, recordId: "chunk-contract-alias" },
      value: fixture.pageChunk,
    })).resolves.toMatchObject({
      status: "conflict",
      issues: [{ code: "composition-immutable-fingerprint-conflict" }],
    })

    const read = await repository.readImmutable({ jobId: ref.jobId, recordId: ref.recordId })
    expect(read).toMatchObject({ status: "found", ref, value: fixture.pageChunk })
    if (read.status !== "found") throw new Error("immutable record missing")
    ;(read.value as { jobId: string }).jobId = "mutated-read"
    await expect(repository.readImmutable({ jobId: ref.jobId, recordId: ref.recordId })).resolves.toMatchObject({
      value: { jobId: fixture.sourcePin.jobId },
    })
  })

  it("creates one exact head and commits lease plus transition through atomic CAS", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const createInput = {
      createRequestId: "create-request-1",
      requestFingerprint: fp("create-request-1"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    }
    await expect(repository.createHead(createInput)).resolves.toMatchObject({ status: "created", head: { headRevision: 0 } })
    await expect(repository.readHeadCreation(fixture.sourcePin.jobId)).resolves.toMatchObject({
      status: "found",
      createRequestId: createInput.createRequestId,
      requestFingerprint: createInput.requestFingerprint,
      head: fixture.waitingHead,
    })
    await expect(repository.createHead(createInput)).resolves.toMatchObject({ status: "idempotent-replay" })
    await expect(repository.createHead({ ...createInput, requestFingerprint: fp("different-create") })).resolves.toMatchObject({
      status: "conflict",
    })

    const chunkRef = contentRef(
      fixture.sourcePin.jobId,
      "closed-page-chunk",
      "chunk-1",
      fixture.pageChunk.fingerprint,
      bytes(fixture.pageChunk),
    )
    const receiptRef = contentRef(
      fixture.sourcePin.jobId,
      "transition-receipt",
      "receipt-1",
      fixture.receipt.fingerprint,
      bytes(fixture.receipt),
    )
    await expect(repository.putImmutable({ ref: chunkRef, value: fixture.pageChunk })).resolves.toMatchObject({ status: "written" })
    await expect(repository.putImmutable({ ref: receiptRef, value: fixture.receipt })).resolves.toMatchObject({ status: "written" })

    const lease = leasedHead(fixture, "lease-1")
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: lease,
    })).resolves.toMatchObject({ status: "committed", head: { headRevision: 1 } })

    const request = {
      requestId: fixture.receipt.transitionRequestId,
      requestFingerprint: fixture.receipt.requestFingerprint,
      receiptRef,
    }
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 1,
      expectedHeadFingerprint: lease.fingerprint,
      nextHead: fixture.readyToFinalizeHead,
      committedRequest: request,
    })).resolves.toMatchObject({ status: "committed", head: { headRevision: 2, status: "ready-to-finalize" } })
    const committedRead = await repository.readCommittedRequest({
      jobId: fixture.sourcePin.jobId,
      requestId: request.requestId,
    })
    expect(committedRead).toMatchObject({
      status: "found",
      requestFingerprint: request.requestFingerprint,
      receiptRef,
      head: { headRevision: 2 },
    })
    if (committedRead.status !== "found") throw new Error("committed request missing")
    committedRead.head.headRevision = 99
    await expect(repository.readCommittedRequest({
      jobId: fixture.sourcePin.jobId,
      requestId: request.requestId,
    })).resolves.toMatchObject({ status: "found", head: { headRevision: 2 } })
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 1,
      expectedHeadFingerprint: lease.fingerprint,
      nextHead: fixture.readyToFinalizeHead,
      committedRequest: request,
    })).resolves.toMatchObject({ status: "idempotent-replay", head: { headRevision: 2 } })
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 2,
      expectedHeadFingerprint: fixture.readyToFinalizeHead.fingerprint,
      nextHead: fixture.readyToFinalizeHead,
      committedRequest: { ...request, requestFingerprint: fp("conflict") },
    })).resolves.toMatchObject({ status: "conflict" })
  })

  it("allows only one concurrent CAS winner and returns the current head to the loser", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await repository.createHead({
      createRequestId: "create-race",
      requestFingerprint: fp("create-race"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    })
    const candidates = [leasedHead(fixture, "race-a"), leasedHead(fixture, "race-b")]
    const results = await Promise.all(candidates.map((nextHead) => repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead,
    })))
    expect(results.map((result) => result.status).sort()).toEqual(["committed", "stale"])
    expect(results.find((result) => result.status === "stale")).toMatchObject({ head: { headRevision: 1 } })
  })

  it("rejects retention accounting changes outside a committed content transition", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await repository.createHead({
      createRequestId: "create-retention-guard",
      requestFingerprint: fp("create-retention-guard"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    })
    const { fingerprint: _fingerprint, ...facts } = fixture.waitingHead
    const changed = finalizeFlowDocBackendCompositionJobHeadV1({
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      value: {
        ...facts,
        headRevision: 1,
        retention: {
          ...facts.retention,
          byteCount: facts.retention.byteCount + 1,
        },
      },
    })
    if (changed.status === "blocked") throw new Error("retention guard fixture invalid")
    await expect(repository.compareAndSwapHead({
      jobId: fixture.waitingHead.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: changed.jobHead,
    })).resolves.toMatchObject({
      status: "invalid",
      issues: [{ code: "composition-head-retention-mutation-invalid" }],
    })
  })

  it("keeps staged losing content unreachable while leaving the committed head unchanged", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await repository.createHead({
      createRequestId: "create-orphan",
      requestFingerprint: fp("create-orphan"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    })
    const lease = leasedHead(fixture, "winner")
    await repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: lease,
    })

    const orphan = { kind: "staged-family-window", fingerprint: fp("orphan") }
    const orphanRef = contentRef(fixture.sourcePin.jobId, "family-window", "orphan-window", orphan.fingerprint, bytes(orphan))
    await expect(repository.putImmutable({ ref: orphanRef, value: orphan })).resolves.toMatchObject({ status: "written" })
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: leasedHead(fixture, "loser"),
    })).resolves.toMatchObject({ status: "stale", head: { fingerprint: lease.fingerprint } })
    await expect(repository.readImmutable({ jobId: orphanRef.jobId, recordId: orphanRef.recordId })).resolves.toMatchObject({ status: "found" })
    await expect(repository.readHead(fixture.sourcePin.jobId)).resolves.toMatchObject({
      status: "found",
      head: {
        fingerprint: lease.fingerprint,
        chain: { transitionReceiptTipFingerprint: null, closedPageChunkTipFingerprint: null },
      },
    })
  })

  it("rejects a transition commit whose receipt is missing or not the next reachable tip", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await repository.createHead({
      createRequestId: "create-missing-receipt",
      requestFingerprint: fp("create-missing-receipt"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    })
    const lease = leasedHead(fixture, "missing-receipt")
    await repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: lease,
    })
    const missingRef = contentRef(
      fixture.sourcePin.jobId,
      "transition-receipt",
      "missing-receipt",
      fixture.receipt.fingerprint,
      bytes(fixture.receipt),
    )
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 1,
      expectedHeadFingerprint: lease.fingerprint,
      nextHead: fixture.readyToFinalizeHead,
      committedRequest: {
        requestId: "missing-request",
        requestFingerprint: fp("missing-request"),
        receiptRef: missingRef,
      },
    })).resolves.toMatchObject({
      status: "invalid",
      issues: [expect.objectContaining({ code: "composition-committed-receipt-invalid" })],
    })
  })
})
