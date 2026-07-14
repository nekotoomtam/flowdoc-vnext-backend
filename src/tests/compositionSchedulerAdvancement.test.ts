import {
  finalizeVNextCompositionFragmentWindowV1,
  finalizeVNextDocumentCompositionManifestV1,
  initializeVNextDocumentCompositionV1,
} from "@flowdoc/vnext-core"
import { describe, expect, it } from "vitest"
import {
  advanceFlowDocBackendCompositionV1,
  compositionFingerprint,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  finalizeFlowDocBackendCompositionSourcePinV1,
  summarizeFlowDocBackendCompositionContentRefsV1,
  type FlowDocBackendCompositionAdvancementAttemptV1,
  type FlowDocBackendCompositionAdvancementRequestV1,
  type FlowDocBackendCompositionRepositoryV1,
} from "../index.js"
import {
  createCompositionSchedulerContinuationFixture,
  createCompositionSchedulerFixture,
  rebindCompositionSchedulerWaitingFixtureRetainedByteLimit,
} from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })

function attempt(suffix: string): FlowDocBackendCompositionAdvancementAttemptV1 {
  return {
    attemptId: `attempt-${suffix}`,
    leaseToken: `lease-${suffix}`,
    acquiredAt: "2026-07-13T08:01:00.000Z",
    completedAt: "2026-07-13T08:01:01.000Z",
    leaseExpiresAt: "2026-07-13T08:05:00.000Z",
  }
}

function request(
  requestId: string,
  head: ReturnType<typeof createCompositionSchedulerFixture>["waitingHead"],
  windowFingerprint: string | null,
): FlowDocBackendCompositionAdvancementRequestV1 {
  return {
    requestId,
    jobId: head.jobId,
    expectedHeadRevision: head.headRevision,
    expectedHeadFingerprint: head.fingerprint,
    demandFingerprint: head.demand?.fingerprint ?? null,
    windowFingerprint,
  }
}

async function seed(
  repository: FlowDocBackendCompositionRepositoryV1,
  fixture: Pick<ReturnType<typeof createCompositionSchedulerFixture>, "sourcePin" | "manifest" | "waitingHead">,
) {
  const created = await repository.createHead({
    createRequestId: `create-${fixture.waitingHead.jobId}`,
    requestFingerprint: fp(`create-${fixture.waitingHead.jobId}`),
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    head: fixture.waitingHead,
  })
  if (created.status !== "created") throw new Error(`fixture head not created: ${created.status}`)
}

function createTwoRootFixture() {
  const base = createCompositionSchedulerFixture()
  const { fingerprint: _manifestFingerprint, ...manifestFacts } = base.manifest
  const first = base.manifest.bodyItems[0]
  const secondMeasurement = fp("second-measurement")
  const manifestResult = finalizeVNextDocumentCompositionManifestV1({
    ...manifestFacts,
    bodyItems: [first, {
      ...first,
      itemIndex: 1,
      sourceOrder: 1,
      rootNodeId: "text-root-second",
      headingLevel: null,
      ownerPins: {
        ...first.ownerPins,
        familySource: fp("second-family-source"),
        measurement: secondMeasurement,
      },
      initialCursor: {
        ...first.initialCursor,
        rootNodeId: "text-root-second",
        ownerFingerprint: secondMeasurement,
        stateFingerprint: fp("second-initial-cursor"),
      },
    }],
  })
  if (manifestResult.status === "blocked") throw new Error("two-root manifest invalid")
  const manifest = manifestResult.manifest
  const { fingerprint: _sourcePinFingerprint, ...sourcePinFacts } = base.sourcePin
  const sourcePinResult = finalizeFlowDocBackendCompositionSourcePinV1({
    ...sourcePinFacts,
    manifestFingerprint: manifest.fingerprint,
    manifestRef: {
      ...sourcePinFacts.manifestRef,
      recordFingerprint: manifest.fingerprint,
      byteLength: Buffer.byteLength(JSON.stringify(manifest), "utf8"),
    },
  })
  if (sourcePinResult.status === "blocked") throw new Error("two-root source pin invalid")
  const sourcePin = sourcePinResult.sourcePin
  const initial = initializeVNextDocumentCompositionV1({
    manifest,
    limits: sourcePin.transitionLimits,
  })
  if (initial.status !== "partial" || initial.demand == null) throw new Error("two-root initialization missing demand")
  const headResult = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin,
    manifest,
    value: {
      source: "flowdoc-backend-composition-job-head",
      schemaVersion: 1,
      kind: "composition-job-head",
      jobId: sourcePin.jobId,
      headRevision: 0,
      sourcePinFingerprint: sourcePin.fingerprint,
      manifestFingerprint: manifest.fingerprint,
      status: "waiting-window",
      transitionNumber: 0,
      cursor: initial.cursorAfter,
      openPage: initial.openPageAfter,
      demand: initial.demand,
      chain: {
        transitionReceiptTipFingerprint: null,
        closedPageChunkTipFingerprint: null,
        closedPagePrefixFingerprint: null,
        pageCount: 0,
        placementCount: 0,
        headingCount: 0,
      },
      retention: summarizeFlowDocBackendCompositionContentRefsV1([
        sourcePin.sourceSnapshotRef,
        sourcePin.manifestRef,
      ]),
      lease: null,
      retry: { attemptCount: 0, retryAfter: null },
      blocker: null,
      finalOutput: null,
      createdAt: sourcePin.createdAt,
      updatedAt: sourcePin.createdAt,
      expiresAt: sourcePin.expiresAt,
    },
  })
  if (headResult.status === "blocked") throw new Error("two-root head invalid")
  return { manifest, sourcePin, waitingHead: headResult.jobHead, window: base.window }
}

