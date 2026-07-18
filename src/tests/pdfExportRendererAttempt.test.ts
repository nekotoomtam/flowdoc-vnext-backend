import { describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportRendererQualificationV1,
  createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1,
  flowDocBackendPdfExportCurrentRuntimeIdentityV1,
  runFlowDocBackendPdfExportRendererAttemptV1,
} from "../index.js"
import { pdfExportOperationPolicy, pdfExportOperationSource } from "./helpers/pdfExportOperationFixture.js"
import {
  PDF_EXPORT_RENDERER_CLAIM_TOKEN,
  PDF_EXPORT_RENDERER_IMPLEMENTATION_FINGERPRINT,
  PDF_EXPORT_RENDERER_SUITE_FINGERPRINT,
  createCooperativeRenderer,
  createPdfExportRendererFixture,
  monotonicRendererClock,
  preparePdfExportRendererLifecycle,
  rendererAttemptInput,
} from "./helpers/pdfExportRendererFixture.js"

describe("PDF export renderer attempt", () => {
  it("binds exact handoff, cooperative checkpoints, Core receipt, and completion before returning bytes", async () => {
    const fixture = createPdfExportRendererFixture({ operationId: "operation:renderer:success" })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    const renderer = createCooperativeRenderer({ fixture })
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer,
    }))

    expect(result).toMatchObject({
      status: "ready-for-persistence",
      operationId: fixture.operation.operationId,
      handoffFingerprint: fixture.operation.admission.exportIdentity.handoffFingerprint,
      lifecycleHead: {
        status: "claimed",
        checkpoint: "before-persist",
        headRevision: 4,
        checkpointCheck: { checkpoint: "before-persist", claimToken: PDF_EXPORT_RENDERER_CLAIM_TOKEN },
      },
      renderer: {
        executed: true,
        status: "rendered",
        checkpointCount: 3,
        maximumObservedPaintCommandGap: 2,
      },
      receipt: {
        status: "rendered",
        artifact: { storageStatus: "not-stored", storageKey: null },
      },
      completion: {
        contracts: { readyForPersistence: true, carriesBytes: false, storageWrites: false },
      },
      contracts: {
        exactCoreHandoff: true,
        exactCoreReceipt: true,
        exactCoreRenderCompletion: true,
        cooperativeCancellation: true,
        storageWrites: false,
        artifactProjection: false,
        backendRoute: false,
        concreteProductionRendererSelected: false,
        productionBinding: false,
      },
      issues: [],
    })
    if (result.status !== "ready-for-persistence") throw new Error("renderer attempt must succeed")
    expect(Buffer.from(result.bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(result.receipt).not.toHaveProperty("bytes")
    expect(result.completion).not.toHaveProperty("bytes")
    expect(result.executionFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
  })

  it("replays the exact durable before-render transition before executing the candidate", async () => {
    const fixture = createPdfExportRendererFixture({ operationId: "operation:renderer:transition-replay" })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    const attempt = rendererAttemptInput({
      fixture,
      repository,
      renderer: createCooperativeRenderer({ fixture }),
    })
    await expect(repository.applyLifecycleTransition({
      transitionId: attempt.beforeRender.transitionId,
      ...fixture.operation.scope,
      operationId: fixture.operation.operationId,
      expectedHeadRevision: attempt.beforeRender.expectedHeadRevision,
      transitionAt: attempt.beforeRender.checkedAt,
      kind: "pass-checkpoint",
      claimToken: PDF_EXPORT_RENDERER_CLAIM_TOKEN,
      nextCheckpoint: "before-persist",
    })).resolves.toMatchObject({ status: "applied", head: { headRevision: 3 } })
    await expect(runFlowDocBackendPdfExportRendererAttemptV1(attempt)).resolves.toMatchObject({
      status: "ready-for-persistence",
      lifecycleHead: { headRevision: 4, checkpoint: "before-persist" },
    })
  })

  it("blocks stale source before lifecycle advancement or renderer execution", async () => {
    const fixture = createPdfExportRendererFixture({ operationId: "operation:renderer:stale-source" })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    let invoked = false
    const delegate = createCooperativeRenderer({ fixture })
    const renderer = {
      ...delegate,
      async render(input: Parameters<typeof delegate.render>[0]) {
        invoked = true
        return delegate.render(input)
      },
    }
    const attempt = rendererAttemptInput({ fixture, repository, renderer })
    attempt.currentSource = pdfExportOperationSource(8)
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(attempt)
    expect(result).toMatchObject({
      status: "blocked",
      renderer: { executed: false, status: "not-run" },
      bytes: null,
      receipt: null,
      completion: null,
      issues: [{ code: "pdf-export-renderer-core-handoff-blocked" }],
    })
    expect(invoked).toBe(false)
    await expect(repository.readLifecycle({
      ...fixture.operation.scope,
      operationId: fixture.operation.operationId,
    })).resolves.toMatchObject({ head: { headRevision: 2, checkpoint: "before-render" } })
  })

  it("rejects runtime or adapter qualification drift before renderer execution", async () => {
    const fixture = createPdfExportRendererFixture({ operationId: "operation:renderer:runtime-drift" })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    const runtime = flowDocBackendPdfExportCurrentRuntimeIdentityV1()
    const qualification = createFlowDocBackendPdfExportRendererQualificationV1({
      qualificationId: "qualification:wrong-runtime",
      adapterId: "renderer:candidate",
      adapterVersion: "1.0.0",
      implementationFingerprint: PDF_EXPORT_RENDERER_IMPLEMENTATION_FINGERPRINT,
      rendererProfileId: fixture.measuredDrawContract.rendererProfileId,
      measurementProfileId: fixture.measuredDrawContract.measurementProfileId,
      runtime: { ...runtime, nodeVersion: "0.0.0" },
      maximumPaintCommandsBetweenChecks: 2,
      minimumCheckpointCount: 3,
      suiteFingerprint: PDF_EXPORT_RENDERER_SUITE_FINGERPRINT,
      qualifiedAt: "2026-07-18T08:00:00.000Z",
    })
    if (qualification.status !== "ready") throw new Error("drift fixture qualification must be structurally valid")
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer: createCooperativeRenderer({ fixture }),
      qualification: qualification.qualification,
    }))
    expect(result).toMatchObject({
      status: "blocked",
      renderer: { executed: false },
      issues: [{ code: "pdf-export-renderer-runtime-qualification-mismatch" }],
    })
  })

  it("discards output when the renderer violates cancellation checkpoint coverage", async () => {
    const fixture = createPdfExportRendererFixture({ operationId: "operation:renderer:checkpoint-gap" })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer: createCooperativeRenderer({ fixture, checkpointIndexes: [0, 4] }),
    }))
    expect(result).toMatchObject({
      status: "blocked",
      renderer: { executed: true, status: "cancelled" },
      bytes: null,
      receipt: null,
      completion: null,
      issues: [{ code: "pdf-export-renderer-checkpoint-protocol-invalid" }],
    })
  })

  it("discards bytes when length or SHA-256 evidence drifts", async () => {
    const fixture = createPdfExportRendererFixture({ operationId: "operation:renderer:byte-drift" })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer: createCooperativeRenderer({ fixture, sha256: "0".repeat(64) }),
    }))
    expect(result).toMatchObject({
      status: "blocked",
      renderer: { executed: true, status: "blocked" },
      bytes: null,
      receipt: null,
      completion: null,
      issues: [{ code: "pdf-export-renderer-byte-evidence-mismatch" }],
    })
  })

  it("discards valid renderer bytes when Core post-render output policy blocks them", async () => {
    const policy = pdfExportOperationPolicy({
      resources: {
        ...pdfExportOperationPolicy().resources,
        maxOutputByteLength: 16,
      },
    })
    const fixture = createPdfExportRendererFixture({
      operationId: "operation:renderer:output-limit",
      policy,
    })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer: createCooperativeRenderer({ fixture }),
    }))
    expect(result).toMatchObject({
      status: "blocked",
      renderer: { executed: true, status: "blocked" },
      bytes: null,
      receipt: null,
      completion: null,
      issues: [{ code: "pdf-export-renderer-core-completion-blocked" }],
    })
    expect(result.issues.map((entry) => entry.message).join(" ")).toContain(
      "production-resource-limit-exceeded",
    )
  })

  it("contains renderer exceptions without returning partial bytes or receipts", async () => {
    const fixture = createPdfExportRendererFixture({ operationId: "operation:renderer:throws" })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    const delegate = createCooperativeRenderer({ fixture })
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer: {
        ...delegate,
        async render() {
          throw new Error("injected-renderer-fault")
        },
      },
    }))
    expect(result).toMatchObject({
      status: "blocked",
      lifecycleHead: { status: "claimed", checkpoint: "before-persist", headRevision: 3 },
      renderer: { executed: true, status: "blocked" },
      bytes: null,
      receipt: null,
      completion: null,
      issues: [{ code: "renderer-threw", message: "injected-renderer-fault" }],
    })
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:renderer:throws:release",
      ...fixture.operation.scope,
      operationId: fixture.operation.operationId,
      expectedHeadRevision: 3,
      transitionAt: "2026-07-18T09:00:06.000Z",
      kind: "release-claim",
      claimToken: PDF_EXPORT_RENDERER_CLAIM_TOKEN,
      retryAfter: null,
    })).resolves.toMatchObject({
      status: "applied",
      head: { status: "pending", checkpoint: "before-handoff", headRevision: 4 },
    })
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:renderer:throws:retry-claim",
      ...fixture.operation.scope,
      operationId: fixture.operation.operationId,
      expectedHeadRevision: 4,
      transitionAt: "2026-07-18T09:00:07.000Z",
      kind: "claim",
      claimToken: "claim:pdf-renderer:retry",
      workerId: "worker:pdf-renderer:retry",
      claimExpiresAt: "2026-07-18T09:00:20.000Z",
    })).resolves.toMatchObject({
      status: "applied",
      head: { status: "claimed", checkpoint: "before-handoff", attemptCount: 2, headRevision: 5 },
    })
  })

  it("observes a durable cancellation request during render and returns no bytes", async () => {
    const fixture = createPdfExportRendererFixture({ operationId: "operation:renderer:cancel-mid-render" })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    let reachedResolve!: () => void
    let resumeResolve!: () => void
    const reached = new Promise<void>((resolve) => { reachedResolve = resolve })
    const resume = new Promise<void>((resolve) => { resumeResolve = resolve })
    const renderer = createCooperativeRenderer({
      fixture,
      async onCheckpoint(index) {
        if (index === 2) {
          reachedResolve()
          await resume
        }
      },
    })
    const running = runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer,
      now: monotonicRendererClock(),
    }))
    await reached
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:renderer:cancel-mid-render",
      ...fixture.operation.scope,
      operationId: fixture.operation.operationId,
      expectedHeadRevision: 3,
      transitionAt: "2026-07-18T09:00:05.002Z",
      kind: "request-cancellation",
    })).resolves.toMatchObject({ status: "applied", head: { headRevision: 4, cancellation: {} } })
    resumeResolve()
    const result = await running
    expect(result).toMatchObject({
      status: "cancelled",
      lifecycleHead: {
        status: "stopped",
        checkpoint: "before-persist",
        stop: { reason: "cancelled-before-persist" },
      },
      renderer: { executed: true, status: "cancelled" },
      bytes: null,
      receipt: null,
      completion: null,
      issues: [{ code: "pdf-export-renderer-cooperatively-cancelled" }],
    })
  })

  it("cooperatively stops on the admitted deadline and records deadline terminal state", async () => {
    const fixture = createPdfExportRendererFixture({
      operationId: "operation:renderer:deadline",
      policy: pdfExportOperationPolicy({ executionDeadlineMs: 5_000 }),
    })
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({
      repository,
      fixture,
      claimExpiresAt: "2026-07-18T09:00:06.000Z",
    })
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer: createCooperativeRenderer({ fixture }),
      now: monotonicRendererClock({ stepMs: 1_000 }),
    }))
    expect(result).toMatchObject({
      status: "cancelled",
      lifecycleHead: { status: "stopped", stop: { reason: "deadline-exceeded" } },
      renderer: { executed: true, status: "cancelled" },
      bytes: null,
      receipt: null,
      completion: null,
    })
  })
})
