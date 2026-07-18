import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportObservabilitySqliteRepositoryV1,
  createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1,
  createInMemoryFlowDocBackendPdfExportOperationRepositoryV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
  supportsFlowDocBackendPdfExportObservabilitySqliteV1,
  type FlowDocBackendPdfExportObservabilitySqliteFaultPointV1,
  type FlowDocBackendPdfExportObservabilitySqliteRepositoryV1,
} from "../index.js"
import {
  createPdfExportWorkflowFixture,
  pdfExportWorkflowInput,
} from "./helpers/pdfExportWorkflowFixture.js"

describe("PDF export observability SQLite repository", () => {
  const roots: string[] = []
  const repositories: FlowDocBackendPdfExportObservabilitySqliteRepositoryV1[] = []

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      try {
        repository.close()
      } catch {
        // Restart tests can close a handle before cleanup.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function open(databasePath: string, point?: FlowDocBackendPdfExportObservabilitySqliteFaultPointV1) {
    let injected = false
    const repository = await createFlowDocBackendPdfExportObservabilitySqliteRepositoryV1({
      databasePath,
      faultInjector: point == null ? undefined : (context) => {
        if (!injected && context.point === point) {
          injected = true
          throw new Error(`injected-${point}`)
        }
      },
    })
    repositories.push(repository)
    return repository
  }

  it.each(["after-event-batch", "before-commit"] as const)(
    "rolls back both event chain and completion on %s fault",
    async (point) => {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-pdf-export-observability-${point}-`))
      roots.push(root)
      const databasePath = join(root, "observability.sqlite")
      const faulted = await open(databasePath, point)
      const fixture = createPdfExportWorkflowFixture({ operationId: `operation:observability:fault:${point}` })
      const baseRepositories = {
        operationRepository: createInMemoryFlowDocBackendPdfExportOperationRepositoryV1(),
        lifecycleRepository: createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1(),
        persistenceRepository: createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1(),
      }
      const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
      await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
        fixture,
        repositories: { ...baseRepositories, observabilityRepository: faulted },
        contentStore,
      }))).rejects.toThrow(`injected-${point}`)
      faulted.close()

      const reopened = await open(databasePath)
      await expect(reopened.readTerminalWorkflow({
        ...fixture.fixture.operation.scope,
        operationId: fixture.fixture.operation.operationId,
      })).resolves.toMatchObject({ status: "not-found", events: [] })
      await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
        fixture,
        repositories: { ...baseRepositories, observabilityRepository: reopened },
        contentStore,
      }))).resolves.toMatchObject({ status: "completed" })
    },
  )

  it("recovers an after-commit fault as exact terminal replay after reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-observability-after-commit-"))
    roots.push(root)
    const databasePath = join(root, "observability.sqlite")
    const faulted = await open(databasePath, "after-commit")
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:observability:fault:after-commit" })
    const baseRepositories = {
      operationRepository: createInMemoryFlowDocBackendPdfExportOperationRepositoryV1(),
      lifecycleRepository: createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1(),
      persistenceRepository: createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1(),
    }
    const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
    await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: { ...baseRepositories, observabilityRepository: faulted },
      contentStore,
    }))).rejects.toThrow("injected-after-commit")
    faulted.close()

    const reopened = await open(databasePath)
    await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: { ...baseRepositories, observabilityRepository: reopened },
      contentStore,
    }))).resolves.toMatchObject({
      status: "terminal-replay",
      execution: { rendererExecuted: false, persistenceExecuted: false },
    })
  })

  it("retains exact event order and completion across ordinary reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-observability-restart-"))
    roots.push(root)
    const databasePath = join(root, "observability.sqlite")
    const repository = await open(databasePath)
    const fixture = createPdfExportWorkflowFixture({ operationId: "operation:observability:restart" })
    const baseRepositories = {
      operationRepository: createInMemoryFlowDocBackendPdfExportOperationRepositoryV1(),
      lifecycleRepository: createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1(),
      persistenceRepository: createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1(),
    }
    const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: { ...baseRepositories, observabilityRepository: repository },
      contentStore,
    }))
    if (completed.status === "blocked") throw new Error(JSON.stringify(completed.issues))
    repository.close()

    const reopened = await open(databasePath)
    await expect(reopened.readTerminalWorkflow({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })).resolves.toMatchObject({
      status: "found",
      completion: { completionFingerprint: completed.completion.completionFingerprint },
      events: [
        { sequence: 0, eventName: "pdf-export.accepted", previousEventFingerprint: null },
        { sequence: 1, eventName: "pdf-export.render-started" },
        { sequence: 2, eventName: "pdf-export.render-completed" },
        { sequence: 3, eventName: "pdf-export.persist-started" },
        { sequence: 4, eventName: "pdf-export.persist-completed" },
      ],
    })
  })

  it("keeps the SQLite sink behind the explicit runtime floor", () => {
    expect(supportsFlowDocBackendPdfExportObservabilitySqliteV1("24.15.0")).toBe(true)
    expect(supportsFlowDocBackendPdfExportObservabilitySqliteV1("24.14.9")).toBe(false)
    expect(supportsFlowDocBackendPdfExportObservabilitySqliteV1()).toBe(true)
  })
})
