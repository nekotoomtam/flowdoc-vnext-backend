import { describe, expect, it } from "vitest"
import { runFlowDocBackendCompositionScale } from "./helpers/compositionSchedulerScaleFixture.js"

describe("durable composition scheduler scale", () => {
  it("composes and finalizes 240 mixed-family pages with bounded head and linear chain reads", async () => {
    const result = await runFlowDocBackendCompositionScale(240)
    expect(new Set(result.families)).toEqual(new Set([
      "text-flow", "columns-flow", "table-flow", "generated-flow", "utility-flow", "media-flow",
    ]))
    expect(result.finalized).toMatchObject({
      status: "completed",
      jobHead: {
        status: "completed",
        transitionNumber: 479,
        chain: { pageCount: 240, placementCount: 240, headingCount: 40 },
      },
      pagePlan: { summary: { pageCount: 240, placementCount: 240, headingCount: 40 } },
      headingPageMap: { pageCount: 240 },
    })
    expect(result.finalized.headingPageMap.entries).toHaveLength(40)
    expect(result.finalized.pagePlan.compositionFingerprint).toBe(
      result.finalized.headingPageMap.documentPaginationFingerprint,
    )
    expect(result.metrics.immutableWritesByKind).toEqual({
      "source-snapshot": 1,
      "composition-manifest": 1,
      "family-window": 479,
      "closed-page-chunk": 240,
      "transition-receipt": 479,
      "page-plan": 1,
      "heading-page-map": 1,
    })
    expect(result.metrics.immutableWriteCount).toBe(1_202)
    expect(result.metrics.immutableBatchWriteCount).toBe(0)
    expect(result.metrics.fingerprintReadCount).toBe(719)
    expect(result.metrics.directReadCount).toBe(719)
    expect(result.metrics.compareAndSwapCount).toBe(960)
    expect(result.metrics.resumeReadCount).toBe(1)
    expect(result.metrics.maximumHeadBytes).toBeLessThan(10_000)
    expect(result.finalized.jobHead.retention).toEqual({
      recordCount: result.metrics.immutableWriteCount,
      byteCount: result.metrics.immutableWriteBytes,
    })
    expect(result.progress.counts).toMatchObject({
      pageCount: 240,
      placementCount: 240,
      headingCount: 40,
      retainedRecordCount: 1_202,
      retainedByteCount: result.metrics.immutableWriteBytes,
    })
    expect(result.metrics.elapsedMs).toBeLessThan(60_000)
    expect(result.metrics.finalizationMs).toBeLessThan(15_000)
  }, 90_000)
})
