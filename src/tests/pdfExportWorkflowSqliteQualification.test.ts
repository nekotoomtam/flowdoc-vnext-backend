import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1,
  createFlowDocBackendPdfExportObservabilitySqliteRepositoryV1,
  createFlowDocBackendPdfExportOperationSqliteRepositoryV1,
  createFlowDocBackendPdfExportPersistenceSqliteRepositoryV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
  type FlowDocBackendPdfExportWorkflowFaultPointV1,
} from "../index.js"
import {
  createPdfExportWorkflowFixture,
  pdfExportWorkflowInput,
} from "./helpers/pdfExportWorkflowFixture.js"

interface CloseableRepositoryV1 {
  close(): void
}

describe("PDF export V-F durable workflow qualification", () => {
  const roots: string[] = []
  const repositories: CloseableRepositoryV1[] = []

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      try {
        repository.close()
      } catch {
        // Qualification cases deliberately close and reopen every durable handle.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function open(root: string) {
    const bundle = {
      operationRepository: await createFlowDocBackendPdfExportOperationSqliteRepositoryV1({
        databasePath: join(root, "operation.sqlite"),
      }),
      lifecycleRepository: await createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1({
        databasePath: join(root, "lifecycle.sqlite"),
      }),
      persistenceRepository: await createFlowDocBackendPdfExportPersistenceSqliteRepositoryV1({
        databasePath: join(root, "persistence.sqlite"),
      }),
      observabilityRepository: await createFlowDocBackendPdfExportObservabilitySqliteRepositoryV1({
        databasePath: join(root, "observability.sqlite"),
      }),
    }
    repositories.push(...Object.values(bundle))
    return bundle
  }

  function close(bundle: Record<string, CloseableRepositoryV1>) {
    Object.values(bundle).forEach((repository) => repository.close())
  }

  it.each([
    ["after-operation-admission", 1],
    ["after-lifecycle-ready", 1],
    ["after-render", 2],
    ["after-persistence", 1],
  ] as const)("recovers the full durable stack after %s and then terminal-replays", async (point, expectedRenders) => {
    const root = mkdtempSync(join(tmpdir(), `flowdoc-pdf-export-workflow-${point}-`))
    roots.push(root)
    const fixtureBase = createPdfExportWorkflowFixture({ operationId: `operation:workflow:sqlite:${point}` })
    let renderCalls = 0
    const renderer = {
      ...fixtureBase.renderer,
      async render(input: Parameters<typeof fixtureBase.renderer.render>[0]) {
        renderCalls += 1
        return fixtureBase.renderer.render(input)
      },
    }
    const fixture = { ...fixtureBase, renderer }
    const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({
      rootDirectory: join(root, "content"),
    })

    const first = await open(root)
    await expect(runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: first,
      contentStore,
      faultPoint: point satisfies FlowDocBackendPdfExportWorkflowFaultPointV1,
    }))).rejects.toThrow(`injected-${point}`)
    close(first)

    const recoveredRepositories = await open(root)
    const recovered = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: recoveredRepositories,
      contentStore,
    }))
    expect(recovered).toMatchObject({
      status: "completed",
      persistenceReceipt: { operationId: fixture.fixture.operation.operationId },
      execution: {
        operationAdmission: "idempotent-replay",
        rendererExecuted: point !== "after-persistence",
        persistenceExecuted: point !== "after-persistence",
      },
    })
    expect(renderCalls).toBe(expectedRenders)
    close(recoveredRepositories)

    const replayRepositories = await open(root)
    const replay = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture,
      repositories: replayRepositories,
      contentStore,
    }))
    expect(replay).toMatchObject({
      status: "terminal-replay",
      completion: { completionFingerprint: recovered.completion?.completionFingerprint },
      execution: {
        operationAdmission: "terminal-replay",
        rendererExecuted: false,
        persistenceExecuted: false,
      },
    })
    expect(renderCalls).toBe(expectedRenders)
  })
})
