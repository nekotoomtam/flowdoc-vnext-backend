import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  flowDocBackendPdfExportFingerprintV1,
  parseFlowDocBackendPdfExportWorkflowCompletionV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
} from "../index.js"
import {
  createInMemoryPdfExportWorkflowRepositories,
  createPdfExportWorkflowFixture,
  pdfExportWorkflowInput,
} from "./helpers/pdfExportWorkflowFixture.js"

describe("PDF export V-F end-to-end candidate", () => {
  const roots: string[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  function store() {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-workflow-"))
    roots.push(root)
    return createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
  }

  it("runs V-B through V-E, commits a privacy-safe event chain, and retains terminal completion", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:workflow:success" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const result = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories,
      contentStore: store(),
    }))
    expect(result).toMatchObject({
      status: "completed",
      completion: {
        terminalStatus: "completed",
        stopReason: "completed",
        eventCount: 5,
        contracts: {
          atomicWithEventBatch: true,
          sourceTextIncluded: false,
          pdfBytesIncluded: false,
          backendRoute: false,
          productionBinding: false,
        },
      },
      execution: {
        operationAdmission: "created",
        rendererExecuted: true,
        persistenceExecuted: true,
      },
      persistenceReceipt: {
        projection: { manifest: { status: "rendered" }, job: { status: "rendered" } },
      },
      contracts: {
        privacySafeObservability: true,
        automaticQueueWorker: false,
        authzExecution: false,
        productionBinding: false,
      },
    })
    if (result.status === "blocked") throw new Error(JSON.stringify(result.issues))
    expect(result.events.map((event) => event.eventName)).toEqual([
      "pdf-export.accepted",
      "pdf-export.render-started",
      "pdf-export.render-completed",
      "pdf-export.persist-started",
      "pdf-export.persist-completed",
    ])
    expect(result.events.at(-1)?.dimensions).toMatchObject({
      stopReason: "completed",
      pageCount: 1,
      byteLength: result.persistenceReceipt?.bytes.byteLength,
    })
    expect(JSON.stringify(result.events)).not.toContain("FlowDoc V-D deterministic candidate")
  })

  it("returns terminal replay without invoking renderer or persistence again", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:workflow:terminal-replay" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const contentStore = store()
    const first = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories,
      contentStore,
    }))
    if (first.status === "blocked") throw new Error(JSON.stringify(first.issues))
    let renderCalls = 0
    const replayRenderer = {
      ...fixture.renderer,
      async render(input: Parameters<typeof fixture.renderer.render>[0]) {
        renderCalls += 1
        return fixture.renderer.render(input)
      },
    }
    const replay = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories,
      contentStore,
      renderer: replayRenderer,
    }))
    expect(replay).toMatchObject({
      status: "terminal-replay",
      completion: { completionFingerprint: first.completion.completionFingerprint },
      execution: {
        operationAdmission: "terminal-replay",
        rendererExecuted: false,
        persistenceExecuted: false,
      },
    })
    expect(renderCalls).toBe(0)
  })

  it("stops before render without emitting a render-started event", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:workflow:cancel-before-render" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    await repositories.operationRepository.admitOperation(fixture.fixture.operation)
    await repositories.lifecycleRepository.initializeLifecycle(fixture.fixture.operation)
    await repositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: "transition:workflow:preclaimed",
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-18T09:00:02.000Z",
      kind: "claim",
      claimToken: "claim:pdf-renderer:1",
      workerId: "worker:pdf-export-workflow",
      claimExpiresAt: "2026-07-18T09:00:32.000Z",
    })
    await repositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: "transition:workflow:cancel-before-handoff",
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
      expectedHeadRevision: 1,
      transitionAt: "2026-07-18T09:00:02.500Z",
      kind: "request-cancellation",
    })
    let renderCalls = 0
    const renderer = {
      ...fixture.renderer,
      async render(input: Parameters<typeof fixture.renderer.render>[0]) {
        renderCalls += 1
        return fixture.renderer.render(input)
      },
    }
    const result = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories,
      contentStore: store(),
      renderer,
    }))
    if (result.status === "blocked") throw new Error(JSON.stringify(result.issues))
    expect(result).toMatchObject({
      status: "terminated",
      completion: { terminalStatus: "cancelled", stopReason: "cancelled-before-handoff" },
      execution: { rendererExecuted: false, persistenceExecuted: false },
    })
    expect(result.events.map((event) => event.eventName)).toEqual([
      "pdf-export.accepted",
      "pdf-export.deduplicated",
      "pdf-export.cancelled",
    ])
    expect(renderCalls).toBe(0)
  })

  it("rejects open terminal completion records even with a matching recomputed fingerprint", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:workflow:completion-schema" })
    const result = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: createInMemoryPdfExportWorkflowRepositories(),
      contentStore: store(),
    }))
    if (result.completion == null) throw new Error("workflow completion fixture failed")
    const unsafe = { ...structuredClone(result.completion), sourceText: "private source text" }
    const { completionFingerprint: _fingerprint, ...facts } = unsafe
    unsafe.completionFingerprint = flowDocBackendPdfExportFingerprintV1(facts)
    expect(parseFlowDocBackendPdfExportWorkflowCompletionV1(unsafe)).toMatchObject({
      status: "blocked",
      issues: [{ code: "pdf-export-workflow-completion-schema-open" }],
    })
  })

  it("lets verified persistence outrank a late cancellation after the V-E commit", async () => {
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:workflow:persistence-wins" })
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const contentStore = store()
    await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories,
      contentStore,
      faultPoint: "after-persistence",
    }))).rejects.toThrow("injected-after-persistence")
    const lifecycle = await repositories.lifecycleRepository.readLifecycle({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })
    if (lifecycle.status !== "found") throw new Error("lifecycle fixture failed")
    await expect(repositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: "transition:workflow:late-cancellation",
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
      expectedHeadRevision: lifecycle.head.headRevision,
      transitionAt: "2026-07-18T09:00:06.500Z",
      kind: "request-cancellation",
    })).resolves.toMatchObject({ status: "applied" })

    const recovered = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories,
      contentStore,
    }))
    expect(recovered).toMatchObject({
      status: "completed",
      completion: { terminalStatus: "completed", stopReason: "completed" },
      execution: { rendererExecuted: false, persistenceExecuted: false },
    })
  })

  it.each([
    ["after-operation-admission", 1],
    ["after-lifecycle-ready", 1],
    ["after-render", 2],
    ["after-persistence", 1],
  ] as const)("recovers after %s and renders only while durable bytes are absent", async (point, expectedRenders) => {
    let renderCalls = 0
    const base = createPdfExportWorkflowFixture({ operationId: `operation:workflow:recovery:${point}` })
    const renderer = {
      ...base.renderer,
      async render(input: Parameters<typeof base.renderer.render>[0]) {
        renderCalls += 1
        return base.renderer.render(input)
      },
    }
    const fixture = { ...base, renderer }
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const contentStore = store()
    await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories,
      contentStore,
      faultPoint: point,
    }))).rejects.toThrow(`injected-${point}`)
    const recovered = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories,
      contentStore,
    }))
    expect(recovered).toMatchObject({
      status: "completed",
      execution: {
        operationAdmission: "idempotent-replay",
        rendererExecuted: point === "after-persistence" ? false : true,
        persistenceExecuted: point === "after-persistence" ? false : true,
      },
    })
    expect(renderCalls).toBe(expectedRenders)
    expect(recovered.events.map((event) => event.eventName)).toContain("pdf-export.deduplicated")
  })
})
