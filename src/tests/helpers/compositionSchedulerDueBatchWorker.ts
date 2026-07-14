import { existsSync, readFileSync, writeFileSync } from "node:fs"
import {
  createFlowDocBackendCompositionSqliteRepositoryV1,
  runFlowDocBackendCompositionDueWorkerBatchV1,
  type FlowDocBackendCompositionProductionRepositoryV1,
  type FlowDocBackendCompositionWorkerJournalRepositoryV1,
} from "../../index.js"

interface WorkerPayload {
  databasePath: string
  workerId: string
  runId: string
  readyPath: string
  startPath: string
  listedReadyPath: string
  listedReadyPaths: string[]
  observedAt: string
  maximumResultCount: number
  claimDurationMilliseconds: number
  storageDelayMilliseconds: number
  busyTimeoutMs: number
  reopenBeforeRun: boolean
}

const payloadPath = process.argv[2]
if (payloadPath == null) throw new Error("due-batch worker requires one payload file")
const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as WorkerPayload

async function waitForFiles(paths: readonly string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!paths.every((path) => existsSync(path))) {
    if (Date.now() >= deadline) throw new Error("due-batch worker barrier timed out")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

let repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
  databasePath: payload.databasePath,
  busyTimeoutMs: payload.busyTimeoutMs,
})
writeFileSync(payload.readyPath, JSON.stringify({ pid: process.pid }), "utf8")
await waitForFiles([payload.startPath], 30_000)

let reopenCount = 0
if (payload.reopenBeforeRun) {
  repository.close()
  repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
    databasePath: payload.databasePath,
    busyTimeoutMs: payload.busyTimeoutMs,
  })
  reopenCount += 1
}

const journalRepository: FlowDocBackendCompositionWorkerJournalRepositoryV1 = {
  ...repository,
  async listDueWorkerAttempts(input) {
    const result = await repository.listDueWorkerAttempts(input)
    writeFileSync(payload.listedReadyPath, JSON.stringify({ pid: process.pid }), "utf8")
    await waitForFiles(payload.listedReadyPaths, 30_000)
    return result
  },
}
const compositionRepository: FlowDocBackendCompositionProductionRepositoryV1 = {
  ...repository,
  async createHeadWithAvailability(input) {
    await delay(payload.storageDelayMilliseconds)
    return repository.createHeadWithAvailability(input)
  },
  async compareAndSwapHeadWithAvailability(input) {
    await delay(payload.storageDelayMilliseconds)
    return repository.compareAndSwapHeadWithAvailability(input)
  },
}

const startedAt = Date.now()
try {
  const result = await runFlowDocBackendCompositionDueWorkerBatchV1({
    journalRepository,
    compositionRepository,
    runId: payload.runId,
    workerId: payload.workerId,
    maximumResultCount: payload.maximumResultCount,
    after: null,
    claimDurationMilliseconds: payload.claimDurationMilliseconds,
    clock: { now: () => payload.observedAt },
  })
  process.stdout.write(JSON.stringify({
    pid: process.pid,
    workerId: payload.workerId,
    reopenCount,
    startedAt,
    completedAt: Date.now(),
    result,
  }))
} finally {
  repository.close()
}
