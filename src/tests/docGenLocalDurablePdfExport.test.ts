import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1 } from "../index.js"

const workerPath = fileURLToPath(new URL(
  "./helpers/docGenLocalDurablePdfExportProcessWorker.ts",
  import.meta.url,
))

interface WorkerResult {
  code: number | null
  stderr: string
  output: Record<string, any> | null
}

describe("PDF export REALDOC-E.6.2 durable DocGen operation and artifact composition", () => {
  const roots: string[] = []

  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  function root(): string {
    const value = mkdtempSync(join(tmpdir(), "flowdoc-docgen-e62-"))
    roots.push(value)
    return value
  }

  function runWorker(rootDirectory: string, input: Record<string, unknown>): Promise<WorkerResult> {
    const payloadPath = join(rootDirectory, `worker-${String(input.mode)}.json`)
    writeFileSync(payloadPath, JSON.stringify({ rootDirectory, ...input }), "utf8")
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
      child.once("exit", (code) => resolve({
        code,
        stderr,
        output: stdout.trim().length === 0 ? null : JSON.parse(stdout) as Record<string, any>,
      }))
    })
  }

  it("opens one complete local-only durable repository bundle", async () => {
    const rootDirectory = root()
    const composition = await createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1({ rootDirectory })
    expect(composition.facts).toEqual({
      source: "flowdoc-backend-docgen-local-durable-pdf-export",
      runtimeProfile: "local-integration",
      protectedAdmissionPersistence: "sqlite",
      operationPersistence: "sqlite",
      lifecyclePersistence: "sqlite",
      artifactMetadataPersistence: "sqlite",
      observabilityPersistence: "sqlite",
      artifactBytePersistence: "filesystem-content-addressed",
      processRestartReplay: true,
      defaultApplicationServerMounted: false,
      productionBinding: false,
    })
    expect(composition.rootDirectory).toBe(rootDirectory)
    composition.close()
    composition.close()
  })

  it("recovers operation, rendered work, metadata, status, replay, and verified bytes across four processes", async () => {
    const rootDirectory = root()
    const created = await runWorker(rootDirectory, { mode: "create" })
    expect(created).toMatchObject({
      code: 0,
      stderr: "",
      output: {
        mode: "create",
        admissionStatus: "created",
        durablePersistence: true,
        operationState: "pending",
        lifecycleStatus: "pending",
        lifecycleCheckpoint: "before-handoff",
        mapperCount: 1,
        materializerCount: 1,
        productionBinding: false,
      },
    })
    const operationId = created.output?.operationId as string
    const instanceId = created.output?.instanceId as string

    const faulted = await runWorker(rootDirectory, { mode: "render-fault", operationId })
    expect(faulted).toMatchObject({
      code: 0,
      stderr: "",
      output: {
        mode: "render-fault",
        faultObserved: true,
        lifecycleStatus: "claimed",
        lifecycleCheckpoint: "before-persist",
        mapperCount: 0,
        materializerCount: 1,
        persistenceStatus: "not-found",
      },
    })

    const completed = await runWorker(rootDirectory, { mode: "complete", operationId })
    expect(completed).toMatchObject({
      code: 0,
      stderr: "",
      output: {
        mode: "complete",
        workflowStatus: "completed",
        terminalStatus: "completed",
        pageCount: 1,
        mapperCount: 0,
        materializerCount: 1,
        rendererExecuted: true,
        persistenceExecuted: true,
      },
    })

    const verified = await runWorker(rootDirectory, { mode: "verify", operationId, instanceId })
    expect(verified).toMatchObject({
      code: 0,
      stderr: "",
      output: {
        mode: "verify",
        statusHttp: 200,
        state: "completed",
        pageCount: 1,
        downloadHttp: 200,
        pdfMagic: "%PDF-",
        replayHttp: 200,
        replayStatus: "idempotent-replay",
        metadataMatchesDownload: true,
        otherScopeConcealed: true,
        materializerCount: 0,
      },
    })
    expect(new Set([
      created.output?.pid,
      faulted.output?.pid,
      completed.output?.pid,
      verified.output?.pid,
    ]).size).toBe(4)
    expect(verified.output?.byteLength).toBeGreaterThan(0)
    expect(verified.output?.terminalEventCount).toBeGreaterThan(0)
    expect(verified.output?.terminalCompletionFingerprint).toBe(completed.output?.completionFingerprint)
    expect(verified.output?.metadataByteLength).toBe(verified.output?.byteLength)
    expect(verified.output?.metadataSha256).toBe(verified.output?.pdfSha256)
    expect(verified.output?.pdfSha256).toMatch(/^[a-f0-9]{64}$/u)
  }, 30_000)
})
