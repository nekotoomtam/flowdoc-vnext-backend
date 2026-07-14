import { finalizeVNextDocumentCompositionManifestV1 } from "@flowdoc/vnext-core"
import { describe, expect, it } from "vitest"
import {
  advanceFlowDocBackendCompositionV1,
  compositionFingerprint,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  finalizeFlowDocBackendCompositionV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  initializeFlowDocBackendCompositionV1,
  loadFlowDocBackendCompositionChainV1,
  readFlowDocBackendCompositionProgressV1,
  type FlowDocBackendCompositionRepositoryV1,
} from "../index.js"
import {
  createCompositionSchedulerFixture,
  rebindCompositionSchedulerWaitingFixtureRetainedByteLimit,
} from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })

async function readyToFinalize(
  repository: FlowDocBackendCompositionRepositoryV1,
  fixture: Pick<ReturnType<typeof createCompositionSchedulerFixture>, "manifest" | "sourcePin" | "waitingHead" | "window">
    = createCompositionSchedulerFixture(),
) {
  await repository.createHead({
    createRequestId: "create-finalization",
    requestFingerprint: fp("create-finalization"),
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    head: fixture.waitingHead,
  })
  const advanced = await advanceFlowDocBackendCompositionV1({
    repository,
    request: {
      requestId: "advance-finalization",
      jobId: fixture.waitingHead.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      demandFingerprint: fixture.waitingHead.demand!.fingerprint,
      windowFingerprint: fixture.window.fingerprint,
    },
    attempt: {
      attemptId: "attempt-advance-finalization",
      leaseToken: "lease-advance-finalization",
      acquiredAt: "2026-07-13T08:01:00.000Z",
      completedAt: "2026-07-13T08:01:01.000Z",
      leaseExpiresAt: "2026-07-13T08:05:00.000Z",
    },
    window: fixture.window,
  })
  if (advanced.status !== "advanced") throw new Error(`advancement failed: ${advanced.status}`)
  return { fixture, head: advanced.jobHead }
}

function finalizationInput(
  repository: FlowDocBackendCompositionRepositoryV1,
  head: Awaited<ReturnType<typeof readyToFinalize>>["head"],
) {
  return {
    repository,
    request: {
      requestId: "finalize-document",
      jobId: head.jobId,
      expectedHeadRevision: head.headRevision,
      expectedHeadFingerprint: head.fingerprint,
    },
    attempt: {
      attemptId: "attempt-finalize-document",
      leaseToken: "lease-finalize-document",
      acquiredAt: "2026-07-13T08:02:00.000Z",
      completedAt: "2026-07-13T08:02:01.000Z",
      leaseExpiresAt: "2026-07-13T08:05:00.000Z",
    },
  }
}

function emptyManifest() {
  const base = createCompositionSchedulerFixture().manifest
  const { fingerprint: _fingerprint, ...facts } = base
  const result = finalizeVNextDocumentCompositionManifestV1({
    ...facts,
    documentId: "composition-empty-document",
    documentStructureFingerprint: fp("empty-structure"),
    resolvedProjectionFingerprint: fp("empty-projection"),
    bodyItems: [],
  })
  if (result.status === "blocked") throw new Error("empty manifest fixture blocked")
  return result.manifest
}

