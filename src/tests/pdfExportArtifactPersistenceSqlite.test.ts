import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportPersistenceSqliteRepositoryV1,
  persistFlowDocBackendPdfExportArtifactV1,
  supportsFlowDocBackendPdfExportPersistenceSqliteV1,
  type FlowDocBackendPdfExportPersistenceSqliteFaultPointV1,
  type FlowDocBackendPdfExportPersistenceSqliteRepositoryV1,
} from "../index.js"
import {
  createReadyPdfExportPersistenceFixture,
  pdfExportPersistenceInput,
} from "./helpers/pdfExportPersistenceFixture.js"

describe("PDF export artifact persistence SQLite repository", () => {
  const roots: string[] = []
  const repositories: FlowDocBackendPdfExportPersistenceSqliteRepositoryV1[] = []

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

  function root() {
    const value = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-persistence-sqlite-"))
    roots.push(value)
    return value
  }

  async function open(databasePath: string, faultPoint?: FlowDocBackendPdfExportPersistenceSqliteFaultPointV1) {
    let injected = false
    const repository = await createFlowDocBackendPdfExportPersistenceSqliteRepositoryV1({
      databasePath,
      faultInjector: faultPoint == null ? undefined : (context) => {
        if (!injected && context.point === faultPoint) {
          injected = true
          throw new Error(`injected-${faultPoint}`)
        }
      },
    })
    repositories.push(repository)
    return repository
  }

  it("retains the exact terminal receipt across close and reopen", async () => {
    const selectedRoot = root()
    const databasePath = join(selectedRoot, "persistence.sqlite")
    const repository = await open(databasePath)
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:sqlite-restart" })
    const store = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: selectedRoot })
    const persisted = await persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
      fixture,
      contentStore: store,
      persistenceRepository: repository,
    }))
    if (persisted.status === "blocked") throw new Error(JSON.stringify(persisted.issues))
    repository.close()

    const reopened = await open(databasePath)
    await expect(reopened.readByOperationId({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })).resolves.toMatchObject({
      status: "found",
      receipt: {
        persistenceReceiptFingerprint: persisted.receipt.persistenceReceiptFingerprint,
        projection: {
          manifest: { status: "rendered" },
          job: { status: "rendered" },
        },
      },
    })
    await expect(persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
      fixture,
      contentStore: store,
      persistenceRepository: reopened,
      persistenceId: "persistence:restart:new-caller-attempt",
    }))).resolves.toMatchObject({
      status: "idempotent-replay",
      receipt: { persistenceReceiptFingerprint: persisted.receipt.persistenceReceiptFingerprint },
    })
  })

  it.each(["after-manifest-cas", "after-job-cas", "before-commit"] as const)(
    "rolls back manifest and job together on %s fault and retries from retained bytes",
    async (point) => {
      const selectedRoot = root()
      const databasePath = join(selectedRoot, "persistence.sqlite")
      const faulted = await open(databasePath, point)
      const fixture = await createReadyPdfExportPersistenceFixture({ operationId: `operation:persistence:fault:${point}` })
      const store = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: selectedRoot })
      const input = pdfExportPersistenceInput({ fixture, contentStore: store, persistenceRepository: faulted })
      await expect(persistFlowDocBackendPdfExportArtifactV1(input)).rejects.toThrow(`injected-${point}`)
      faulted.close()

      const reopened = await open(databasePath)
      await expect(reopened.readByOperationId({
        ...fixture.fixture.operation.scope,
        operationId: fixture.fixture.operation.operationId,
      })).resolves.toMatchObject({ status: "not-found" })
      await expect(persistFlowDocBackendPdfExportArtifactV1({
        ...input,
        persistenceRepository: reopened,
      })).resolves.toMatchObject({ status: "persisted" })
    },
  )

  it("recovers an after-commit fault as exact terminal replay", async () => {
    const selectedRoot = root()
    const databasePath = join(selectedRoot, "persistence.sqlite")
    const faulted = await open(databasePath, "after-commit")
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:fault:after-commit" })
    const store = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: selectedRoot })
    const input = pdfExportPersistenceInput({ fixture, contentStore: store, persistenceRepository: faulted })
    await expect(persistFlowDocBackendPdfExportArtifactV1(input)).rejects.toThrow("injected-after-commit")
    faulted.close()

    const reopened = await open(databasePath)
    const replay = await persistFlowDocBackendPdfExportArtifactV1({ ...input, persistenceRepository: reopened })
    expect(replay).toMatchObject({ status: "idempotent-replay" })
    expect(replay.receipt?.operationId).toBe(fixture.fixture.operation.operationId)
  })

  it("admits one atomic projection owner across independent SQLite handles", async () => {
    const selectedRoot = root()
    const databasePath = join(selectedRoot, "persistence.sqlite")
    const first = await open(databasePath)
    const second = await open(databasePath)
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:sqlite-handles" })
    const store = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: selectedRoot })
    const results = await Promise.all([
      persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
        fixture,
        contentStore: store,
        persistenceRepository: first,
      })),
      persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
        fixture,
        contentStore: store,
        persistenceRepository: second,
      })),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["idempotent-replay", "persisted"])
    expect(results[0]!.receipt?.persistenceReceiptFingerprint).toBe(results[1]!.receipt?.persistenceReceiptFingerprint)
  })

  it("keeps SQLite persistence behind the explicit runtime floor", () => {
    expect(supportsFlowDocBackendPdfExportPersistenceSqliteV1("24.15.0")).toBe(true)
    expect(supportsFlowDocBackendPdfExportPersistenceSqliteV1("24.14.9")).toBe(false)
    expect(supportsFlowDocBackendPdfExportPersistenceSqliteV1()).toBe(true)
  })
})
