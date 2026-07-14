import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  cancelFlowDocBackendCompositionV1,
  compositionFingerprint,
  createFlowDocBackendCompositionSqliteRepositoryV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  supportsFlowDocBackendCompositionSqliteCandidateV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionSqliteRepositoryV1,
} from "../index.js"
import { contentRef, createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

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

describe("composition scheduler SQLite repository candidate", () => {
  const roots: string[] = []
  const repositories: FlowDocBackendCompositionSqliteRepositoryV1[] = []

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      try {
        repository.close()
      } catch {
        // A test may close a repository before reopening it.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function open(root?: string) {
    const selectedRoot = root ?? mkdtempSync(join(tmpdir(), "flowdoc-composition-sqlite-"))
    if (root == null) roots.push(selectedRoot)
    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
      databasePath: join(selectedRoot, "composition.sqlite"),
    })
    repositories.push(repository)
    return { root: selectedRoot, repository }
  }

  it("keeps the candidate behind its explicit Node runtime floor", () => {
    expect(supportsFlowDocBackendCompositionSqliteCandidateV1("24.15.0")).toBe(true)
    expect(supportsFlowDocBackendCompositionSqliteCandidateV1("24.14.9")).toBe(false)
    expect(supportsFlowDocBackendCompositionSqliteCandidateV1("22.13.0")).toBe(false)
    expect(supportsFlowDocBackendCompositionSqliteCandidateV1()).toBe(true)
  })

  it("retains V1 head, transition replay, batch, and usage facts across connection restart", async () => {
    const fixture = createCompositionSchedulerFixture()
    const { root, repository } = await open()
    const createInput = {
      createRequestId: "create-sqlite-restart",
      requestFingerprint: fp("create-sqlite-restart"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    }
    await expect(repository.createHead(createInput)).resolves.toMatchObject({ status: "created" })

    const windowRef = contentRef(
      fixture.sourcePin.jobId,
      "family-window",
      "window-sqlite",
      fixture.window.fingerprint,
      bytes(fixture.window),
    )
    const chunkRef = contentRef(
      fixture.sourcePin.jobId,
      "closed-page-chunk",
      "chunk-sqlite",
      fixture.pageChunk.fingerprint,
      bytes(fixture.pageChunk),
    )
    const receiptRef = contentRef(
      fixture.sourcePin.jobId,
      "transition-receipt",
      "receipt-sqlite",
      fixture.receipt.fingerprint,
      bytes(fixture.receipt),
    )
    for (const [ref, value] of [
      [windowRef, fixture.window],
      [chunkRef, fixture.pageChunk],
      [receiptRef, fixture.receipt],
    ] as const) await expect(repository.putImmutable({ ref, value })).resolves.toMatchObject({ status: "written" })

    const lease = leasedHead(fixture, "sqlite-restart")
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: lease,
    })).resolves.toMatchObject({ status: "committed", head: { headRevision: 1 } })
    const committedRequest = {
      requestId: fixture.receipt.transitionRequestId,
      requestFingerprint: fixture.receipt.requestFingerprint,
      receiptRef,
    }
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 1,
      expectedHeadFingerprint: lease.fingerprint,
      nextHead: fixture.readyToFinalizeHead,
      committedRequest,
    })).resolves.toMatchObject({ status: "committed", head: { headRevision: 2 } })

    repository.close()
    const reopened = (await open(root)).repository
    await expect(reopened.readHead(fixture.sourcePin.jobId)).resolves.toMatchObject({
      status: "found",
      head: { status: "ready-to-finalize", headRevision: 2 },
    })
    await expect(reopened.readCommittedRequest({
      jobId: fixture.sourcePin.jobId,
      requestId: committedRequest.requestId,
    })).resolves.toMatchObject({
      status: "found",
      receiptRef,
      head: { headRevision: 2 },
    })
    await expect(reopened.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 1,
      expectedHeadFingerprint: lease.fingerprint,
      nextHead: fixture.readyToFinalizeHead,
      committedRequest,
    })).resolves.toMatchObject({ status: "idempotent-replay", head: { headRevision: 2 } })
    await expect(reopened.readImmutableBatch({
      jobId: fixture.sourcePin.jobId,
      refs: [receiptRef, chunkRef, windowRef],
    })).resolves.toMatchObject({
      status: "found",
      records: [
        { ref: receiptRef },
        { ref: chunkRef },
        { ref: windowRef },
      ],
    })
    await expect(reopened.inspectPhysicalUsage(fixture.sourcePin.jobId)).resolves.toMatchObject({
      status: "ready",
      usage: {
        recordCount: 3,
        byteCount: receiptRef.byteLength + chunkRef.byteLength + windowRef.byteLength,
      },
    })
  })

  it("admits physical bytes atomically and cleans only old unprotected records on a terminal head", async () => {
    const fixture = createCompositionSchedulerFixture()
    const { repository } = await open()
    const protectedValue = { fingerprint: fp("protected-physical-record") }
    const orphanValue = { fingerprint: fp("orphan-physical-record") }
    const rejectedValue = { fingerprint: fp("rejected-physical-record") }
    const protectedRef = contentRef(
      fixture.sourcePin.jobId,
      "source-snapshot",
      "protected-physical-record",
      protectedValue.fingerprint,
      bytes(protectedValue),
    )
    const orphanRef = contentRef(
      fixture.sourcePin.jobId,
      "family-window",
      "orphan-physical-record",
      orphanValue.fingerprint,
      bytes(orphanValue),
    )
    const rejectedRef = contentRef(
      fixture.sourcePin.jobId,
      "family-window",
      "rejected-physical-record",
      rejectedValue.fingerprint,
      bytes(rejectedValue),
    )
    await expect(repository.putImmutableWithPhysicalAdmission({
      ref: protectedRef,
      value: protectedValue,
      storedAt: "2026-07-13T07:00:00.000Z",
      maximumPhysicalByteCount: protectedRef.byteLength + orphanRef.byteLength,
    })).resolves.toMatchObject({ status: "written" })
    await expect(repository.putImmutableWithPhysicalAdmission({
      ref: orphanRef,
      value: orphanValue,
      storedAt: "2026-07-13T07:00:00.000Z",
      maximumPhysicalByteCount: protectedRef.byteLength + orphanRef.byteLength,
    })).resolves.toMatchObject({ status: "written" })
    await expect(repository.putImmutableWithPhysicalAdmission({
      ref: rejectedRef,
      value: rejectedValue,
      storedAt: "2026-07-13T07:00:00.000Z",
      maximumPhysicalByteCount: protectedRef.byteLength + orphanRef.byteLength,
    })).resolves.toMatchObject({
      status: "physical-quota-exceeded",
      usage: { recordCount: 2 },
    })

    await repository.createHead({
      createRequestId: "create-cleanup",
      requestFingerprint: fp("create-cleanup"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    })
    await expect(repository.cleanupUnreachable({
      jobId: fixture.sourcePin.jobId,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      reachableRefs: [protectedRef],
      storedBefore: "2026-07-13T08:00:00.000Z",
      maximumDeleteCount: 1,
    })).resolves.toMatchObject({
      status: "invalid",
      issues: [expect.objectContaining({ code: "composition-cleanup-active-job-blocked" })],
    })
    const requestedAt = new Date(Date.parse(fixture.waitingHead.updatedAt) + 1_000).toISOString()
    const cancelled = await cancelFlowDocBackendCompositionV1({
      repository,
      expectation: {
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: fixture.waitingHead.headRevision,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      },
      requestedAt,
    })
    expect(cancelled).toMatchObject({ status: "updated", jobHead: { status: "cancelled" } })
    if (cancelled.status !== "updated") throw new Error("cancelled head missing")
    await expect(repository.cleanupUnreachable({
      jobId: fixture.sourcePin.jobId,
      expectedHeadFingerprint: cancelled.jobHead.fingerprint,
      reachableRefs: [protectedRef],
      storedBefore: "2026-07-13T08:00:00.000Z",
      maximumDeleteCount: 1,
    })).resolves.toMatchObject({
      status: "completed",
      deletedRefs: [orphanRef],
      usage: { recordCount: 1, byteCount: protectedRef.byteLength },
    })
    await expect(repository.readImmutable({
      jobId: protectedRef.jobId,
      recordId: protectedRef.recordId,
    })).resolves.toMatchObject({ status: "found" })
    await expect(repository.readImmutable({
      jobId: orphanRef.jobId,
      recordId: orphanRef.recordId,
    })).resolves.toMatchObject({ status: "not-found" })
  })

  it("allows only one winner across independently opened SQLite handles", async () => {
    const fixture = createCompositionSchedulerFixture()
    const { root, repository } = await open()
    const other = (await open(root)).repository
    await repository.createHead({
      createRequestId: "create-two-handle-race",
      requestFingerprint: fp("create-two-handle-race"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    })
    const candidates = [leasedHead(fixture, "sqlite-race-a"), leasedHead(fixture, "sqlite-race-b")]
    const results = await Promise.all([
      repository.compareAndSwapHead({
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: 0,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
        nextHead: candidates[0],
      }),
      other.compareAndSwapHead({
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: 0,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
        nextHead: candidates[1],
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["committed", "stale"])
  })
})
