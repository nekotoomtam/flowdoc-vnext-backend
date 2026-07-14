import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import {
  FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1,
  FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_V1_SOURCE,
  advanceFlowDocBackendCompositionV1,
  assessFlowDocBackendCompositionRepositoryReadinessV1,
  cancelFlowDocBackendCompositionV1,
  compositionFingerprint,
  createFlowDocBackendCompositionSqliteRepositoryV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  finalizeFlowDocBackendCompositionRepositoryConformanceReportV1,
  finalizeFlowDocBackendCompositionV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionRepositoryConformanceScenarioIdV1,
  type FlowDocBackendCompositionRepositoryConformanceScenarioV1,
  type FlowDocBackendCompositionSqliteFaultContextV1,
} from "../index.js"
import { contentRef, createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const workerPath = fileURLToPath(new URL("./helpers/compositionSchedulerSqliteConformanceWorker.ts", import.meta.url))
const fp = (value: string) => compositionFingerprint({ value })
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8")

interface WorkerPayload {
  databasePath: string
  action: "create-head" | "compare-and-swap-head" | "put-immutable-admitted"
  input: unknown
  fault?: FlowDocBackendCompositionSqliteFaultContextV1 | null
}

interface WorkerRun {
  pid: number
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  output: { pid: number; result: { status: string; [key: string]: unknown } } | null
}

function leasedHead(
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
  leaseToken: string,
): FlowDocBackendCompositionJobHeadV1 {
  const { fingerprint: _fingerprint, ...facts } = fixture.waitingHead
  const result = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    value: {
      ...facts,
      headRevision: 1,
      lease: {
        attemptId: `attempt-${leaseToken}`,
        leaseToken,
        acquiredAt: "2026-07-13T08:00:00.000Z",
        expiresAt: "2026-07-13T08:05:00.000Z",
      },
    },
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.jobHead
}

describe("composition scheduler SQLite trusted conformance runner", () => {
  const roots: string[] = []
  let payloadNumber = 0

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  function root() {
    const value = mkdtempSync(join(tmpdir(), "flowdoc-sqlite-conformance-"))
    roots.push(value)
    return value
  }

  function runWorker(payloadRoot: string, payload: WorkerPayload): Promise<WorkerRun> {
    payloadNumber += 1
    const payloadPath = join(payloadRoot, `worker-payload-${payloadNumber}.json`)
    writeFileSync(payloadPath, JSON.stringify(payload), "utf8")
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
        let output: WorkerRun["output"] = null
        if (stdout.trim().length > 0) output = JSON.parse(stdout) as WorkerRun["output"]
        resolve({ pid: child.pid ?? -1, code, signal, stdout, stderr, output })
      })
    })
  }

  function createInput(fixture: ReturnType<typeof createCompositionSchedulerFixture>, requestId: string) {
    return {
      createRequestId: requestId,
      requestFingerprint: fp(requestId),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    }
  }

  async function prepareTransition(databasePath: string, requestId: string) {
    const fixture = createCompositionSchedulerFixture()
    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
    await repository.createHead(createInput(fixture, `create-${requestId}`))
    const windowRef = contentRef(fixture.sourcePin.jobId, "family-window", `window-${requestId}`, fixture.window.fingerprint, bytes(fixture.window))
    const chunkRef = contentRef(fixture.sourcePin.jobId, "closed-page-chunk", `chunk-${requestId}`, fixture.pageChunk.fingerprint, bytes(fixture.pageChunk))
    const receiptRef = contentRef(fixture.sourcePin.jobId, "transition-receipt", `receipt-${requestId}`, fixture.receipt.fingerprint, bytes(fixture.receipt))
    for (const [ref, value] of [
      [windowRef, fixture.window],
      [chunkRef, fixture.pageChunk],
      [receiptRef, fixture.receipt],
    ] as const) await repository.putImmutable({ ref, value })
    const lease = leasedHead(fixture, requestId)
    const leased = await repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: lease,
    })
    expect(leased.status).toBe("committed")
    repository.close()
    const committedRequest = {
      requestId: fixture.receipt.transitionRequestId,
      requestFingerprint: fixture.receipt.requestFingerprint,
      receiptRef,
    }
    return {
      fixture,
      lease,
      refs: { windowRef, chunkRef, receiptRef },
      committedRequest,
      casInput: {
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: 1,
        expectedHeadFingerprint: lease.fingerprint,
        nextHead: fixture.readyToFinalizeHead,
        committedRequest,
      },
    }
  }

  it("produces one passing report from real independent processes and crash boundaries", async () => {
    const fixture = createCompositionSchedulerFixture()
    const scenarioResults: FlowDocBackendCompositionRepositoryConformanceScenarioV1[] = []
    const processIds = new Set<number>()
    let restartCount = 0

    function passed(
      scenarioId: FlowDocBackendCompositionRepositoryConformanceScenarioIdV1,
      facts: object,
      assertionCount: number,
    ) {
      scenarioResults.push({
        scenarioId,
        status: "passed",
        assertionCount,
        evidenceFingerprint: compositionFingerprint({ scenarioId, facts }),
      })
    }

    const createRoot = root()
    const createDatabase = join(createRoot, "create.sqlite")
    const createPayload: WorkerPayload = {
      databasePath: createDatabase,
      action: "create-head",
      input: createInput(fixture, "conformance-create"),
    }
    const createRuns = await Promise.all([
      runWorker(createRoot, createPayload),
      runWorker(createRoot, createPayload),
    ])
    createRuns.forEach((run) => processIds.add(run.pid))
    expect(createRuns.every((run) => run.code === 0)).toBe(true)
    const createStatuses = createRuns.map((run) => run.output?.result.status).sort()
    expect(createStatuses).toEqual(["created", "idempotent-replay"])
    const createdRepository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: createDatabase })
    expect(await createdRepository.readHead(fixture.sourcePin.jobId)).toMatchObject({ status: "found", head: { headRevision: 0 } })
    createdRepository.close()
    restartCount += 1
    passed("atomic-head-create", { createStatuses }, 3)

    const immutableRoot = root()
    const immutableDatabase = join(immutableRoot, "immutable.sqlite")
    const immutableRepository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: immutableDatabase })
    const valueA = { fingerprint: fp("immutable-a") }
    const valueB = { fingerprint: fp("immutable-b") }
    const refA = contentRef(fixture.sourcePin.jobId, "family-window", "immutable-a", valueA.fingerprint, bytes(valueA))
    const refB = contentRef(fixture.sourcePin.jobId, "family-window", "immutable-b", valueB.fingerprint, bytes(valueB))
    expect(await immutableRepository.putImmutable({ ref: refA, value: valueA })).toMatchObject({ status: "written" })
    const idConflict = await immutableRepository.putImmutable({
      ref: { ...refB, recordId: refA.recordId },
      value: valueB,
    })
    expect(idConflict).toMatchObject({ status: "conflict" })
    passed("immutable-record-id-uniqueness", { status: idConflict.status }, 2)
    const fingerprintConflict = await immutableRepository.putImmutable({
      ref: { ...refA, recordId: "immutable-a-alias" },
      value: valueA,
    })
    expect(fingerprintConflict).toMatchObject({ status: "conflict" })
    passed("immutable-fingerprint-uniqueness", { status: fingerprintConflict.status }, 2)
    expect(await immutableRepository.putImmutable({ ref: refB, value: valueB })).toMatchObject({ status: "written" })
    const batch = await immutableRepository.readImmutableBatch({
      jobId: fixture.sourcePin.jobId,
      refs: [refB, refA],
    })
    expect(batch).toMatchObject({ status: "found", records: [{ ref: refB }, { ref: refA }] })
    const missingBatch = await immutableRepository.readImmutableBatch({
      jobId: fixture.sourcePin.jobId,
      refs: [refB, { ...refA, recordId: "missing-batch-record" }],
    })
    expect(missingBatch.status).toBe("not-found")
    immutableRepository.close()
    passed("ordered-batch-read-integrity", { ordered: batch.status, missing: missingBatch.status }, 3)

    const raceRoot = root()
    const raceDatabase = join(raceRoot, "race.sqlite")
    const raceRepository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: raceDatabase })
    await raceRepository.createHead(createInput(fixture, "conformance-race"))
    raceRepository.close()
    const raceRuns = await Promise.all([
      runWorker(raceRoot, {
        databasePath: raceDatabase,
        action: "compare-and-swap-head",
        input: {
          jobId: fixture.sourcePin.jobId,
          expectedHeadRevision: 0,
          expectedHeadFingerprint: fixture.waitingHead.fingerprint,
          nextHead: leasedHead(fixture, "process-race-a"),
        },
      }),
      runWorker(raceRoot, {
        databasePath: raceDatabase,
        action: "compare-and-swap-head",
        input: {
          jobId: fixture.sourcePin.jobId,
          expectedHeadRevision: 0,
          expectedHeadFingerprint: fixture.waitingHead.fingerprint,
          nextHead: leasedHead(fixture, "process-race-b"),
        },
      }),
    ])
    raceRuns.forEach((run) => processIds.add(run.pid))
    expect(raceRuns.every((run) => run.code === 0)).toBe(true)
    const raceStatuses = raceRuns.map((run) => run.output?.result.status).sort()
    expect(raceStatuses).toEqual(["committed", "stale"])
    passed("independent-handle-cas", { raceStatuses, pids: raceRuns.map((run) => run.pid) }, 3)

    const transitionRoot = root()
    const transitionDatabase = join(transitionRoot, "transition.sqlite")
    const transition = await prepareTransition(transitionDatabase, "atomic-transition")
    const transitionRun = await runWorker(transitionRoot, {
      databasePath: transitionDatabase,
      action: "compare-and-swap-head",
      input: transition.casInput,
    })
    processIds.add(transitionRun.pid)
    expect(transitionRun).toMatchObject({ code: 0, output: { result: { status: "committed" } } })
    const transitionRead = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: transitionDatabase })
    const transitionHead = await transitionRead.readHead(fixture.sourcePin.jobId)
    const transitionReplay = await transitionRead.readCommittedRequest({
      jobId: fixture.sourcePin.jobId,
      requestId: transition.committedRequest.requestId,
    })
    expect(transitionHead).toMatchObject({ status: "found", head: { headRevision: 2 } })
    expect(transitionReplay).toMatchObject({ status: "found", head: { headRevision: 2 } })
    transitionRead.close()
    restartCount += 1
    passed("atomic-transition-request-commit", {
      workerStatus: transitionRun.output?.result.status,
      headStatus: transitionHead.status,
      replayStatus: transitionReplay.status,
    }, 3)

    const crashBeforeRoot = root()
    const crashBeforeDatabase = join(crashBeforeRoot, "crash-before.sqlite")
    const crashBefore = await prepareTransition(crashBeforeDatabase, "crash-before")
    const crashBeforeRun = await runWorker(crashBeforeRoot, {
      databasePath: crashBeforeDatabase,
      action: "compare-and-swap-head",
      input: crashBefore.casInput,
      fault: { transactionKind: "head-cas", point: "before-commit" },
    })
    processIds.add(crashBeforeRun.pid)
    expect(crashBeforeRun.code).toBe(86)
    const crashBeforeRead = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: crashBeforeDatabase })
    const priorHead = await crashBeforeRead.readHead(fixture.sourcePin.jobId)
    const absentReplay = await crashBeforeRead.readCommittedRequest({
      jobId: fixture.sourcePin.jobId,
      requestId: crashBefore.committedRequest.requestId,
    })
    expect(priorHead).toMatchObject({ status: "found", head: { headRevision: 1 } })
    expect(absentReplay.status).toBe("not-found")
    crashBeforeRead.close()
    restartCount += 1
    passed("crash-before-commit-recovery", { exitCode: crashBeforeRun.code, head: 1, replay: absentReplay.status }, 3)

    const crashAfterRoot = root()
    const crashAfterDatabase = join(crashAfterRoot, "crash-after.sqlite")
    const crashAfter = await prepareTransition(crashAfterDatabase, "crash-after")
    const crashAfterRun = await runWorker(crashAfterRoot, {
      databasePath: crashAfterDatabase,
      action: "compare-and-swap-head",
      input: crashAfter.casInput,
      fault: { transactionKind: "head-cas", point: "after-commit" },
    })
    processIds.add(crashAfterRun.pid)
    expect(crashAfterRun.code).toBe(86)
    const crashAfterRead = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: crashAfterDatabase })
    const committedHead = await crashAfterRead.readHead(fixture.sourcePin.jobId)
    const retainedReplay = await crashAfterRead.readCommittedRequest({
      jobId: fixture.sourcePin.jobId,
      requestId: crashAfter.committedRequest.requestId,
    })
    const exactReplay = await crashAfterRead.compareAndSwapHead(crashAfter.casInput)
    expect(committedHead).toMatchObject({ status: "found", head: { headRevision: 2 } })
    expect(retainedReplay.status).toBe("found")
    expect(exactReplay.status).toBe("idempotent-replay")
    const reopenedImmutable = await crashAfterRead.readImmutable({
      jobId: crashAfter.refs.receiptRef.jobId,
      recordId: crashAfter.refs.receiptRef.recordId,
    })
    expect(reopenedImmutable.status).toBe("found")
    crashAfterRead.close()
    restartCount += 1
    passed("crash-after-commit-replay", { exitCode: crashAfterRun.code, head: 2, replay: exactReplay.status }, 4)
    passed("process-restart-recovery", {
      restartCount,
      head: committedHead.status,
      immutable: reopenedImmutable.status,
      replay: retainedReplay.status,
    }, 4)

    const quotaRoot = root()
    const quotaDatabase = join(quotaRoot, "quota.sqlite")
    const quotaInitializer = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: quotaDatabase })
    quotaInitializer.close()
    const quotaA = { fingerprint: fp("quota-a") }
    const quotaB = { fingerprint: fp("quota-b") }
    const quotaRefA = contentRef(fixture.sourcePin.jobId, "family-window", "quota-a", quotaA.fingerprint, bytes(quotaA))
    const quotaRefB = contentRef(fixture.sourcePin.jobId, "family-window", "quota-b", quotaB.fingerprint, bytes(quotaB))
    const quotaRuns = await Promise.all([
      runWorker(quotaRoot, {
        databasePath: quotaDatabase,
        action: "put-immutable-admitted",
        input: {
          ref: quotaRefA,
          value: quotaA,
          storedAt: "2026-07-13T07:00:00.000Z",
          maximumPhysicalByteCount: quotaRefA.byteLength,
        },
      }),
      runWorker(quotaRoot, {
        databasePath: quotaDatabase,
        action: "put-immutable-admitted",
        input: {
          ref: quotaRefB,
          value: quotaB,
          storedAt: "2026-07-13T07:00:00.000Z",
          maximumPhysicalByteCount: quotaRefA.byteLength,
        },
      }),
    ])
    quotaRuns.forEach((run) => processIds.add(run.pid))
    expect(quotaRuns.every((run) => run.code === 0)).toBe(true)
    const quotaStatuses = quotaRuns.map((run) => run.output?.result.status).sort()
    expect(quotaStatuses).toEqual(["physical-quota-exceeded", "written"])
    const quotaRead = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: quotaDatabase })
    const physicalUsage = await quotaRead.inspectPhysicalUsage(fixture.sourcePin.jobId)
    expect(physicalUsage).toMatchObject({ status: "ready", usage: { recordCount: 1, byteCount: quotaRefA.byteLength } })
    quotaRead.close()
    passed("physical-quota-admission", { quotaStatuses, usage: physicalUsage.usage }, 3)

    const cleanupRoot = root()
    const cleanupDatabase = join(cleanupRoot, "cleanup.sqlite")
    const cleanupRepository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: cleanupDatabase })
    const protectedValue = { fingerprint: fp("cleanup-protected") }
    const orphanValue = { fingerprint: fp("cleanup-orphan") }
    const protectedRef = contentRef(fixture.sourcePin.jobId, "source-snapshot", "cleanup-protected", protectedValue.fingerprint, bytes(protectedValue))
    const orphanRef = contentRef(fixture.sourcePin.jobId, "family-window", "cleanup-orphan", orphanValue.fingerprint, bytes(orphanValue))
    await cleanupRepository.putImmutableWithPhysicalAdmission({
      ref: protectedRef,
      value: protectedValue,
      storedAt: "2026-07-13T07:00:00.000Z",
      maximumPhysicalByteCount: protectedRef.byteLength + orphanRef.byteLength,
    })
    await cleanupRepository.putImmutableWithPhysicalAdmission({
      ref: orphanRef,
      value: orphanValue,
      storedAt: "2026-07-13T07:00:00.000Z",
      maximumPhysicalByteCount: protectedRef.byteLength + orphanRef.byteLength,
    })
    await cleanupRepository.createHead(createInput(fixture, "conformance-cleanup"))
    const cancelled = await cancelFlowDocBackendCompositionV1({
      repository: cleanupRepository,
      expectation: {
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: 0,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      },
      requestedAt: new Date(Date.parse(fixture.waitingHead.updatedAt) + 1_000).toISOString(),
    })
    if (cancelled.status !== "updated") throw new Error("cleanup fixture cancellation failed")
    const cleanup = await cleanupRepository.cleanupUnreachable({
      jobId: fixture.sourcePin.jobId,
      expectedHeadFingerprint: cancelled.jobHead.fingerprint,
      reachableRefs: [protectedRef],
      storedBefore: "2026-07-13T08:00:00.000Z",
      maximumDeleteCount: 1,
    })
    expect(cleanup).toMatchObject({ status: "completed", deletedRefs: [orphanRef], usage: { recordCount: 1 } })
    expect(await cleanupRepository.readImmutable({ jobId: protectedRef.jobId, recordId: protectedRef.recordId })).toMatchObject({ status: "found" })
    expect(await cleanupRepository.readImmutable({ jobId: orphanRef.jobId, recordId: orphanRef.recordId })).toMatchObject({ status: "not-found" })
    cleanupRepository.close()
    passed("unreachable-record-cleanup", { status: cleanup.status, deleted: 1, protected: 1 }, 4)

    const finalizationRoot = root()
    const finalizationDatabase = join(finalizationRoot, "finalization.sqlite")
    const finalizationRepository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: finalizationDatabase })
    await finalizationRepository.createHead(createInput(fixture, "conformance-finalization"))
    const advanced = await advanceFlowDocBackendCompositionV1({
      repository: finalizationRepository,
      request: {
        requestId: "advance-conformance-finalization",
        jobId: fixture.waitingHead.jobId,
        expectedHeadRevision: 0,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
        demandFingerprint: fixture.waitingHead.demand!.fingerprint,
        windowFingerprint: fixture.window.fingerprint,
      },
      attempt: {
        attemptId: "attempt-advance-conformance-finalization",
        leaseToken: "lease-advance-conformance-finalization",
        acquiredAt: "2026-07-13T08:01:00.000Z",
        completedAt: "2026-07-13T08:01:01.000Z",
        leaseExpiresAt: "2026-07-13T08:05:00.000Z",
      },
      window: fixture.window,
    })
    if (advanced.status !== "advanced") throw new Error(`finalization advancement failed: ${advanced.status}`)
    const finalized = await finalizeFlowDocBackendCompositionV1({
      repository: finalizationRepository,
      request: {
        requestId: "finalize-conformance-document",
        jobId: advanced.jobHead.jobId,
        expectedHeadRevision: advanced.jobHead.headRevision,
        expectedHeadFingerprint: advanced.jobHead.fingerprint,
      },
      attempt: {
        attemptId: "attempt-finalize-conformance-document",
        leaseToken: "lease-finalize-conformance-document",
        acquiredAt: "2026-07-13T08:02:00.000Z",
        completedAt: "2026-07-13T08:02:01.000Z",
        leaseExpiresAt: "2026-07-13T08:05:00.000Z",
      },
    })
    expect(finalized).toMatchObject({ status: "completed", jobHead: { status: "completed" } })
    if (finalized.status !== "completed") throw new Error("conformance finalization failed")
    finalizationRepository.close()
    const finalizationRead = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: finalizationDatabase })
    const finalizationReplay = await finalizationRead.readCommittedFinalization({
      jobId: finalized.jobHead.jobId,
      requestId: "finalize-conformance-document",
    })
    expect(finalizationReplay).toMatchObject({
      status: "found",
      pagePlanRef: finalized.jobHead.finalOutput!.pagePlanRef,
      headingPageMapRef: finalized.jobHead.finalOutput!.headingPageMapRef,
      head: { status: "completed" },
    })
    finalizationRead.close()
    restartCount += 1
    passed("atomic-finalization-request-commit", {
      completed: finalized.status,
      replay: finalizationReplay.status,
      plan: finalized.jobHead.finalOutput!.pagePlanRef.recordFingerprint,
      map: finalized.jobHead.finalOutput!.headingPageMapRef.recordFingerprint,
    }, 4)

    expect(scenarioResults.map((scenario) => scenario.scenarioId).sort()).toEqual(
      [...FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1].sort(),
    )
    const reportResult = finalizeFlowDocBackendCompositionRepositoryConformanceReportV1({
      source: FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_V1_SOURCE,
      schemaVersion: 1,
      kind: "composition-repository-conformance-report",
      adapterId: "node-sqlite-composition-candidate",
      adapterVersion: "candidate-v1",
      storageTechnology: "node-sqlite-wal",
      runnerId: "sqlite-child-process-conformance-runner-v1",
      runId: "phase-393-local-ci",
      startedAt: "2026-07-14T05:00:00.000Z",
      completedAt: "2026-07-14T05:30:00.000Z",
      independentProcessCount: processIds.size,
      independentRepositoryHandleCount: processIds.size,
      restartCount,
      batchReadRecordCount: 2,
      physicalQuotaLimitByteCount: quotaRefA.byteLength,
      physicalQuotaRejectedWriteCount: quotaStatuses.filter((status) => status === "physical-quota-exceeded").length,
      orphanCandidateCount: 1,
      orphanDeletedCount: cleanup.deletedRefs?.length ?? 0,
      scenarios: scenarioResults,
    })
    expect(reportResult.status).toBe("ready")
    if (reportResult.status === "blocked") throw new Error(reportResult.issues[0]?.message)
    const reportPath = join(finalizationRoot, "conformance-report.json")
    writeFileSync(reportPath, JSON.stringify(reportResult.report), "utf8")
    const reopenedReport = JSON.parse(readFileSync(reportPath, "utf8")) as unknown
    expect(assessFlowDocBackendCompositionRepositoryReadinessV1(reopenedReport)).toMatchObject({
      status: "ready",
      report: {
        adapterId: "node-sqlite-composition-candidate",
        independentProcessCount: processIds.size,
        restartCount,
        scenarios: expect.arrayContaining([
          expect.objectContaining({ scenarioId: "crash-before-commit-recovery", status: "passed" }),
          expect.objectContaining({ scenarioId: "crash-after-commit-replay", status: "passed" }),
        ]),
      },
    })
    expect(processIds.size).toBeGreaterThanOrEqual(2)
    expect(restartCount).toBeGreaterThanOrEqual(1)
  }, 120_000)
})