describe("durable composition scheduler advancement", () => {
  it("commits one exact family window and replays the retained transition after the head advances", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await seed(repository, fixture)
    const exactRequest = request("advance-exact", fixture.waitingHead, fixture.window.fingerprint)
    const input = { repository, request: exactRequest, attempt: attempt("exact"), window: fixture.window }

    const advanced = await advanceFlowDocBackendCompositionV1(input)
    expect(advanced).toMatchObject({
      status: "advanced",
      jobHead: { headRevision: 2, transitionNumber: 1, status: "ready-to-finalize", lease: null },
      receipt: { transitionNumber: 1, demandBeforeFingerprint: fixture.waitingHead.demand?.fingerprint },
      windowRef: { kind: "family-window", recordFingerprint: fixture.window.fingerprint },
      pageChunkRef: { kind: "closed-page-chunk" },
    })
    if (advanced.status !== "advanced") throw new Error("exact advancement failed")
    await expect(repository.readImmutable({ jobId: advanced.windowRef!.jobId, recordId: advanced.windowRef!.recordId })).resolves.toMatchObject({ status: "found" })
    await expect(repository.readImmutable({ jobId: advanced.pageChunkRef!.jobId, recordId: advanced.pageChunkRef!.recordId })).resolves.toMatchObject({ status: "found" })

    await expect(advanceFlowDocBackendCompositionV1({
      ...input,
      attempt: attempt("replay"),
    })).resolves.toEqual({ ...advanced, status: "idempotent-replay" })
    await expect(advanceFlowDocBackendCompositionV1({
      ...input,
      request: { ...exactRequest, expectedHeadFingerprint: advanced.jobHead.fingerprint },
      attempt: attempt("conflict"),
    })).resolves.toMatchObject({ status: "conflict" })
  })

  it("advances demand-free structural continuation with an exact null window", async () => {
    const fixture = createCompositionSchedulerContinuationFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await seed(repository, { ...fixture, waitingHead: fixture.initialHead })
    const first = await advanceFlowDocBackendCompositionV1({
      repository,
      request: request("advance-to-continuation", fixture.initialHead, fixture.window.fingerprint),
      attempt: attempt("to-continuation"),
      window: fixture.window,
    })
    expect(first).toMatchObject({
      status: "advanced",
      jobHead: { headRevision: 2, transitionNumber: 1, status: "ready-to-advance" },
    })
    if (first.status !== "advanced") throw new Error("fixture did not reach structural continuation")
    const exactRequest = request("advance-continuation", first.jobHead, null)

    await expect(advanceFlowDocBackendCompositionV1({
      repository,
      request: exactRequest,
      attempt: {
        ...attempt("continuation"),
        acquiredAt: "2026-07-13T08:02:00.000Z",
        completedAt: "2026-07-13T08:02:01.000Z",
      },
      window: null,
    })).resolves.toMatchObject({
      status: "advanced",
      windowRef: null,
      jobHead: { headRevision: 4, transitionNumber: 2, status: "ready-to-finalize", lease: null },
      receipt: { demandBeforeFingerprint: null, windowRef: null, reason: "document-complete" },
    })
  })

  it("blocks before staging when accepted transition evidence would exceed retained-byte quota", async () => {
    const base = createCompositionSchedulerFixture()
    const fixture = rebindCompositionSchedulerWaitingFixtureRetainedByteLimit(
      base,
      base.waitingHead.retention.byteCount + 1,
    )
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await seed(repository, fixture)
    const result = await advanceFlowDocBackendCompositionV1({
      repository,
      request: request("advance-retention-overflow", fixture.waitingHead, fixture.window.fingerprint),
      attempt: attempt("retention-overflow"),
      window: fixture.window,
    })
    expect(result).toMatchObject({
      status: "blocked",
      jobHead: {
        status: "blocked",
        transitionNumber: 0,
        cursor: { fingerprint: fixture.waitingHead.cursor.fingerprint },
        retention: fixture.waitingHead.retention,
        blocker: { code: "composition-retained-byte-limit-exceeded", retryable: false },
      },
    })
    await expect(repository.readImmutable({
      jobId: fixture.waitingHead.jobId,
      recordId: `window:${fixture.window.fingerprint.slice(7)}`,
    })).resolves.toMatchObject({ status: "not-found" })
  })

  it("commits a receipt without a page chunk while the next root shares the open page", async () => {
    const fixture = createTwoRootFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await seed(repository, fixture)

    await expect(advanceFlowDocBackendCompositionV1({
      repository,
      request: request("advance-open-page", fixture.waitingHead, fixture.window.fingerprint),
      attempt: attempt("open-page"),
      window: fixture.window,
    })).resolves.toMatchObject({
      status: "advanced",
      pageChunkRef: null,
      receipt: { pageChunkRef: null, work: { closedPageCount: 0 } },
      jobHead: {
        status: "waiting-window",
        transitionNumber: 1,
        openPage: { usedHeightPt: 40 },
        demand: { rootNodeId: "text-root-second" },
        chain: {
          transitionReceiptTipFingerprint: expect.stringMatching(/^sha256:/u),
          closedPageChunkTipFingerprint: null,
          pageCount: 0,
        },
      },
    })
  })

  it("retains exact core state when a supplied window is rejected", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await seed(repository, fixture)
    const { fingerprint: _fingerprint, ...facts } = fixture.window
    const changed = finalizeVNextCompositionFragmentWindowV1({ ...facts, zoneId: "wrong-zone" })
    if (changed.status === "blocked") throw new Error("changed window did not finalize")

    const result = await advanceFlowDocBackendCompositionV1({
      repository,
      request: request("advance-rejected", fixture.waitingHead, changed.window.fingerprint),
      attempt: attempt("rejected"),
      window: changed.window,
    })
    expect(result).toMatchObject({
      status: "rejected",
      jobHead: {
        headRevision: 2,
        transitionNumber: 0,
        status: "waiting-window",
        lease: null,
        blocker: { retryable: true },
        cursor: { fingerprint: fixture.waitingHead.cursor.fingerprint },
        demand: { fingerprint: fixture.waitingHead.demand?.fingerprint },
      },
    })
  })

  it("moves a family blocker to terminal blocked without committing family progress", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await seed(repository, fixture)
    const demand = fixture.waitingHead.demand!
    const blockedWindow = finalizeVNextCompositionFragmentWindowV1({
      source: "vnext-composition-fragment-window",
      contractVersion: 1,
      kind: "composition-fragment-window",
      family: demand.family,
      documentId: demand.documentId,
      sectionId: demand.sectionId,
      zoneId: demand.zoneId,
      rootNodeId: demand.rootNodeId,
      rootNodeType: demand.rootNodeType,
      sourceOrder: demand.sourceOrder,
      ownerPins: { ...demand.ownerPins, pagination: fp("blocked-pagination") },
      capacity: demand.capacity,
      cursorBefore: demand.cursorBefore,
      status: "blocked",
      cursorAfter: null,
      pages: null,
      work: { pageCount: 0, fragmentCount: 0, cursorCommitCount: 0 },
      issues: [{ code: "atomic-block-oversized", severity: "error", path: "extentPt", message: "atomic block exceeds page" }],
    })
    if (blockedWindow.status === "blocked") throw new Error("family blocker window did not finalize")

    await expect(advanceFlowDocBackendCompositionV1({
      repository,
      request: request("advance-family-blocked", fixture.waitingHead, blockedWindow.window.fingerprint),
      attempt: attempt("family-blocked"),
      window: blockedWindow.window,
    })).resolves.toMatchObject({
      status: "blocked",
      jobHead: {
        headRevision: 2,
        transitionNumber: 0,
        status: "blocked",
        demand: null,
        lease: null,
        blocker: { code: "atomic-block-oversized", retryable: false },
      },
    })
  })

  it("allows only one worker to acquire the exact head", async () => {
    const fixture = createCompositionSchedulerFixture()
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await seed(repository, fixture)
    const results = await Promise.all(["race-a", "race-b"].map((id) => advanceFlowDocBackendCompositionV1({
      repository,
      request: request(`advance-${id}`, fixture.waitingHead, fixture.window.fingerprint),
      attempt: attempt(id),
      window: fixture.window,
    })))
    expect(results.map((result) => result.status).sort()).toEqual(["advanced", "stale"])
    await expect(repository.readHead(fixture.waitingHead.jobId)).resolves.toMatchObject({
      status: "found",
      head: { transitionNumber: 1, headRevision: 2, lease: null },
    })
  })

  it("clears the lease and preserves the demanded state when immutable staging fails", async () => {
    const fixture = createCompositionSchedulerFixture()
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const repository: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async putImmutable(input) {
        if ((input.ref as { kind?: string }).kind === "family-window") return {
          status: "invalid",
          ref: null,
          issues: [{
            code: "test-storage-failure",
            message: "storage unavailable",
            path: "ref",
            severity: "error",
          }],
        }
        return base.putImmutable(input)
      },
    }
    await seed(repository, fixture)

    await expect(advanceFlowDocBackendCompositionV1({
      repository,
      request: request("advance-storage-failure", fixture.waitingHead, fixture.window.fingerprint),
      attempt: attempt("storage-failure"),
      window: fixture.window,
    })).resolves.toMatchObject({
      status: "failed",
      jobHead: {
        headRevision: 2,
        transitionNumber: 0,
        status: "waiting-window",
        lease: null,
        blocker: { code: "composition-transition-staging-failed", retryable: true },
      },
    })
  })
})
