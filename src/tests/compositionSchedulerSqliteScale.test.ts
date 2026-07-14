import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendCompositionSqliteRepositoryV1,
  type FlowDocBackendCompositionSqliteRepositoryV1,
} from "../index.js"
import { runFlowDocBackendCompositionScale } from "./helpers/compositionSchedulerScaleFixture.js"

describe("composition scheduler SQLite scale evidence", () => {
  const roots: string[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  it("completes 240 mixed-family pages with a real mid-run connection restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-composition-sqlite-scale-"))
    roots.push(root)
    const databasePath = join(root, "composition.sqlite")
    let repository: FlowDocBackendCompositionSqliteRepositoryV1 =
      await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
    let reopenCount = 0
    try {
      const result = await runFlowDocBackendCompositionScale(240, {
        repository,
        reopenRepository: async () => {
          repository.close()
          repository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
          reopenCount += 1
          return repository
        },
      })
      expect(reopenCount).toBe(1)
      expect(result.finalized).toMatchObject({
        status: "completed",
        jobHead: {
          status: "completed",
          chain: { pageCount: 240, placementCount: 240, headingCount: 40 },
          retention: { recordCount: 1_202, byteCount: 3_224_446 },
        },
        pagePlan: { summary: { pageCount: 240, placementCount: 240, headingCount: 40 } },
      })
      expect(result.progress).toMatchObject({
        status: "completed",
        transitionNumber: 479,
        counts: {
          retainedRecordCount: 1_202,
          retainedByteCount: 3_224_446,
        },
      })
      await expect(repository.inspectPhysicalUsage(result.finalized.jobHead.jobId)).resolves.toMatchObject({
        status: "ready",
        usage: { recordCount: 1_202, byteCount: 3_224_446 },
      })
      expect(result.metrics.maximumHeadBytes).toBeLessThanOrEqual(5_364)
      expect(result.metrics.elapsedMs).toBeLessThan(90_000)
      expect(result.metrics.finalizationMs).toBeLessThan(15_000)
    } finally {
      repository.close()
    }
  }, 120_000)
})
