import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
  FLOWDOC_BACKEND_PDF_EXPORT_CONTENT_STORE_V1_SOURCE,
  createFlowDocBackendPdfExportLocalOrphanMaintenanceV1,
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportLocalWorkerHostV1,
  createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
  runFlowDocBackendPdfExportLocalDueWorkEntryV1,
  type FlowDocBackendPdfExportDueWorkEntryV1,
  type FlowDocBackendPdfExportDueWorkRepositoryV1,
  type FlowDocBackendPdfExportResumableContentAddressedStoreV1,
  type FlowDocBackendPdfExportLifecycleHeadV1,
  type FlowDocBackendPdfExportLifecycleRepositoryV1,
  type FlowDocBackendPdfExportLocalWorkerExecutionInputV1,
  type FlowDocBackendPdfExportWorkflowInputV1,
} from "../index.js"
import {
  createInMemoryPdfExportWorkflowRepositories,
  createPdfExportWorkflowFixture,
  pdfExportWorkflowInput,
  type PdfExportWorkflowRepositories,
} from "./helpers/pdfExportWorkflowFixture.js"

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function contentStore() {
  const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-local-worker-"))
  roots.push(root)
  return createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
}

function dueEntry(head: FlowDocBackendPdfExportLifecycleHeadV1): FlowDocBackendPdfExportDueWorkEntryV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
    operationId: head.operationId,
    scope: head.scope,
    dueAt: head.status === "pending"
      ? head.retryAfter ?? head.updatedAt
      : head.status === "claimed"
        ? head.claim!.expiresAt
        : head.updatedAt,
    lane: head.status === "pending"
      ? "claim-ready"
      : head.status === "claimed"
        ? "claim-expired"
        : "terminal-finalization",
    headRevision: head.headRevision,
    lifecycleFingerprint: head.lifecycleFingerprint,
    head,
  }
}

async function seed(repositories: PdfExportWorkflowRepositories, operation: unknown) {
  const admitted = await repositories.operationRepository.admitOperation(operation)
  if (admitted.status !== "created" && admitted.status !== "idempotent-replay") {
    throw new Error("worker fixture operation admission failed")
  }
  const initialized = await repositories.lifecycleRepository.initializeLifecycle(operation)
  if (initialized.status !== "created" && initialized.status !== "idempotent-replay") {
    throw new Error("worker fixture lifecycle initialization failed")
  }
  return initialized.head
}

function workflowFor(
  execution: FlowDocBackendPdfExportLocalWorkerExecutionInputV1,
  fixture: ReturnType<typeof createPdfExportWorkflowFixture>,
  repositories: PdfExportWorkflowRepositories,
  store: ReturnType<typeof contentStore>,
): FlowDocBackendPdfExportWorkflowInputV1 {
  const base = pdfExportWorkflowInput({ fixture, repositories, contentStore: store })
  const executionAt = Date.parse(execution.now())
  let rendererNow = executionAt + 3
  return {
    ...base,
    worker: {
      ...base.worker,
      workerId: execution.workerId,
      claimToken: execution.claimToken,
      claimExpiresAt: execution.lifecycleHead.claim?.expiresAt ?? base.worker.claimExpiresAt,
      beforeHandoffAt: new Date(executionAt + 1).toISOString(),
    },
    rendererAttempt: {
      ...base.rendererAttempt,
      beforeRenderExpectedHeadRevision: execution.lifecycleHead.headRevision + 1,
      beforeRenderAt: new Date(executionAt + 2).toISOString(),
      now: () => new Date(rendererNow++).toISOString(),
    },
    persistence: {
      ...base.persistence,
      persistedAt: new Date(executionAt + 4_000).toISOString(),
    },
    events: {
      renderStartedAt: new Date(executionAt + 1_000).toISOString(),
      renderCompletedAt: new Date(executionAt + 2_000).toISOString(),
      persistStartedAt: new Date(executionAt + 3_000).toISOString(),
      persistCompletedAt: new Date(executionAt + 4_000).toISOString(),
      workflowCompletedAt: new Date(executionAt + 5_000).toISOString(),
    },
  }
}

