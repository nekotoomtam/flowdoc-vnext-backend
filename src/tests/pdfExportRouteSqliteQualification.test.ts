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
  handleFlowDocBackendPdfExportRouteV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
  type FlowDocBackendPdfExportRouteOptionsV1,
} from "../index.js"
import {
  PDF_EXPORT_ROUTE_CALLER_KEY,
  PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
  createPdfExportRouteFixture,
  pdfExportRouteDocumentPin,
} from "./helpers/pdfExportRouteFixture.js"
import { pdfExportWorkflowInput } from "./helpers/pdfExportWorkflowFixture.js"

interface CloseableV1 {
  close(): void
}

describe("PDF export V-G SQLite route qualification", () => {
  const roots: string[] = []
  const handles: CloseableV1[] = []

  afterEach(() => {
    handles.splice(0).forEach((handle) => {
      try {
        handle.close()
      } catch {
        // Restart cases close every durable handle before reopening.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function open(root: string) {
    const repositories = {
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
    handles.push(...Object.values(repositories))
    return repositories
  }

  function close(repositories: Record<string, CloseableV1>) {
    Object.values(repositories).forEach((repository) => repository.close())
  }

  function routeRequest(input: {
    method: "GET" | "POST"
    path: string
    idempotencyKey?: string | null
    body?: unknown
  }) {
    return {
      ...input,
      authorization: PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
      idempotencyKey: input.idempotencyKey ?? null,
      body: input.body ?? null,
    }
  }

  async function setup() {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-route-sqlite-"))
    roots.push(root)
    const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: join(root, "content") })
    const fixture = createPdfExportRouteFixture({ contentStore })
    return { root, contentStore, fixture }
  }

  function options(
    fixture: Awaited<ReturnType<typeof setup>>["fixture"],
    repositories: Awaited<ReturnType<typeof open>>,
  ): FlowDocBackendPdfExportRouteOptionsV1 {
    return { ...fixture.options, ...repositories }
  }

  it("retains scoped cancellation replay across a complete repository restart", async () => {
    const { root, fixture } = await setup()
    const operationId = fixture.workflowFixture.fixture.operation.operationId
    const pin = pdfExportRouteDocumentPin(fixture)
    const first = await open(root)
    await expect(handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "POST",
      path: "/pdf-exports",
      idempotencyKey: PDF_EXPORT_ROUTE_CALLER_KEY,
      body: pin,
    }), options(fixture, first))).resolves.toMatchObject({ httpStatus: 202 })
    await expect(handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "POST",
      path: `/pdf-exports/${encodeURIComponent(operationId)}/cancel`,
      idempotencyKey: "cancel-key:sqlite-restart",
    }), options(fixture, first))).resolves.toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { state: "cancelled" } },
    })
    close(first)

    const reopened = await open(root)
    await expect(handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "POST",
      path: `/pdf-exports/${encodeURIComponent(operationId)}/cancel`,
      idempotencyKey: "cancel-key:sqlite-restart",
    }), options(fixture, reopened))).resolves.toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { status: "idempotent-replay", state: "cancelled" } },
    })
  })

  it("reopens terminal status and verified download without workflow execution", async () => {
    const { root, contentStore, fixture } = await setup()
    const operationId = fixture.workflowFixture.fixture.operation.operationId
    const first = await open(root)
    await handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "POST",
      path: "/pdf-exports",
      idempotencyKey: PDF_EXPORT_ROUTE_CALLER_KEY,
      body: pdfExportRouteDocumentPin(fixture),
    }), options(fixture, first))
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture: fixture.workflowFixture,
      repositories: first,
      contentStore,
    }))
    if (completed.status === "blocked") throw new Error(JSON.stringify(completed.issues))
    close(first)

    const reopened = await open(root)
    const reopenedOptions = options(fixture, reopened)
    await expect(handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operationId)}`,
    }), reopenedOptions)).resolves.toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { export: { state: "completed", terminalStatus: "completed" } } },
    })
    const download = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operationId)}/download`,
    }), reopenedOptions)
    expect(download).toMatchObject({ httpStatus: 200, body: { kind: "pdf" } })
    if (download.body.kind !== "pdf") throw new Error("reopened route did not return PDF bytes")
    expect(Buffer.from(download.body.bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-")
  })
})
