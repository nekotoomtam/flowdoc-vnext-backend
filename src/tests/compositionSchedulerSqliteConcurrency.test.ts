import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { compositionFingerprint, createFlowDocBackendCompositionSqliteRepositoryV1 } from "../index.js"
import { createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const workerPath = fileURLToPath(new URL("./helpers/compositionSchedulerSqliteConcurrencyWorker.ts", import.meta.url))
const lockWorkerPath = fileURLToPath(new URL("./helpers/compositionSchedulerSqliteLockWorker.ts", import.meta.url))

interface WorkerOutput {
  pid: number
  jobKey: string
  jobId: string
  startedAt: number
  completedAt: number
  elapsedMs: number
  transitionNumber: number
  pageCount: number
  recordCount: number
  byteCount: number
  immutableBatchWriteCount: number
  reopenCount: number
  families: string[]
}

interface WorkerRun {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
  output: WorkerOutput | null
}

interface LockWorkerRun {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
  output: { pid: number; released: boolean } | null
}

describe("composition scheduler SQLite concurrent job evidence", () => {
  const roots: string[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  function root(prefix: string) {
    const value = mkdtempSync(join(tmpdir(), prefix))
    roots.push(value)
    return value
  }

  function spawnWorker(workerRoot: string, input: {
    databasePath: string
    jobKey: string
    pageCount: number
    readyPath: string
    startPath: string
    reopenMidRun?: boolean
  }): Promise<WorkerRun> {
    const payloadPath = join(workerRoot, `payload-${input.jobKey}.json`)
    writeFileSync(payloadPath, JSON.stringify({
      ...input,
      reopenMidRun: input.reopenMidRun ?? false,
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

  function spawnLockWorker(workerRoot: string, input: {
    databasePath: string
    readyPath: string
    releasePath: string
  }): Promise<LockWorkerRun> {
    const payloadPath = join(workerRoot, "lock-payload.json")
    writeFileSync(payloadPath, JSON.stringify(input), "utf8")
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", lockWorkerPath, payloadPath], {
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
        const output = stdout.trim().length === 0
          ? null
          : JSON.parse(stdout) as LockWorkerRun["output"]
        resolve({ code, signal, stderr, output })
      })
    })
  }

  async function waitForFiles(paths: readonly string[], timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (!paths.every((path) => existsSync(path))) {
      if (Date.now() >= deadline) throw new Error("SQLite concurrency ready barrier timed out")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  it("completes four fair independent-process jobs on one database", async () => {
    const pageCount = 60
    const baselineRoot = root("flowdoc-sqlite-baseline-")
    const baselineDatabasePath = join(baselineRoot, "composition.sqlite")
    const baselineStartPath = join(baselineRoot, "start")
    const baselineReadyPath = join(baselineRoot, "ready")
    writeFileSync(baselineStartPath, "start", "utf8")
    const baseline = await spawnWorker(baselineRoot, {
      databasePath: baselineDatabasePath,
      jobKey: "baseline",
      pageCount,
      readyPath: baselineReadyPath,
      startPath: baselineStartPath,
    })
    expect(baseline).toMatchObject({ code: 0, signal: null, output: { pageCount, recordCount: 302 } })
    if (baseline.output == null) throw new Error(baseline.stderr || "baseline worker returned no output")

    const concurrentRoot = root("flowdoc-sqlite-concurrent-")
    const databasePath = join(concurrentRoot, "composition.sqlite")
    const initialized = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
    initialized.close()
    const startPath = join(concurrentRoot, "start")
    const workerInputs = ["job-a", "job-b", "job-c", "job-d"].map((jobKey) => ({
      databasePath,
      jobKey,
      pageCount,
      readyPath: join(concurrentRoot, `ready-${jobKey}`),
      startPath,
      reopenMidRun: jobKey === "job-c",
    }))
    const workers = workerInputs.map((input) => spawnWorker(concurrentRoot, input))
    await waitForFiles(workerInputs.map((input) => input.readyPath), 30_000)
    const wallStartedAt = Date.now()
    writeFileSync(startPath, "start", "utf8")
    const runs = await Promise.all(workers)
    const wallElapsedMs = Date.now() - wallStartedAt
    expect(runs.every((run) => run.code === 0 && run.signal == null && run.output != null)).toBe(true)
    const outputs = runs.map((run) => {
      if (run.output == null) throw new Error(run.stderr || "concurrent worker returned no output")
      return run.output
    })
    expect(new Set(outputs.map((output) => output.pid)).size).toBe(4)
    expect(new Set(outputs.map((output) => output.jobId)).size).toBe(4)
    for (const output of outputs) expect(output).toMatchObject({
      pageCount,
      transitionNumber: 119,
      recordCount: 302,
      immutableBatchWriteCount: 121,
      families: expect.arrayContaining([
        "text-flow", "columns-flow", "table-flow", "generated-flow", "utility-flow", "media-flow",
      ]),
    })
    expect(outputs.filter((output) => output.reopenCount === 1).map((output) => output.jobKey)).toEqual(["job-c"])

    const elapsed = outputs.map((output) => output.elapsedMs)
    const minimumElapsedMs = Math.min(...elapsed)
    const maximumElapsedMs = Math.max(...elapsed)
    expect(maximumElapsedMs / minimumElapsedMs).toBeLessThan(2)
    expect(wallElapsedMs / baseline.output.elapsedMs).toBeLessThan(10)
    expect(Math.max(...outputs.map((output) => output.completedAt)) - Math.min(...outputs.map((output) => output.completedAt)))
      .toBeLessThan(Math.max(10_000, baseline.output.elapsedMs * 2))

    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
    try {
      for (const output of outputs) await expect(repository.inspectPhysicalUsage(output.jobId)).resolves.toMatchObject({
        status: "ready",
        usage: { recordCount: output.recordCount, byteCount: output.byteCount },
      })
    } finally {
      repository.close()
    }
  }, 120_000)

  it("returns a bounded immutable storage error without partial writes after writer timeout", async () => {
    const testRoot = root("flowdoc-sqlite-busy-")
    const databasePath = join(testRoot, "composition.sqlite")
    const contender = await createFlowDocBackendCompositionSqliteRepositoryV1({
      databasePath,
      busyTimeoutMs: 100,
    })
    const readyPath = join(testRoot, "lock-ready")
    const releasePath = join(testRoot, "lock-release")
    const holder = spawnLockWorker(testRoot, { databasePath, readyPath, releasePath })
    const value = { fingerprint: compositionFingerprint({ value: "busy-record" }) }
    const ref = {
      jobId: "busy-job",
      recordId: "busy-record",
      kind: "family-window" as const,
      recordFingerprint: value.fingerprint,
      byteLength: Buffer.byteLength(JSON.stringify(value), "utf8"),
    }
    const fixture = createCompositionSchedulerFixture()
    try {
      try {
        await waitForFiles([readyPath], 30_000)
        const startedAt = performance.now()
        const result = await contender.putImmutableBatchWithPhysicalAdmission({
          records: [{ ref, value }],
          storedAt: "2026-07-14T08:00:00.000Z",
          maximumPhysicalByteCount: 10_000,
        })
        const elapsedMs = performance.now() - startedAt
        expect(result).toMatchObject({
          status: "storage-error",
          writtenRecordCount: 0,
          usage: null,
          issues: [expect.objectContaining({ code: "composition-sqlite-busy" })],
        })
        expect(elapsedMs).toBeGreaterThanOrEqual(80)
        expect(elapsedMs).toBeLessThan(2_000)
        await expect(contender.createHead({
          createRequestId: "busy-head-create",
          requestFingerprint: compositionFingerprint({ value: "busy-head-create" }),
          sourcePin: fixture.sourcePin,
          manifest: fixture.manifest,
          head: fixture.waitingHead,
        })).rejects.toThrow(/database is locked/iu)
      } finally {
        writeFileSync(releasePath, "release", "utf8")
        await expect(holder).resolves.toMatchObject({ code: 0, signal: null, output: { released: true } })
      }
      await expect(contender.readImmutable({ jobId: ref.jobId, recordId: ref.recordId })).resolves.toMatchObject({
        status: "not-found",
      })
      await expect(contender.readHead(fixture.sourcePin.jobId)).resolves.toMatchObject({ status: "not-found" })
    } finally {
      contender.close()
    }
  }, 60_000)
})
