import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1,
  supportsFlowDocBackendDocGenLocalAdmissionSqliteV1,
} from "../index.js"
import {
  DOCGEN_LOCAL_IDEMPOTENCY_KEY,
  DOCGEN_LOCAL_IDENTITY,
  createDocGenLocalAdmissionFixture,
  docGenLocalAdaptedRequest,
  docGenLocalMapper,
} from "./helpers/docGenLocalFixture.js"

const PAYLOAD = JSON.stringify({
  title: "Durable private report",
  name: "Durable private item",
  amount: 42,
  rawOnlyMarker: "must-not-be-retained",
})
const processWorkerPath = fileURLToPath(new URL(
  "./helpers/docGenLocalAdmissionSqliteProcessWorker.ts",
  import.meta.url,
))

interface ProcessWorkerResult {
  code: number | null
  stderr: string
  output: {
    pid: number
    status: string
    mapCount: number
    receiptFingerprint: string | null
    instanceId: string | null
    durablePersistence: boolean | null
  } | null
}

describe("PDF export REALDOC-E.6.1 durable protected DocGen admission", () => {
  const roots: string[] = []

  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  function databasePath(): string {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-docgen-e61-"))
    roots.push(root)
    return join(root, "protected-admissions.sqlite")
  }

  function runInProcess(payloadPath: string): Promise<ProcessWorkerResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", processWorkerPath, payloadPath], {
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
        output: stdout.trim().length === 0 ? null : JSON.parse(stdout) as ProcessWorkerResult["output"],
      }))
    })
  }

  it("locks the supported Node SQLite runtime floor", () => {
    expect(supportsFlowDocBackendDocGenLocalAdmissionSqliteV1("24.14.9")).toBe(false)
    expect(supportsFlowDocBackendDocGenLocalAdmissionSqliteV1("24.15.0")).toBe(true)
    expect(supportsFlowDocBackendDocGenLocalAdmissionSqliteV1("25.0.0")).toBe(true)
    expect(supportsFlowDocBackendDocGenLocalAdmissionSqliteV1()).toBe(true)
  })

  it("reopens a protected canonical admission and replays without mapping raw JSON again", async () => {
    const path = databasePath()
    let firstMapCount = 0
    const firstRepository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: path,
    })
    const first = createDocGenLocalAdmissionFixture({
      repository: firstRepository,
      mapper: docGenLocalMapper({ onMap: () => { firstMapCount += 1 } }),
    })
    const created = await first.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(PAYLOAD),
    })
    expect(created).toMatchObject({
      status: "created",
      receipt: { contracts: { durablePersistence: true } },
    })
    expect(firstMapCount).toBe(1)
    if (created.status !== "created") throw new Error(JSON.stringify(created.issues))
    const instanceId = created.receipt.instance.instanceId
    firstRepository.close()

    let reopenedMapCount = 0
    const reopenedRepository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: path,
    })
    const reopened = createDocGenLocalAdmissionFixture({
      repository: reopenedRepository,
      mapper: docGenLocalMapper({ onMap: () => { reopenedMapCount += 1 } }),
    })
    const stored = await reopenedRepository.readByInstanceId(instanceId)
    expect(stored?.receipt.receiptFingerprint).toBe(created.receipt.receiptFingerprint)
    expect(JSON.stringify(stored)).not.toContain("rawOnlyMarker")
    expect(JSON.stringify(stored)).not.toContain("must-not-be-retained")

    const replayed = await reopened.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(PAYLOAD),
    })
    expect(replayed).toEqual({ status: "replayed", receipt: created.receipt, issues: [] })
    expect(reopenedMapCount).toBe(0)

    const conflict = await reopened.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(JSON.stringify({ title: "Changed", name: "Item", amount: 1 })),
    })
    expect(conflict.status).toBe("idempotency-conflict")
    expect(reopenedMapCount).toBe(0)
    reopenedRepository.close()
  })

  it("replays the same receipt after the creating process has exited", async () => {
    const path = databasePath()
    const payloadPath = join(roots.at(-1)!, "worker-input.json")
    writeFileSync(payloadPath, JSON.stringify({
      databasePath: path,
      callerKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      payloadText: PAYLOAD,
    }), "utf8")

    const created = await runInProcess(payloadPath)
    expect(created).toMatchObject({
      code: 0,
      stderr: "",
      output: { status: "created", mapCount: 1, durablePersistence: true },
    })
    const replayed = await runInProcess(payloadPath)
    expect(replayed).toMatchObject({
      code: 0,
      stderr: "",
      output: { status: "replayed", mapCount: 0, durablePersistence: true },
    })
    expect(replayed.output?.pid).not.toBe(created.output?.pid)
    expect(replayed.output?.receiptFingerprint).toBe(created.output?.receiptFingerprint)
    expect(replayed.output?.instanceId).toBe(created.output?.instanceId)
  }, 15_000)

  it("rolls back a fault before commit and permits a clean retry after reopen", async () => {
    const path = databasePath()
    let injectFault = true
    const repository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: path,
      faultInjector(context) {
        if (injectFault && context.point === "before-commit") {
          injectFault = false
          throw new Error("injected before-commit fault")
        }
      },
    })
    const first = createDocGenLocalAdmissionFixture({ repository })
    await expect(first.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(PAYLOAD),
    })).resolves.toMatchObject({ status: "unavailable", receipt: null })
    repository.close()

    const reopenedRepository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: path,
    })
    await expect(reopenedRepository.readByIdempotency({
      tenantId: DOCGEN_LOCAL_IDENTITY.tenantId,
      principalId: DOCGEN_LOCAL_IDENTITY.principalId,
      callerKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
    })).resolves.toBeNull()
    const retried = await createDocGenLocalAdmissionFixture({ repository: reopenedRepository }).admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(PAYLOAD),
    })
    expect(retried.status).toBe("created")
    reopenedRepository.close()
  })

  it("replays a committed admission after an uncertain after-commit response", async () => {
    const path = databasePath()
    const repository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: path,
      faultInjector(context) {
        if (context.point === "after-commit") throw new Error("injected after-commit fault")
      },
    })
    const first = createDocGenLocalAdmissionFixture({ repository })
    await expect(first.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(PAYLOAD),
    })).resolves.toMatchObject({ status: "unavailable", receipt: null })
    repository.close()

    let reopenedMapCount = 0
    const reopenedRepository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: path,
    })
    const reopened = createDocGenLocalAdmissionFixture({
      repository: reopenedRepository,
      mapper: docGenLocalMapper({ onMap: () => { reopenedMapCount += 1 } }),
    })
    const replayed = await reopened.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(PAYLOAD),
    })
    expect(replayed.status).toBe("replayed")
    expect(reopenedMapCount).toBe(0)
    reopenedRepository.close()
  })

  it("fails closed when a durable record no longer matches its integrity fingerprints", async () => {
    const path = databasePath()
    const repository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: path,
    })
    const first = createDocGenLocalAdmissionFixture({ repository })
    const created = await first.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(PAYLOAD),
    })
    if (created.status !== "created") throw new Error(JSON.stringify(created.issues))
    repository.close()

    const { DatabaseSync } = await import("node:sqlite")
    const inspection = new DatabaseSync(path)
    const row = inspection.prepare("SELECT record_json FROM docgen_local_admissions").get() as {
      record_json: string
    }
    const corrupted = JSON.parse(row.record_json) as { acceptedAt: string }
    corrupted.acceptedAt = "2026-07-19T10:00:01.000Z"
    inspection.prepare("UPDATE docgen_local_admissions SET record_json = ?").run(JSON.stringify(corrupted))
    inspection.close()

    let mapCount = 0
    const reopenedRepository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: path,
    })
    await expect(reopenedRepository.readByInstanceId(created.receipt.instance.instanceId)).rejects.toThrow(
      "integrity drifted",
    )
    const reopened = createDocGenLocalAdmissionFixture({
      repository: reopenedRepository,
      mapper: docGenLocalMapper({ onMap: () => { mapCount += 1 } }),
    })
    await expect(reopened.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalAdaptedRequest(PAYLOAD),
    })).resolves.toMatchObject({ status: "unavailable", receipt: null })
    expect(mapCount).toBe(0)
    reopenedRepository.close()
  })
})