describe("durable composition scheduler finalization", () => {
  it("verifies the committed chain, publishes exact outputs, and replays them", async () => {
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const { fixture, head } = await readyToFinalize(repository)
    const input = finalizationInput(repository, head)
    const completed = await finalizeFlowDocBackendCompositionV1(input)
    expect(completed).toMatchObject({
      status: "completed",
      jobHead: {
        status: "completed",
        headRevision: 4,
        lease: null,
        finalOutput: {
          compositionFingerprint: expect.stringMatching(/^sha256:/u),
          pagePlanRef: { kind: "page-plan" },
          headingPageMapRef: { kind: "heading-page-map" },
        },
      },
      pagePlan: { summary: { pageCount: 1, placementCount: 1, headingCount: 1 } },
      headingPageMap: { pageCount: 1, entries: [{ headingNodeId: "text-root", pageNumber: 1 }] },
    })
    if (completed.status !== "completed") throw new Error("finalization failed")
    expect(completed.pagePlan.compositionFingerprint).toBe(completed.headingPageMap.documentPaginationFingerprint)
    await expect(finalizeFlowDocBackendCompositionV1({
      ...input,
      attempt: { ...input.attempt, attemptId: "attempt-finalize-replay", leaseToken: "lease-finalize-replay" },
    })).resolves.toEqual({ ...completed, status: "idempotent-replay" })
    await expect(finalizeFlowDocBackendCompositionV1({
      ...input,
      request: { ...input.request, expectedHeadFingerprint: completed.jobHead.fingerprint },
    })).resolves.toMatchObject({ status: "conflict" })
    await expect(readFlowDocBackendCompositionProgressV1({
      repository,
      jobId: completed.jobHead.jobId,
      currentSourceRevision: fixture.sourcePin.baseRevision,
      observedAt: "2026-07-13T08:03:00.000Z",
    })).resolves.toMatchObject({
      status: "ready",
      progress: { status: "completed", sourceCurrent: true, finalOutput: completed.jobHead.finalOutput },
    })
  })

  it("finalizes transition-zero pages retained during initialization", async () => {
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const manifest = emptyManifest()
    const packageFingerprint = fp("empty-package")
    const initialized = await initializeFlowDocBackendCompositionV1({
      repository,
      request: {
        requestId: "initialize-empty-finalization",
        jobId: "empty-finalization-job",
        documentId: manifest.documentId,
        baseRevision: 4,
        profiles: {
          layoutProfileId: "layout-profile-v1",
          measurementProfileId: "measurement-profile-v1",
          compositionProfileId: "composition-profile-v1",
        },
        transitionLimits: {
          maximumClosedPageCount: 4,
          maximumPlacementCount: 20,
          maximumFamilyPageCount: 4,
          maximumFamilyFragmentCount: 20,
        },
        executionLimits: {
          maximumTransitionCount: 100,
          maximumAttemptCount: 200,
          maximumRetainedByteCount: 10_000_000,
        },
        createdAt: "2026-07-13T08:00:00.000Z",
        expiresAt: "2026-07-14T08:00:00.000Z",
      },
      source: {
        currentRevision: 4,
        packageFingerprint,
        resolvedProjectionFingerprint: manifest.resolvedProjectionFingerprint,
        sourceSnapshot: {
          kind: "composition-source-snapshot",
          documentId: manifest.documentId,
          fingerprint: packageFingerprint,
        },
        manifest,
      },
    })
    expect(initialized).toMatchObject({
      status: "ready",
      jobHead: { status: "ready-to-finalize", transitionNumber: 0, chain: { pageCount: 1 } },
    })
    if (initialized.status !== "ready") throw new Error("empty initialization failed")
    await expect(finalizeFlowDocBackendCompositionV1({
      repository,
      request: {
        requestId: "finalize-empty-document",
        jobId: initialized.jobHead.jobId,
        expectedHeadRevision: initialized.jobHead.headRevision,
        expectedHeadFingerprint: initialized.jobHead.fingerprint,
      },
      attempt: {
        attemptId: "attempt-finalize-empty",
        leaseToken: "lease-finalize-empty",
        acquiredAt: "2026-07-13T08:01:00.000Z",
        completedAt: "2026-07-13T08:01:01.000Z",
        leaseExpiresAt: "2026-07-13T08:05:00.000Z",
      },
    })).resolves.toMatchObject({
      status: "completed",
      jobHead: { status: "completed", headRevision: 2 },
      pagePlan: { summary: { pageCount: 1, placementCount: 0, headingCount: 0 } },
      headingPageMap: { entries: [] },
    })
  })

  it("allows only one concurrent finalization lease winner", async () => {
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const { head } = await readyToFinalize(repository)
    const first = finalizationInput(repository, head)
    const second = {
      ...first,
      request: { ...first.request, requestId: "finalize-document-concurrent" },
      attempt: {
        ...first.attempt,
        attemptId: "attempt-finalize-concurrent",
        leaseToken: "lease-finalize-concurrent",
      },
    }
    const results = await Promise.all([
      finalizeFlowDocBackendCompositionV1(first),
      finalizeFlowDocBackendCompositionV1(second),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["completed", "stale"])
    await expect(repository.readHead(head.jobId)).resolves.toMatchObject({
      status: "found",
      head: { status: "completed", finalOutput: { pagePlanRef: { kind: "page-plan" } } },
    })
  })

  it("moves a missing committed chain to terminal blocked without output", async () => {
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const { head } = await readyToFinalize(base)
    const repository: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async readImmutableByFingerprint(input) {
        if (input.kind === "closed-page-chunk") return {
          status: "not-found",
          ref: null,
          value: null,
          issues: [{
            code: "test-missing-chain",
            message: "chunk missing",
            path: "recordFingerprint",
            severity: "error",
          }],
        }
        return base.readImmutableByFingerprint(input)
      },
    }
    await expect(finalizeFlowDocBackendCompositionV1(finalizationInput(repository, head))).resolves.toMatchObject({
      status: "blocked",
      jobHead: {
        status: "blocked",
        headRevision: 4,
        lease: null,
        finalOutput: null,
        blocker: { code: "test-missing-chain", retryable: false },
      },
    })
  })

  it("blocks a reachable chain whose retained-byte accounting drifts from the head", async () => {
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const { head } = await readyToFinalize(repository)
    const read = await repository.readHead(head.jobId)
    if (read.status !== "found") throw new Error("ready head missing")
    const { fingerprint: _fingerprint, ...facts } = head
    const drifted = finalizeFlowDocBackendCompositionJobHeadV1({
      sourcePin: read.context.sourcePin,
      manifest: read.context.manifest,
      value: {
        ...facts,
        retention: { ...facts.retention, byteCount: facts.retention.byteCount + 1 },
      },
    })
    if (drifted.status === "blocked") throw new Error("drifted head fixture invalid")
    await expect(loadFlowDocBackendCompositionChainV1({
      repository,
      context: read.context,
      head: drifted.jobHead,
    })).resolves.toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([expect.objectContaining({ code: "composition-retention-head-mismatch" })]),
    })
  })

  it("releases the finalization lease when immutable output storage fails", async () => {
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const { head } = await readyToFinalize(base)
    const repository: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async putImmutable(input) {
        if ((input.ref as { kind?: string }).kind === "page-plan") return {
          status: "invalid",
          ref: null,
          issues: [{
            code: "test-output-storage-failure",
            message: "output storage unavailable",
            path: "pagePlan",
            severity: "error",
          }],
        }
        return base.putImmutable(input)
      },
    }
    await expect(finalizeFlowDocBackendCompositionV1(finalizationInput(repository, head))).resolves.toMatchObject({
      status: "failed",
      jobHead: {
        status: "ready-to-finalize",
        headRevision: 4,
        lease: null,
        finalOutput: null,
        blocker: { code: "test-output-storage-failure", retryable: true },
      },
    })
  })

  it("blocks without publishing outputs when final artifacts exceed retained-byte quota", async () => {
    const probeRepository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const probe = await readyToFinalize(probeRepository)
    const limitedFixture = rebindCompositionSchedulerWaitingFixtureRetainedByteLimit(
      createCompositionSchedulerFixture(),
      probe.head.retention.byteCount + 1,
    )
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const outputWrites: string[] = []
    const repository: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async putImmutable(input) {
        const kind = (input.ref as { kind?: string }).kind
        if (kind === "page-plan" || kind === "heading-page-map") outputWrites.push(kind)
        return base.putImmutable(input)
      },
    }
    const { head } = await readyToFinalize(repository, limitedFixture)
    expect(head.retention).toEqual(probe.head.retention)
    const result = await finalizeFlowDocBackendCompositionV1(finalizationInput(repository, head))
    expect(result).toMatchObject({
      status: "blocked",
      jobHead: {
        status: "blocked",
        finalOutput: null,
        retention: head.retention,
        blocker: { code: "composition-retained-byte-limit-exceeded", retryable: false },
      },
      pagePlan: null,
      headingPageMap: null,
    })
    expect(outputWrites).toEqual([])
  })
})
