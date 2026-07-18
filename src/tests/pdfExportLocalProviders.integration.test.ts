import { createHash, randomBytes } from "node:crypto"
import { Pool } from "pg"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportLocalPostgresRepositoriesV1,
  createFlowDocBackendPdfExportLocalHttpCompositionV1,
  createFlowDocBackendPdfExportLocalWorkerHostV1,
  createFlowDocBackendPdfExportS3ContentAddressedStoreV1,
  ensureFlowDocBackendPdfExportLocalS3BucketV1,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256,
  loadFlowDocBackendPdfExportLocalHttpConfigV1,
  migrateFlowDocBackendPdfExportLocalPostgresV1,
  reconcileFlowDocBackendPdfExportResumableOrphanContentV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
  type FlowDocBackendPdfExportDueWorkRepositoryV1,
  type FlowDocBackendPdfExportLocalWorkerExecutionInputV1,
  type FlowDocBackendPdfExportLocalPostgresRepositoryFaultsV1,
  type FlowDocBackendPdfExportLocalPostgresRepositoriesV1,
  type FlowDocBackendPdfExportS3ContentAddressedStoreV1,
  type FlowDocBackendPdfExportWorkflowInputV1,
} from "../index.js"
import {
  createFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1,
} from "../localPdfExport/pdfExportLocalCompositionFactory.js"
import {
  createPdfExportWorkflowFixture,
  pdfExportWorkflowInput,
} from "./helpers/pdfExportWorkflowFixture.js"
import { createPdfExportOperationFixture } from "./helpers/pdfExportOperationFixture.js"

const LOCAL_INTEGRATION = process.env.FLOWDOC_PDF_LOCAL_INTEGRATION === "1"
const localDescribe = LOCAL_INTEGRATION ? describe : describe.skip
const runId = randomBytes(6).toString("hex")
const openRepositories: FlowDocBackendPdfExportLocalPostgresRepositoriesV1[] = []
const openStores: FlowDocBackendPdfExportS3ContentAddressedStoreV1[] = []

