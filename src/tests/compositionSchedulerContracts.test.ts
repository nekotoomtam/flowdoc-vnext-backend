import { describe, expect, it } from "vitest"
import {
  createFlowDocBackendCompositionProgressV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  finalizeFlowDocBackendCompositionSourcePinV1,
  finalizeFlowDocBackendCompositionTransitionReceiptV1,
  parseFlowDocBackendCompositionJobHeadV1,
  parseFlowDocBackendCompositionPageChunkV1,
  parseFlowDocBackendCompositionSourcePinV1,
  parseFlowDocBackendCompositionTransitionReceiptV1,
} from "../index.js"
import {
  createCompositionSchedulerContinuationFixture,
  createCompositionSchedulerFixture,
} from "./helpers/compositionSchedulerFixture.js"

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe("durable composition scheduler contracts", () => {
  it("finalizes and parses exact source, head, page-chunk, and receipt owners", () => {
    const fixture = createCompositionSchedulerFixture()

    expect(parseFlowDocBackendCompositionSourcePinV1(fixture.sourcePin)).toEqual({
      status: "ready", issues: [], sourcePin: fixture.sourcePin,
    })
    expect(parseFlowDocBackendCompositionJobHeadV1({
      value: fixture.waitingHead,
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toEqual({ status: "ready", issues: [], jobHead: fixture.waitingHead })
    expect(parseFlowDocBackendCompositionPageChunkV1({
      value: fixture.pageChunk,
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toEqual({ status: "ready", issues: [], pageChunk: fixture.pageChunk })
    expect(parseFlowDocBackendCompositionTransitionReceiptV1({
      value: fixture.receipt,
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toEqual({ status: "ready", issues: [], receipt: fixture.receipt })
    expect(parseFlowDocBackendCompositionJobHeadV1({
      value: fixture.readyToFinalizeHead,
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toEqual({ status: "ready", issues: [], jobHead: fixture.readyToFinalizeHead })
  })

  it("rejects unknown properties, cross-job refs, stale fingerprints, and impossible job states", () => {
    const fixture = createCompositionSchedulerFixture()
    expect(finalizeFlowDocBackendCompositionSourcePinV1({
      ...fixture.sourcePin,
      fingerprint: undefined,
      unexpected: true,
    })).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([expect.objectContaining({ code: "composition-record-property-unknown" })]),
    })

    const crossJob = clone(fixture.sourcePin)
    crossJob.sourceSnapshotRef.jobId = "another-job"
    delete (crossJob as Partial<typeof crossJob>).fingerprint
    expect(finalizeFlowDocBackendCompositionSourcePinV1(crossJob)).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([expect.objectContaining({ code: "composition-source-reference-invalid" })]),
    })

    const stale = clone(fixture.waitingHead)
    stale.headRevision += 1
    expect(parseFlowDocBackendCompositionJobHeadV1({
      value: stale,
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toMatchObject({
      status: "blocked",
      issues: [expect.objectContaining({ code: "composition-job-head-fingerprint-mismatch" })],
    })

    const { fingerprint: _fingerprint, ...waitingFacts } = fixture.waitingHead
    expect(finalizeFlowDocBackendCompositionJobHeadV1({
      value: { ...waitingFacts, demand: null },
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([expect.objectContaining({ code: "composition-waiting-state-invalid" })]),
    })
  })

  it("keeps backend chunk identity separate from the core closed-page prefix", () => {
    const fixture = createCompositionSchedulerFixture()
    expect(fixture.readyToFinalizeHead.chain).toMatchObject({
      closedPageChunkTipFingerprint: fixture.pageChunk.fingerprint,
      closedPagePrefixFingerprint: fixture.pageChunk.closedPrefixAfterFingerprint,
    })
    expect(fixture.pageChunk.fingerprint).not.toBe(fixture.pageChunk.closedPrefixAfterFingerprint)

    const broken = clone(fixture.pageChunk)
    broken.pages[0].pageIndex = 5
    expect(parseFlowDocBackendCompositionPageChunkV1({
      value: broken,
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toMatchObject({ status: "blocked" })
  })

  it("rejects receipt revision, demand/window, and result-state drift", () => {
    const fixture = createCompositionSchedulerFixture()
    const { fingerprint: _fingerprint, ...receiptFacts } = fixture.receipt
    expect(finalizeFlowDocBackendCompositionTransitionReceiptV1({
      value: { ...receiptFacts, headRevisionAfter: receiptFacts.headRevisionBefore + 2 },
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([expect.objectContaining({ code: "composition-receipt-revision-invalid" })]),
    })
    expect(finalizeFlowDocBackendCompositionTransitionReceiptV1({
      value: { ...receiptFacts, demandBeforeFingerprint: null },
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([expect.objectContaining({ code: "composition-receipt-window-demand-invalid" })]),
    })
    expect(finalizeFlowDocBackendCompositionTransitionReceiptV1({
      value: { ...receiptFacts, status: "partial", reason: "document-complete" },
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([expect.objectContaining({ code: "composition-receipt-result-invalid" })]),
    })
  })

  it("projects bounded progress without cursor, open-page, window, lease-token, or storage paths", () => {
    const fixture = createCompositionSchedulerFixture()
    const result = createFlowDocBackendCompositionProgressV1({
      context: {
        value: fixture.waitingHead,
        sourcePin: fixture.sourcePin,
        manifest: fixture.manifest,
      },
      sourceCurrent: false,
      observedAt: "2026-07-13T08:01:00.000Z",
    })
    expect(result).toMatchObject({
      status: "ready",
      progress: {
        sourceCurrent: false,
        status: "waiting-window",
        structuralContinuation: false,
        demand: { rootNodeId: "text-root", family: "text-flow" },
        contracts: {
          exposesCursor: false,
          exposesOpenPage: false,
          exposesFamilyWindow: false,
          exposesStoragePaths: false,
        },
      },
    })
    if (result.status === "blocked") throw new Error("progress projection blocked")
    expect(result.progress).not.toHaveProperty("cursor")
    expect(result.progress).not.toHaveProperty("openPage")
    expect(result.progress).not.toHaveProperty("window")
    expect(JSON.stringify(result.progress)).not.toContain("leaseToken")
    expect(JSON.stringify(result.progress)).not.toContain("storageKey")
  })

  it("retains demand-free output-limit continuation as an explicit backend state", () => {
    const fixture = createCompositionSchedulerContinuationFixture()
    expect(parseFlowDocBackendCompositionJobHeadV1({
      value: fixture.head,
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
    })).toEqual({ status: "ready", issues: [], jobHead: fixture.head })
    const progress = createFlowDocBackendCompositionProgressV1({
      context: { value: fixture.head, sourcePin: fixture.sourcePin, manifest: fixture.manifest },
      sourceCurrent: true,
      observedAt: "2026-07-13T08:01:00.000Z",
    })
    expect(progress).toMatchObject({
      status: "ready",
      progress: {
        status: "ready-to-advance",
        demand: null,
        structuralContinuation: true,
      },
    })
  })
})
