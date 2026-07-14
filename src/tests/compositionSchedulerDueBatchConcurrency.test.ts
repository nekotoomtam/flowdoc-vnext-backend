import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  compositionFingerprint,
  createFlowDocBackendCompositionHeadUnavailableResultV1,
  createFlowDocBackendCompositionSqliteRepositoryV1,
  createFlowDocBackendCompositionWorkerStorageAttemptV1,
  runFlowDocBackendCompositionDueWorkerBatchV1,
  runFlowDocBackendCompositionWorkerAttemptOnceV1,
  type FlowDocBackendCompositionWorkerBatchResultV1,
  type FlowDocBackendCompositionWorkerHeadMutationV1,
  type FlowDocBackendCompositionWorkerJournalCreateInputV1,
} from "../index.js"
import { createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const workerPath = fileURLToPath(new URL(
  "./helpers/compositionSchedulerDueBatchWorker.ts",
  import.meta.url,
))
const attemptCount = 12
const processCount = 4
const seedAt = "2026-07-14T08:00:00.000Z"
const expiredClaimAt = "2026-07-14T08:00:00.500Z"
const observedAt = "2026-07-14T08:00:01.000Z"
const fp = (value: string) => compositionFingerprint({ value })

interface WorkerOutput {
  pid: number
  workerId: string
  reopenCount: number
  startedAt: number
  completedAt: number
  result: FlowDocBackendCompositionWorkerBatchResultV1
}

interface WorkerRun {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
  output: WorkerOutput | null
}

function attemptId(index: number): string {
  return `due-attempt-${index.toString().padStart(2, "0")}`
}

function createInput(index: number): FlowDocBackendCompositionWorkerJournalCreateInputV1 {
  const fixture = createCompositionSchedulerFixture()
  const id = attemptId(index)
  const mutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
    operation: "head-create",
    input: {
      createRequestId: `head-${id}`,
      requestFingerprint: fp(`head-${id}`),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    },
  }
  const unavailable = createFlowDocBackendCompositionHeadUnavailableResultV1({
    operation: "head-create",
    reconcileWith: "create-request",
    message: `qualification unavailable ${id}`,
  })
  const state = createFlowDocBackendCompositionWorkerStorageAttemptV1({
    mutation,
    unavailable,
    completedWriteAttemptCount: 1,
    unavailableAt: seedAt,
  })
  if (state.status === "blocked") throw new Error(state.issues[0]?.message)
  return {
    attemptId: id,
    createRequestId: `journal-${id}`,
    createRequestFingerprint: fp(`journal-${id}`),
    mutation,
    state: state.state,
    createdAt: seedAt,
  }
}

function spawnWorker(root: string, input: {
  databasePath: string
  workerId: string
  readyPath: string
  startPath: string
  listedReadyPath: string
  listedReadyPaths: string[]
  reopenBeforeRun: boolean
}): Promise<WorkerRun> {
  const payloadPath = join(root, `payload-${input.workerId}.json`)
  writeFileSync(payloadPath, JSON.stringify({
    ...input,
    runId: `qualification-${input.workerId}`,
    observedAt,
    maximumResultCount: attemptCount,
    claimDurationMilliseconds: 60_000,
    storageDelayMilliseconds: 100,
    busyTimeoutMs: 10_000,
  }), "utf8")
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, payloadPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (value: string) => { stdout += value })
    child.stderr.on("data", (value: string) => { stderr += value })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      const output = stdout.trim().length === 0 ? null : JSON.parse(stdout) as WorkerOutput
      resolve({ code, signal, stderr, output })
    })
  })
}