function fixedNow(value = "2026-07-18T09:00:02.000Z") {
  return () => value
}

describe("PDF export LOCAL-D worker", () => {
  it("claims one due operation and executes the accepted V-F workflow", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:local-d:success" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const store = contentStore()
    const head = await seed(repositories, fixture.fixture.operation)
    const workerResult = await runFlowDocBackendPdfExportLocalDueWorkEntryV1({
      runId: "run:local-d:success",
      workerId: "worker:local-d:success",
      entry: dueEntry(head),
      claimDurationMs: 30_000,
      retryDelayMs: 1_000,
      ...repositories,
      now: fixedNow(),
      execute: (execution) => runFlowDocBackendPdfExportEndToEndCandidateV1(
        workflowFor(execution, fixture, repositories, store),
      ),
    })

    expect(workerResult).toMatchObject({
      status: "completed",
      attemptNumber: 1,
      rendererExecuted: true,
      persistenceExecuted: true,
      contracts: { concurrency: 1, productionBinding: false },
    })
    await expect(repositories.observabilityRepository.readTerminalWorkflow({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })).resolves.toMatchObject({ status: "found", completion: { terminalStatus: "completed" } })
  })

  it("reconciles a claim response interrupted after durable commit", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:local-d:claim-uncertain" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const store = contentStore()
    const head = await seed(repositories, fixture.fixture.operation)
    let interrupted = false
    const lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1 = {
      ...repositories.lifecycleRepository,
      async applyLifecycleTransition(value) {
        const applied = await repositories.lifecycleRepository.applyLifecycleTransition(value)
        if (!interrupted && typeof value === "object" && value != null && "kind" in value && value.kind === "claim") {
          interrupted = true
          throw new Error("injected-after-claim-commit")
        }
        return applied
      },
    }
    const workerResult = await runFlowDocBackendPdfExportLocalDueWorkEntryV1({
      runId: "run:local-d:claim-uncertain",
      workerId: "worker:local-d:claim-uncertain",
      entry: dueEntry(head),
      claimDurationMs: 30_000,
      retryDelayMs: 1_000,
      ...repositories,
      lifecycleRepository,
      now: fixedNow(),
      execute: (execution) => runFlowDocBackendPdfExportEndToEndCandidateV1(
        workflowFor(execution, fixture, repositories, store),
      ),
    })
    expect(interrupted).toBe(true)
    expect(workerResult).toMatchObject({ status: "completed", attemptNumber: 1 })
  })

  it("does not release ownership when terminal commit succeeded before executor interruption", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:local-d:terminal-uncertain" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const store = contentStore()
    const head = await seed(repositories, fixture.fixture.operation)
    const workerResult = await runFlowDocBackendPdfExportLocalDueWorkEntryV1({
      runId: "run:local-d:terminal-uncertain",
      workerId: "worker:local-d:terminal-uncertain",
      entry: dueEntry(head),
      claimDurationMs: 30_000,
      retryDelayMs: 1_000,
      ...repositories,
      now: fixedNow(),
      async execute(execution) {
        const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(
          workflowFor(execution, fixture, repositories, store),
        )
        expect(completed.status).toBe("completed")
        throw new Error("injected-after-terminal-commit")
      },
    })
    expect(workerResult).toMatchObject({ status: "terminal-replay", attemptNumber: 1 })
    await expect(repositories.lifecycleRepository.readLifecycle({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })).resolves.toMatchObject({
      status: "found",
      head: { status: "claimed", attemptCount: 1, lastRelease: null },
    })
  })

  it("releases blocked execution, exhausts the attempt budget, then finalizes terminal evidence", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:local-d:retry" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const store = contentStore()
    let head = await seed(repositories, fixture.fixture.operation)
    const blockedExecution = async (execution: FlowDocBackendPdfExportLocalWorkerExecutionInputV1) => {
      const invalid = workflowFor(execution, fixture, repositories, store)
      return runFlowDocBackendPdfExportEndToEndCandidateV1({ ...invalid, operation: null })
    }
    const first = await runFlowDocBackendPdfExportLocalDueWorkEntryV1({
      runId: "run:local-d:retry:first",
      workerId: "worker:local-d:retry",
      entry: dueEntry(head),
      claimDurationMs: 30_000,
      retryDelayMs: 1_000,
      ...repositories,
      now: fixedNow(),
      execute: blockedExecution,
    })
    expect(first).toMatchObject({ status: "released", attemptNumber: 1 })
    if (first.lifecycleHead == null) throw new Error("first retry must retain lifecycle")
    head = first.lifecycleHead

    const second = await runFlowDocBackendPdfExportLocalDueWorkEntryV1({
      runId: "run:local-d:retry:second",
      workerId: "worker:local-d:retry",
      entry: dueEntry(head),
      claimDurationMs: 30_000,
      retryDelayMs: 1_000,
      ...repositories,
      now: fixedNow("2026-07-18T09:00:03.000Z"),
      execute: blockedExecution,
    })
    expect(second).toMatchObject({
      status: "attempts-exhausted",
      lifecycleHead: { status: "stopped", stop: { reason: "attempts-exhausted" } },
    })
    if (second.lifecycleHead == null) throw new Error("attempt exhaustion must retain lifecycle")

    const finalized = await runFlowDocBackendPdfExportLocalDueWorkEntryV1({
      runId: "run:local-d:retry:finalize",
      workerId: "worker:local-d:retry",
      entry: dueEntry(second.lifecycleHead),
      claimDurationMs: 30_000,
      retryDelayMs: 1_000,
      ...repositories,
      now: fixedNow("2026-07-18T09:00:04.000Z"),
      execute: (execution) => runFlowDocBackendPdfExportEndToEndCandidateV1(
        workflowFor(execution, fixture, repositories, store),
      ),
    })
    expect(finalized).toMatchObject({ status: "terminated", rendererExecuted: false })
  })

  it("starts no loop until called and wakes an idle poll into a graceful drain", async () => {
    let listCount = 0
    let wakeSleep: (() => void) | null = null
    const sleepStarted = new Promise<void>((resolve) => { wakeSleep = resolve })
    const dueWorkRepository: FlowDocBackendPdfExportDueWorkRepositoryV1 = {
      dueWorkSource: FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
      async listDueWork(input) {
        listCount += 1
        return { status: "ready", observedAt: input.observedAt, entries: [], nextCursor: null, issues: [] }
      },
    }
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const host = createFlowDocBackendPdfExportLocalWorkerHostV1({
      hostId: "host:local-d:drain",
      workerId: "worker:local-d:drain",
      runId: "run:local-d:drain",
      createdAt: "2026-07-18T09:00:01.000Z",
      dueWorkRepository,
      ...repositories,
      now: fixedNow(),
      execute: async () => { throw new Error("idle host must not execute") },
      sleep: (_milliseconds, signal) => new Promise((resolve) => {
        wakeSleep?.()
        signal.addEventListener("abort", () => resolve(), { once: true })
      }),
    })
    expect(host.facts).toMatchObject({ automaticStartOnImport: false, concurrency: 1 })
    expect(listCount).toBe(0)
    const running = host.start()
    await sleepStarted
    expect(listCount).toBe(1)
    expect(host.beginDrain()).toMatchObject({ status: "stopped", state: { stopReason: "shutdown-drain-complete" } })
    await expect(running).resolves.toMatchObject({
      cycleCount: 1,
      drain: { status: "stopped", stopReason: "shutdown-drain-complete" },
    })
  })

  it("schedules one bounded orphan page per invocation and retains its cursor across cycles", async () => {
    const storageKeys = ["first", "second"].map((value) =>
      `pdf-export-v1.sha256.${createHash("sha256").update(value).digest("hex")}.pdf`)
    const scans: Array<string | null> = []
    const deleted: string[] = []
    const store: FlowDocBackendPdfExportResumableContentAddressedStoreV1 = {
      source: FLOWDOC_BACKEND_PDF_EXPORT_CONTENT_STORE_V1_SOURCE,
      async write() { throw new Error("not used") },
      async read() { throw new Error("not used") },
      async scan() { throw new Error("not used") },
      async scanPage(input) {
        scans.push(input.cursor)
        const index = input.cursor == null ? 0 : 1
        const storageKey = storageKeys[index]!
        return {
          status: "ready",
          candidates: [{
            storageKey,
            sha256: storageKey.slice("pdf-export-v1.sha256.".length, -".pdf".length),
            byteLength: 32,
            modifiedAt: "2026-07-18T08:00:00.000Z",
            storageLocator: `fake://${storageKey}`,
          }],
          scannedCount: 1,
          truncated: index === 0,
          nextCursor: index === 0 ? "cursor:second" : null,
          issues: [],
        }
      },
      async delete(input) {
        deleted.push(input.storageKey)
        return { status: "deleted", issues: [] }
      },
    }
    const maintenance = createFlowDocBackendPdfExportLocalOrphanMaintenanceV1({
      createdAt: "2026-07-18T10:00:00.000Z",
      intervalMs: 60_000,
      unavailableBackoffMs: 1_000,
      gracePeriodMs: 60_000,
      maxScanCount: 1,
      maxDeleteCount: 1,
      contentStore: store,
      persistenceRepository: createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1(),
    })
    expect(scans).toEqual([])
    await expect(maintenance.runIfDue({ observedAt: "2026-07-18T10:00:00.000Z" })).resolves.toMatchObject({
      status: "completed",
      inputCursorPresent: false,
      nextCursorPresent: true,
      deletedCount: 1,
      nextRunAt: "2026-07-18T10:00:00.000Z",
    })
    await expect(maintenance.runIfDue({ observedAt: "2026-07-18T10:00:00.000Z" })).resolves.toMatchObject({
      status: "completed",
      inputCursorPresent: true,
      nextCursorPresent: false,
      deletedCount: 1,
      nextRunAt: "2026-07-18T10:01:00.000Z",
    })
    await expect(maintenance.runIfDue({ observedAt: "2026-07-18T10:00:30.000Z" })).resolves.toMatchObject({
      status: "deferred",
      scannedCount: 0,
    })
    expect(scans).toEqual([null, "cursor:second"])
    expect(deleted).toEqual(storageKeys)
  })

  it("forces the active lifecycle to stop and lets the workflow retain terminal evidence", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:local-d:force" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const store = contentStore()
    const head = await seed(repositories, fixture.fixture.operation)
    let releaseExecution: () => void = () => undefined
    const executionStarted = new Promise<void>((resolveStarted) => {
      releaseExecution = resolveStarted
    })
    let startExecution: (() => void) | null = null
    const enteredExecution = new Promise<void>((resolve) => { startExecution = resolve })
    let listed = false
    const dueWorkRepository: FlowDocBackendPdfExportDueWorkRepositoryV1 = {
      dueWorkSource: FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
      async listDueWork(input) {
        if (listed) return { status: "ready", observedAt: input.observedAt, entries: [], nextCursor: null, issues: [] }
        listed = true
        return { status: "ready", observedAt: input.observedAt, entries: [dueEntry(head)], nextCursor: null, issues: [] }
      },
    }
    const host = createFlowDocBackendPdfExportLocalWorkerHostV1({
      hostId: "host:local-d:force",
      workerId: "worker:local-d:force",
      runId: "run:local-d:force",
      createdAt: "2026-07-18T09:00:01.000Z",
      dueWorkRepository,
      ...repositories,
      now: fixedNow(),
      async execute(execution) {
        startExecution?.()
        await executionStarted
        return runFlowDocBackendPdfExportEndToEndCandidateV1(
          workflowFor(execution, fixture, repositories, store),
        )
      },
      sleep: async () => undefined,
    })
    const running = host.start()
    await enteredExecution
    await expect(host.forceStop()).resolves.toMatchObject({ status: "stopped", state: { stopReason: "shutdown-forced" } })
    const stopped = await repositories.lifecycleRepository.readLifecycle({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })
    expect(stopped).toMatchObject({ status: "found", head: { status: "stopped", stop: { reason: "shutdown-forced" } } })
    releaseExecution()
    await expect(running).resolves.toMatchObject({
      invokedCount: 1,
      counts: { terminated: 1 },
      drain: { stopReason: "shutdown-forced" },
    })
  })
})
import { createHash } from "node:crypto"
