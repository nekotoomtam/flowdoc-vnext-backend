import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createFlowDocBackendCompositionSqliteRepositoryV1 } from "../../index.js"
import { runFlowDocBackendCompositionScale } from "./compositionSchedulerScaleFixture.js"

interface WorkerPayload {
  databasePath: string
  jobKey: string
  pageCount: number
  readyPath: string
  startPath: string
  busyTimeoutMs: number
  reopenMidRun: boolean
}

const payloadPath = process.argv[2]
if (payloadPath == null) throw new Error("SQLite concurrency worker requires one payload file")
const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as WorkerPayload

async function waitForStart(path: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error("SQLite concurrency worker start barrier timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

let repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
  databasePath: payload.databasePath,
  busyTimeoutMs: payload.busyTimeoutMs,
})
writeFileSync(payload.readyPath, JSON.stringify({ pid: process.pid }), "utf8")
await waitForStart(payload.startPath, 30_000)
const startedAt = Date.now()
try {
  let reopenCount = 0
  const result = await runFlowDocBackendCompositionScale(payload.pageCount, {
    repository,
    jobKey: payload.jobKey,
    reopenRepository: payload.reopenMidRun ? async () => {
      repository.close()
      repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
        databasePath: payload.databasePath,
        busyTimeoutMs: payload.busyTimeoutMs,
      })
      reopenCount += 1
      return repository
    } : undefined,
  })
  process.stdout.write(JSON.stringify({
    pid: process.pid,
    jobKey: payload.jobKey,
    jobId: result.finalized.jobHead.jobId,
    startedAt,
    completedAt: Date.now(),
    elapsedMs: result.metrics.elapsedMs,
    transitionNumber: result.finalized.jobHead.transitionNumber,
    pageCount: result.finalized.jobHead.chain.pageCount,
    recordCount: result.finalized.jobHead.retention.recordCount,
    byteCount: result.finalized.jobHead.retention.byteCount,
    immutableBatchWriteCount: result.metrics.immutableBatchWriteCount,
    reopenCount,
    families: result.families,
  }))
} finally {
  repository.close()
}