async function waitForFiles(paths: readonly string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!paths.every((path) => existsSync(path))) {
    if (Date.now() >= deadline) throw new Error("due-batch qualification ready barrier timed out")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("composition scheduler due-batch independent-process qualification", () => {
  const roots: string[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  it("retains one execution owner under a shared due page, expiry reclaim, and restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-due-batch-concurrency-"))
    roots.push(root)
    const databasePath = join(root, "composition.sqlite")
    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
      databasePath,
      busyTimeoutMs: 10_000,
    })
    const inputs = Array.from({ length: attemptCount }, (_, index) => createInput(index))
    try {
      for (const input of inputs) {
        const created = await repository.createWorkerAttempt(input)
        expect(created.status).toBe("created")
        const prepared = await runFlowDocBackendCompositionWorkerAttemptOnceV1({
          journalRepository: repository,
          compositionRepository: repository,
          attemptId: input.attemptId,
          workerId: "qualification-seed-worker",
          claimToken: `qualification-seed-${input.attemptId}`,
          claimDurationMilliseconds: 60_000,
          clock: { now: () => seedAt },
        })
        expect(prepared).toMatchObject({ status: "released", outcomeStatus: "retry-ready" })
      }
      await expect(repository.claimWorkerAttempt({
        attemptId: attemptId(0),
        expectedJournalRevision: 3,
        claimToken: "expired-process-claim",
        workerId: "expired-process-worker",
        claimedAt: expiredClaimAt,
        expiresAt: observedAt,
      })).resolves.toMatchObject({ status: "claimed" })
    } finally {
      repository.close()
    }

    const startPath = join(root, "start")
    const workers = Array.from({ length: processCount }, (_, index) => ({
      workerId: `due-worker-${index}`,
      readyPath: join(root, `ready-${index}`),
      listedReadyPath: join(root, `listed-${index}`),
    }))
    const listedReadyPaths = workers.map((worker) => worker.listedReadyPath)
    const runs = workers.map((worker, index) => spawnWorker(root, {
      databasePath,
      workerId: worker.workerId,
      readyPath: worker.readyPath,
      startPath,
      listedReadyPath: worker.listedReadyPath,
      listedReadyPaths,
      reopenBeforeRun: index === processCount - 1,
    }))
    await waitForFiles(workers.map((worker) => worker.readyPath), 30_000)
    const wallStartedAt = Date.now()
    writeFileSync(startPath, "start", "utf8")
    const settled = await Promise.all(runs)
    const wallElapsedMs = Date.now() - wallStartedAt

    expect(settled.every((run) => run.code === 0 && run.signal == null && run.output != null)).toBe(true)
    const outputs = settled.map((run) => {
      if (run.output == null) throw new Error(run.stderr || "due-batch worker returned no output")
      return run.output
    })
    expect(new Set(outputs.map((output) => output.pid)).size).toBe(processCount)
    expect(outputs.map((output) => output.reopenCount)).toEqual([0, 0, 0, 1])

    const expectedDueOrder = [
      ...inputs.slice(1).map((input) => input.attemptId),
      inputs[0]!.attemptId,
    ]
    const ready = outputs.map((output) => {
      if (output.result.status !== "ready") throw new Error(output.result.issues[0]?.message)
      expect(output.result.report).toMatchObject({
        observedAt,
        maximumResultCount: attemptCount,
        listedAttemptCount: attemptCount,
        invokedAttemptCount: attemptCount,
        nextCursor: null,
      })
      const { fingerprint, ...facts } = output.result.report
      expect(fingerprint).toBe(compositionFingerprint(facts))
      expect(output.result.attempts.map((attempt) => attempt.attemptId)).toEqual(expectedDueOrder)
      return output.result
    })
    const allAttempts = ready.flatMap((result) => result.attempts)
    const count = (status: string) => allAttempts.filter((attempt) => attempt.result.status === status).length
    expect(allAttempts).toHaveLength(attemptCount * processCount)
    expect(count("completed")).toBe(attemptCount)
    expect(count("terminal-replay") + count("busy") + count("ownership-lost")).toBe(
      attemptCount * (processCount - 1),
    )
    expect(count("released") + count("deferred") + count("blocked") + count("journal-unavailable")
      + count("execution-interrupted") + count("not-found")).toBe(0)

    const ownerCounts = ready.map((result) => result.report.outcomes.completed)
    expect(ownerCounts.every((value) => value > 0)).toBe(true)
    expect(Math.max(...ownerCounts) - Math.min(...ownerCounts)).toBeLessThanOrEqual(3)
    const terminalObservations = ready.reduce((totals, result) => ({
      committed: totals.committed + result.report.terminals.committed,
      conflict: totals.conflict + result.report.terminals.conflict,
    }), { committed: 0, conflict: 0 })
    const ownerTerminalTotals = allAttempts.reduce((totals, attempt) => {
      if (attempt.result.status !== "completed") return totals
      if (attempt.result.terminalStatus === "committed") totals.committed += 1
      if (attempt.result.terminalStatus === "conflict") totals.conflict += 1
      return totals
    }, { committed: 0, conflict: 0 })
    expect(ownerTerminalTotals).toEqual({ committed: 1, conflict: attemptCount - 1 })
    expect(terminalObservations.committed + terminalObservations.conflict).toBe(
      attemptCount + count("terminal-replay"),
    )
    expect(wallElapsedMs).toBeLessThan(20_000)
    expect(attemptCount / (wallElapsedMs / 1_000)).toBeGreaterThan(0.5)

    const reopened = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
    try {
      for (let index = 0; index < attemptCount; index += 1) {
        await expect(reopened.readWorkerAttempt(attemptId(index))).resolves.toMatchObject({
          status: "found",
          entry: {
            status: "completed",
            journalRevision: index === 0 ? 7 : 6,
            terminal: { status: index === 0 ? "conflict" : expect.any(String) },
          },
        })
      }
      await expect(reopened.readHeadCreation(createCompositionSchedulerFixture().sourcePin.jobId)).resolves.toMatchObject({
        status: "found",
      })
      await expect(runFlowDocBackendCompositionDueWorkerBatchV1({
        journalRepository: reopened,
        compositionRepository: reopened,
        runId: "qualification-restart-empty",
        workerId: "qualification-restart-worker",
        maximumResultCount: attemptCount,
        after: null,
        claimDurationMilliseconds: 60_000,
        clock: { now: () => observedAt },
      })).resolves.toMatchObject({
        status: "ready",
        attempts: [],
        report: { listedAttemptCount: 0, invokedAttemptCount: 0 },
      })
    } finally {
      reopened.close()
    }

    const duplicateObservationCount = allAttempts.length - attemptCount
    const evidenceFacts = {
      processCount,
      attemptCount,
      listedObservationCount: allAttempts.length,
      duplicateObservationCount,
      completedOwnerCount: count("completed"),
      ownerCounts,
      ownerTerminalTotals,
      terminalObservations,
      wallElapsedMs,
    }
    const evidence = {
      ...evidenceFacts,
      fingerprint: compositionFingerprint(evidenceFacts),
    }
    expect(duplicateObservationCount).toBe(attemptCount * (processCount - 1))
    const { fingerprint, ...retainedFacts } = evidence
    expect(fingerprint).toBe(compositionFingerprint(retainedFacts))
  }, 60_000)
})