function required(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

function postgresOptions() {
  return {
    runtimeProfile: "local-integration" as const,
    connectionString: required("FLOWDOC_PDF_LOCAL_POSTGRES_URL"),
    maximumPoolSize: 4,
    statementTimeoutMs: 15_000,
    lockTimeoutMs: 5_000,
  }
}

function s3Options(prefix = `pdf-export-content-v1/${runId}/`) {
  return {
    runtimeProfile: "local-integration" as const,
    endpoint: required("FLOWDOC_PDF_LOCAL_S3_ENDPOINT"),
    region: required("FLOWDOC_PDF_LOCAL_S3_REGION"),
    bucket: required("FLOWDOC_PDF_LOCAL_S3_BUCKET"),
    accessKeyId: required("FLOWDOC_PDF_LOCAL_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("FLOWDOC_PDF_LOCAL_S3_SECRET_ACCESS_KEY"),
    prefix,
  }
}

async function repositories(faultInjectors?: FlowDocBackendPdfExportLocalPostgresRepositoryFaultsV1) {
  const value = await createFlowDocBackendPdfExportLocalPostgresRepositoriesV1({
    ...postgresOptions(),
    faultInjectors,
  })
  openRepositories.push(value)
  return value
}

async function store(prefix?: string) {
  const value = await createFlowDocBackendPdfExportS3ContentAddressedStoreV1(s3Options(prefix))
  openStores.push(value)
  return value
}

async function closeRepositories(value: FlowDocBackendPdfExportLocalPostgresRepositoriesV1) {
  await value.close()
  const index = openRepositories.indexOf(value)
  if (index >= 0) openRepositories.splice(index, 1)
}

function closeStore(value: FlowDocBackendPdfExportS3ContentAddressedStoreV1) {
  value.close()
  const index = openStores.indexOf(value)
  if (index >= 0) openStores.splice(index, 1)
}

function workerWorkflow(
  execution: FlowDocBackendPdfExportLocalWorkerExecutionInputV1,
  fixture: ReturnType<typeof createPdfExportWorkflowFixture>,
  workerRepositories: FlowDocBackendPdfExportLocalPostgresRepositoriesV1,
  contentStore: FlowDocBackendPdfExportS3ContentAddressedStoreV1,
): FlowDocBackendPdfExportWorkflowInputV1 {
  const base = pdfExportWorkflowInput({
    fixture,
    repositories: workerRepositories,
    contentStore,
  })
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

beforeAll(async () => {
  if (!LOCAL_INTEGRATION) return
  await migrateFlowDocBackendPdfExportLocalPostgresV1({
    ...postgresOptions(),
    appliedAt: new Date().toISOString(),
  })
  await ensureFlowDocBackendPdfExportLocalS3BucketV1(s3Options())
}, 60_000)

afterAll(async () => {
  openStores.splice(0).forEach((value) => value.close())
  await Promise.all(openRepositories.splice(0).map((value) => value.close()))
})

afterEach(async () => {
  if (!LOCAL_INTEGRATION) return
  openStores.splice(0).forEach((value) => value.close())
  await Promise.all(openRepositories.splice(0).map((value) => value.close()))
  const pool = new Pool({ connectionString: postgresOptions().connectionString, max: 1 })
  try {
    await pool.query(`
      TRUNCATE TABLE
        flowdoc_pdf_export_observability_events_v1,
        flowdoc_pdf_export_workflow_completions_v1,
        flowdoc_pdf_export_artifact_receipts_v1,
        flowdoc_pdf_export_artifact_jobs_v1,
        flowdoc_pdf_export_artifact_manifests_v1,
        flowdoc_pdf_export_lifecycle_transitions_v1,
        flowdoc_pdf_export_lifecycle_heads_v1,
        flowdoc_pdf_export_operations_v1
    `)
  } finally {
    await pool.end()
  }
})

localDescribe("PDF export LOCAL-C PostgreSQL and S3-compatible integration", () => {
  it("runs LOCAL-E request-to-download through separate HTTP and worker provider compositions", async () => {
    const token = `local-e-portable-${randomBytes(32).toString("base64url")}`
    const prefix = `pdf-export-content-v1/${runId}/local-e/`
    const config = loadFlowDocBackendPdfExportLocalHttpConfigV1({
      cwd: process.cwd(),
      env: {
        ...process.env,
        FLOWDOC_PDF_LOCAL_HTTP_HOST: "127.0.0.1",
        FLOWDOC_PDF_LOCAL_HTTP_PORT: "4012",
        FLOWDOC_PDF_LOCAL_BEARER_TOKEN: token,
        FLOWDOC_PDF_LOCAL_S3_PREFIX: prefix,
      },
    })
    const http = await createFlowDocBackendPdfExportLocalHttpCompositionV1({
      config,
      listenerPortOverride: 0,
    })
    const previousPrefix = process.env.FLOWDOC_PDF_LOCAL_S3_PREFIX
    process.env.FLOWDOC_PDF_LOCAL_S3_PREFIX = prefix
    let worker: Awaited<ReturnType<typeof createFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1>>
    try {
      worker = await createFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1()
    } finally {
      if (previousPrefix == null) delete process.env.FLOWDOC_PDF_LOCAL_S3_PREFIX
      else process.env.FLOWDOC_PDF_LOCAL_S3_PREFIX = previousPrefix
    }
    try {
      const mounted = await http.server.start()
      expect(mounted).toMatchObject({
        runtimeProfile: "local-integration",
        localServerMounted: true,
        defaultApplicationServerMounted: false,
        listenerScope: "loopback-only",
        workerStart: "dedicated-command",
        remoteProviderCallsAllowed: false,
        productionBinding: false,
      })
      const origin = `http://127.0.0.1:${mounted.listenerPort}`
      const requestHeaders = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": `caller-key:local-e:portable:${runId}`,
      }
      const admitted = await fetch(`${origin}/pdf-exports`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
          documentRevision: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
        }),
      })
      expect(admitted.status).toBe(202)
      expect(admitted.headers.get("access-control-allow-origin")).toBeNull()
      const admittedBody = await admitted.json() as {
        status: string
        export: { operationId: string; state: string }
      }
      expect(admittedBody).toMatchObject({ status: "created", export: { state: "pending" } })

      const cycle = await worker.host.runCycle()
      expect(cycle).toMatchObject({
        status: "completed",
        listedCount: 1,
        invokedCount: 1,
        counts: { completed: 1 },
        contracts: { concurrency: 1, productionBinding: false },
      })
      expect(cycle.results[0]).toMatchObject({
        operationId: admittedBody.export.operationId,
        status: "completed",
        rendererExecuted: true,
        persistenceExecuted: true,
      })

      const status = await fetch(`${origin}/pdf-exports/${encodeURIComponent(admittedBody.export.operationId)}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(status.status).toBe(200)
      await expect(status.json()).resolves.toMatchObject({
        status: "found",
        export: {
          operationId: admittedBody.export.operationId,
          state: "completed",
          terminalStatus: "completed",
          pageCount: 13,
          byteLength: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH,
        },
      })

      const download = await fetch(
        `${origin}/pdf-exports/${encodeURIComponent(admittedBody.export.operationId)}/download`,
        { headers: { authorization: `Bearer ${token}` } },
      )
      expect(download.status).toBe(200)
      expect(download.headers.get("content-type")).toBe("application/pdf")
      const bytes = new Uint8Array(await download.arrayBuffer())
      expect(bytes.byteLength).toBe(FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH)
      expect(createHash("sha256").update(bytes).digest("hex"))
        .toBe(FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256)

      const replay = await fetch(`${origin}/pdf-exports`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
          documentRevision: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
        }),
      })
      expect(replay.status).toBe(200)
      await expect(replay.json()).resolves.toMatchObject({
        status: "idempotent-replay",
        export: { operationId: admittedBody.export.operationId, state: "completed" },
      })
      await expect(worker.host.runCycle()).resolves.toMatchObject({ listedCount: 0, invokedCount: 0 })
    } finally {
      await http.close()
      await worker.close()
    }
  }, 120_000)

  it("runs the complete V-B through V-F workflow and terminal-replays after provider restart", async () => {
    const fixture = createPdfExportWorkflowFixture({
      operationId: `operation:local-c:restart:${runId}`,
    })
    const firstRepositories = await repositories()
    const firstStore = await store()
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: firstRepositories,
      contentStore: firstStore,
    }))
    expect(completed).toMatchObject({
      status: "completed",
      execution: {
        operationAdmission: "created",
        rendererExecuted: true,
        persistenceExecuted: true,
      },
      persistenceReceipt: {
        operationId: fixture.fixture.operation.operationId,
        bytes: { readAfterWriteVerified: true },
      },
    })
    if (completed.status !== "completed" || completed.persistenceReceipt == null) {
      throw new Error(JSON.stringify(completed.issues))
    }
    const storageKey = completed.persistenceReceipt.bytes.storageKey
    const sha256 = completed.persistenceReceipt.bytes.sha256
    const firstRead = await firstStore.read({ storageKey })
    expect(firstRead).toMatchObject({ status: "found", content: { sha256 } })
    await closeRepositories(firstRepositories)
    closeStore(firstStore)

    const reopenedRepositories = await repositories()
    const reopenedStore = await store()
    const replay = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: reopenedRepositories,
      contentStore: reopenedStore,
    }))
    expect(replay).toMatchObject({
      status: "terminal-replay",
      execution: {
        operationAdmission: "terminal-replay",
        rendererExecuted: false,
        persistenceExecuted: false,
      },
    })
    await expect(reopenedStore.read({ storageKey })).resolves.toMatchObject({
      status: "found",
      content: { sha256 },
    })
  }, 60_000)

  it("admits one caller-key owner across independent PostgreSQL pools", async () => {
    const firstRepositories = await repositories()
    const secondRepositories = await repositories()
    const callerIdempotencyKey = `caller-key:local-c:concurrency:${runId}`
    const first = createPdfExportOperationFixture({
      operationId: `operation:local-c:concurrency:first:${runId}`,
      callerIdempotencyKey,
    })
    const second = createPdfExportOperationFixture({
      operationId: `operation:local-c:concurrency:second:${runId}`,
      callerIdempotencyKey,
    })
    const results = await Promise.all([
      firstRepositories.operationRepository.admitOperation(first),
      secondRepositories.operationRepository.admitOperation(second),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["created", "idempotent-replay"])
    expect(new Set(results.map((result) => result.existingOperationId)).size).toBe(1)
  }, 30_000)

  it("retains one lifecycle claim owner across independent PostgreSQL pools", async () => {
    const firstRepositories = await repositories()
    const secondRepositories = await repositories()
    const operation = createPdfExportOperationFixture({
      operationId: `operation:local-c:claim-concurrency:${runId}`,
    })
    await firstRepositories.lifecycleRepository.initializeLifecycle(operation)
    const baseClaim = {
      ...operation.scope,
      operationId: operation.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-18T09:00:02.000Z",
      kind: "claim" as const,
      workerId: "worker:local-c:first",
      claimExpiresAt: "2026-07-18T09:00:32.000Z",
    }
    const results = await Promise.all([
      firstRepositories.lifecycleRepository.applyLifecycleTransition({
        ...baseClaim,
        transitionId: `transition:local-c:claim:first:${runId}`,
        claimToken: `claim:local-c:first:${runId}`,
      }),
      secondRepositories.lifecycleRepository.applyLifecycleTransition({
        ...baseClaim,
        transitionId: `transition:local-c:claim:second:${runId}`,
        claimToken: `claim:local-c:second:${runId}`,
        workerId: "worker:local-c:second",
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["applied", "stale"])
    const found = await firstRepositories.lifecycleRepository.readLifecycle({
      ...operation.scope,
      operationId: operation.operationId,
    })
    expect(found).toMatchObject({
      status: "found",
      head: { headRevision: 1, status: "claimed", attemptCount: 1 },
    })
  }, 30_000)

  it.each([
    ["operation-before", "operation", "before-commit"],
    ["operation-after", "operation", "after-commit"],
    ["lifecycle-before", "lifecycle", "before-commit"],
    ["lifecycle-after", "lifecycle", "after-commit"],
    ["persistence-manifest", "persistence", "after-manifest-cas"],
    ["persistence-job", "persistence", "after-job-cas"],
    ["persistence-before", "persistence", "before-commit"],
    ["persistence-after", "persistence", "after-commit"],
    ["observability-events", "observability", "after-event-batch"],
    ["observability-before", "observability", "before-commit"],
    ["observability-after", "observability", "after-commit"],
  ] as const)("recovers exact replay after %s provider fault", async (name, family, point) => {
    let injected = false
    const inject = (context: { point: string }) => {
      if (!injected && context.point === point) {
        injected = true
        throw new Error(`injected-${name}`)
      }
    }
    const faultInjectors = { [family]: inject } as FlowDocBackendPdfExportLocalPostgresRepositoryFaultsV1
    const fixture = createPdfExportWorkflowFixture({
      operationId: `operation:local-c:fault:${name}:${runId}`,
    })
    const contentStore = await store()
    const faultedRepositories = await repositories(faultInjectors)
    await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: faultedRepositories,
      contentStore,
    }))).rejects.toThrow(`injected-${name}`)
    expect(injected).toBe(true)
    await closeRepositories(faultedRepositories)

    const recoveredRepositories = await repositories()
    const recovered = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: recoveredRepositories,
      contentStore,
    }))
    expect(["completed", "terminal-replay"]).toContain(recovered.status)
    expect(recovered.issues).toEqual([])
  }, 60_000)

  it("walks every S3 continuation page and removes only unreferenced old bytes", async () => {
    const contentStore = await store(`pdf-export-content-v1/${runId}-cursor/`)
    const metadata = await repositories()
    const storageKeys: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const bytes = new TextEncoder().encode(`%PDF-1.7\nLOCAL-C orphan ${runId} ${index}\n%%EOF\n`)
      const digest = createHash("sha256").update(bytes).digest("hex")
      const written = await contentStore.write({
        bytes,
        expectedSha256: digest,
        expectedByteLength: bytes.byteLength,
      })
      if (written.content == null) throw new Error(JSON.stringify(written.issues))
      storageKeys.push(written.content.storageKey)
    }
    const modifiedBefore = new Date(Date.now() + 60_000).toISOString()
    const listed = new Set<string>()
    let cursor: string | null = null
    let pageCount = 0
    do {
      const page = await contentStore.scanPage({ modifiedBefore, maxScanCount: 2, cursor })
      if (page.status !== "ready") throw new Error(JSON.stringify(page.issues))
      page.candidates.forEach((value) => listed.add(value.storageKey))
      cursor = page.nextCursor
      pageCount += 1
    } while (cursor != null && pageCount < 10)
    expect(pageCount).toBeGreaterThanOrEqual(3)
    expect(listed).toEqual(new Set(storageKeys))

    const deleted = new Set<string>()
    cursor = null
    pageCount = 0
    do {
      const reconciled = await reconcileFlowDocBackendPdfExportResumableOrphanContentV1({
        now: new Date(Date.now() + 120_000).toISOString(),
        gracePeriodMs: 60_000,
        maxScanCount: 2,
        maxDeleteCount: 2,
        cursor,
        contentStore,
        persistenceRepository: metadata.persistenceRepository,
      })
      expect(reconciled.status).toBe("completed")
      reconciled.deletedStorageKeys.forEach((value) => deleted.add(value))
      cursor = reconciled.nextCursor
      pageCount += 1
    } while (cursor != null && pageCount < 10)
    expect(deleted).toEqual(new Set(storageKeys))
    for (const storageKey of storageKeys) {
      await expect(contentStore.read({ storageKey })).resolves.toMatchObject({ status: "not-found" })
    }
  }, 60_000)
})

localDescribe("PDF export LOCAL-D durable worker integration", () => {
  it("lists bounded due lanes in keyset order without mutation and excludes terminal work", async () => {
    const metadata = await repositories()
    const contentStore = await store(`pdf-export-content-v1/${runId}-local-d-due/`)
    const completedFixture = createPdfExportWorkflowFixture({
      operationId: `operation:local-d:due:completed:${runId}`,
    })
    await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture: completedFixture,
      repositories: metadata,
      contentStore,
    }))).resolves.toMatchObject({ status: "completed" })

    const operations = ["a-pending", "b-pending", "c-expired", "d-stopped", "e-active"].map((name) =>
      createPdfExportOperationFixture({ operationId: `operation:local-d:due:${name}:${runId}` }))
    for (const operation of operations) {
      await metadata.operationRepository.admitOperation(operation)
      await metadata.lifecycleRepository.initializeLifecycle(operation)
    }
    const expired = operations[2]!
    await metadata.lifecycleRepository.applyLifecycleTransition({
      transitionId: `transition:local-d:due:expired:${runId}`,
      ...expired.scope,
      operationId: expired.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-18T09:00:02.000Z",
      kind: "claim",
      claimToken: `claim:local-d:due:expired:${runId}`,
      workerId: "worker:local-d:expired",
      claimExpiresAt: "2026-07-18T09:00:05.000Z",
    })
    const stopped = operations[3]!
    await metadata.lifecycleRepository.applyLifecycleTransition({
      transitionId: `transition:local-d:due:stopped:${runId}`,
      ...stopped.scope,
      operationId: stopped.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-18T09:00:03.000Z",
      kind: "force-shutdown",
    })
    const active = operations[4]!
    await metadata.lifecycleRepository.applyLifecycleTransition({
      transitionId: `transition:local-d:due:active:${runId}`,
      ...active.scope,
      operationId: active.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-18T09:00:02.000Z",
      kind: "claim",
      claimToken: `claim:local-d:due:active:${runId}`,
      workerId: "worker:local-d:active",
      claimExpiresAt: "2026-07-18T09:00:30.000Z",
    })
    const fingerprintsBefore = new Map<string, string>()
    for (const operation of operations) {
      const found = await metadata.lifecycleRepository.readLifecycle({ ...operation.scope, operationId: operation.operationId })
      if (found.status !== "found") throw new Error("LOCAL-D due fixture lifecycle missing")
      fingerprintsBefore.set(operation.operationId, found.head.lifecycleFingerprint)
    }

    const entries = []
    let cursor = null
    do {
      const page = await metadata.dueWorkRepository.listDueWork({
        observedAt: "2026-07-18T09:00:06.000Z",
        maxCount: 2,
        cursor,
      })
      if (page.status !== "ready") throw new Error(JSON.stringify(page.issues))
      entries.push(...page.entries)
      cursor = page.nextCursor
    } while (cursor != null)
    expect(entries.map((entry) => entry.operationId)).toEqual([
      operations[0]!.operationId,
      operations[1]!.operationId,
      operations[3]!.operationId,
      operations[2]!.operationId,
    ])
    expect(Object.fromEntries(entries.map((entry) => [entry.operationId, entry.lane]))).toMatchObject({
      [operations[0]!.operationId]: "claim-ready",
      [operations[1]!.operationId]: "claim-ready",
      [operations[2]!.operationId]: "claim-expired",
      [operations[3]!.operationId]: "terminal-finalization",
    })
    expect(entries.some((entry) => entry.operationId === active.operationId)).toBe(false)
    expect(entries.some((entry) => entry.operationId === completedFixture.fixture.operation.operationId)).toBe(false)
    for (const operation of operations) {
      const found = await metadata.lifecycleRepository.readLifecycle({ ...operation.scope, operationId: operation.operationId })
      expect(found).toMatchObject({
        status: "found",
        head: { lifecycleFingerprint: fingerprintsBefore.get(operation.operationId) },
      })
    }
  }, 60_000)

  it("admits one execution owner after two PostgreSQL workers observe the same due page", async () => {
    const firstRepositories = await repositories()
    const secondRepositories = await repositories()
    const firstStore = await store(`pdf-export-content-v1/${runId}-local-d-race/`)
    const secondStore = await store(`pdf-export-content-v1/${runId}-local-d-race/`)
    const fixture = createPdfExportWorkflowFixture({ operationId: `operation:local-d:race:${runId}` })
    await firstRepositories.operationRepository.admitOperation(fixture.fixture.operation)
    await firstRepositories.lifecycleRepository.initializeLifecycle(fixture.fixture.operation)

    let arrivals = 0
    let releaseBarrier: (() => void) | null = null
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve })
    const synchronized = (repository: FlowDocBackendPdfExportDueWorkRepositoryV1): FlowDocBackendPdfExportDueWorkRepositoryV1 => ({
      dueWorkSource: repository.dueWorkSource,
      async listDueWork(input) {
        const page = await repository.listDueWork(input)
        arrivals += 1
        if (arrivals === 2) releaseBarrier?.()
        await barrier
        return page
      },
    })
    const host = (
      name: string,
      workerRepositories: FlowDocBackendPdfExportLocalPostgresRepositoriesV1,
      contentStore: FlowDocBackendPdfExportS3ContentAddressedStoreV1,
    ) => createFlowDocBackendPdfExportLocalWorkerHostV1({
      hostId: `host:local-d:race:${name}:${runId}`,
      workerId: `worker:local-d:race:${name}`,
      runId: `run:local-d:race:${name}:${runId}`,
      createdAt: "2026-07-18T09:00:01.000Z",
      ...workerRepositories,
      dueWorkRepository: synchronized(workerRepositories.dueWorkRepository),
      now: () => "2026-07-18T09:00:02.000Z",
      execute: (execution) => runFlowDocBackendPdfExportEndToEndCandidateV1(
        workerWorkflow(execution, fixture, workerRepositories, contentStore),
      ),
    })
    const [first, second] = await Promise.all([
      host("first", firstRepositories, firstStore).runCycle(),
      host("second", secondRepositories, secondStore).runCycle(),
    ])
    const results = [...first.results, ...second.results]
    expect(results).toHaveLength(2)
    expect(results.map((value) => value.status).sort()).toEqual(["completed", "ownership-lost"])
    expect(results.filter((value) => value.rendererExecuted)).toHaveLength(1)
    await expect(firstRepositories.observabilityRepository.readTerminalWorkflow({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })).resolves.toMatchObject({ status: "found", completion: { terminalStatus: "completed" } })
    await expect(firstRepositories.dueWorkRepository.listDueWork({
      observedAt: "2026-07-18T09:01:00.000Z",
      maxCount: 8,
      cursor: null,
    })).resolves.toMatchObject({ status: "ready", entries: [] })
  }, 60_000)

  it("reclaims an expired claim after provider restart without duplicate terminal persistence", async () => {
    const seededRepositories = await repositories()
    const contentStore = await store(`pdf-export-content-v1/${runId}-local-d-restart/`)
    const fixture = createPdfExportWorkflowFixture({ operationId: `operation:local-d:restart:${runId}` })
    await seededRepositories.operationRepository.admitOperation(fixture.fixture.operation)
    await seededRepositories.lifecycleRepository.initializeLifecycle(fixture.fixture.operation)
    await seededRepositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: `transition:local-d:restart:seed:${runId}`,
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-18T09:00:02.000Z",
      kind: "claim",
      claimToken: `claim:local-d:restart:expired:${runId}`,
      workerId: "worker:local-d:disappeared",
      claimExpiresAt: "2026-07-18T09:00:05.000Z",
    })
    await closeRepositories(seededRepositories)

    const reopened = await repositories()
    const host = createFlowDocBackendPdfExportLocalWorkerHostV1({
      hostId: `host:local-d:restart:${runId}`,
      workerId: "worker:local-d:restart",
      runId: `run:local-d:restart:${runId}`,
      createdAt: "2026-07-18T09:00:04.000Z",
      ...reopened,
      now: () => "2026-07-18T09:00:05.000Z",
      execute: (execution) => runFlowDocBackendPdfExportEndToEndCandidateV1(
        workerWorkflow(execution, fixture, reopened, contentStore),
      ),
    })
    const cycle = await host.runCycle()
    expect(cycle.results).toHaveLength(1)
    expect(cycle.results[0]).toMatchObject({
      status: "completed",
      attemptNumber: 2,
      rendererExecuted: true,
      persistenceExecuted: true,
    })
    await expect(reopened.dueWorkRepository.listDueWork({
      observedAt: "2026-07-18T09:01:00.000Z",
      maxCount: 8,
      cursor: null,
    })).resolves.toMatchObject({ status: "ready", entries: [] })
  }, 60_000)

  it("finalizes stopped lifecycle evidence after provider restart without rendering", async () => {
    const seededRepositories = await repositories()
    const contentStore = await store(`pdf-export-content-v1/${runId}-local-d-finalize/`)
    const fixture = createPdfExportWorkflowFixture({ operationId: `operation:local-d:finalize:${runId}` })
    await seededRepositories.operationRepository.admitOperation(fixture.fixture.operation)
    await seededRepositories.lifecycleRepository.initializeLifecycle(fixture.fixture.operation)
    await seededRepositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: `transition:local-d:finalize:stop:${runId}`,
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-18T09:00:02.000Z",
      kind: "force-shutdown",
    })
    await closeRepositories(seededRepositories)

    const reopened = await repositories()
    const host = createFlowDocBackendPdfExportLocalWorkerHostV1({
      hostId: `host:local-d:finalize:${runId}`,
      workerId: "worker:local-d:finalize",
      runId: `run:local-d:finalize:${runId}`,
      createdAt: "2026-07-18T09:00:02.000Z",
      ...reopened,
      now: () => "2026-07-18T09:00:03.000Z",
      execute: (execution) => runFlowDocBackendPdfExportEndToEndCandidateV1(
        workerWorkflow(execution, fixture, reopened, contentStore),
      ),
    })
    const cycle = await host.runCycle()
    expect(cycle.results).toHaveLength(1)
    expect(cycle.results[0]).toMatchObject({
      status: "terminated",
      claimToken: null,
      rendererExecuted: false,
      persistenceExecuted: false,
    })
    await expect(reopened.observabilityRepository.readTerminalWorkflow({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })).resolves.toMatchObject({
      status: "found",
      completion: { terminalStatus: "failed", stopReason: "shutdown-forced" },
    })
    await expect(reopened.dueWorkRepository.listDueWork({
      observedAt: "2026-07-18T09:01:00.000Z",
      maxCount: 8,
      cursor: null,
    })).resolves.toMatchObject({ status: "ready", entries: [] })
  }, 60_000)
})
