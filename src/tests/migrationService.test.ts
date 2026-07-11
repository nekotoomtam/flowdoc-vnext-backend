import { describe, expect, it } from "vitest"
import {
  loadProductReportMinimalPackage,
  PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
  PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
} from "../fixtures/productReportMinimal.js"
import { parseBackendMigrationRequest } from "../contracts/migration.js"
import { executeBackendMigration } from "../service/migrationService.js"
import { executeBackendMutation } from "../service/mutationService.js"
import { createInMemoryPackageRepository } from "../storage/packageRepository.js"

function repository() {
  return createInMemoryPackageRepository([{
    packageValue: loadProductReportMinimalPackage(),
    revision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
    updatedAt: "2026-06-20T00:00:00.000Z",
  }])
}

function request(overrides: Partial<ReturnType<typeof validRequest>> = {}) {
  return { ...validRequest(), ...overrides }
}

function validRequest() {
  return {
    baseRevision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
    documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
    reason: "upgrade-document",
    requestId: "migration-1",
    source: "editor" as const,
  }
}

describe("backend package migration", () => {
  it("parses a bounded migration request contract", () => {
    expect(parseBackendMigrationRequest(validRequest())).toMatchObject({
      ok: true,
      request: { source: "editor", baseRevision: 3 },
    })
    expect(parseBackendMigrationRequest({ documentId: "doc" })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "baseRevision" }),
        expect.objectContaining({ path: "requestId" }),
        expect.objectContaining({ path: "source" }),
      ]),
    })
  })

  it("persists v4 as a new revision while retaining an immutable v3 source snapshot", async () => {
    const store = repository()
    const result = await executeBackendMigration(request(), {
      now: () => Date.parse("2026-07-11T10:00:00.000Z"),
      repository: store,
    })
    const record = await store.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)
    const snapshot = await store.readMigrationSourceSnapshot(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID, 4)

    expect(result).toMatchObject({
      idempotency: "new",
      issues: [],
      revision: 4,
      sourceSnapshot: { sourceRevision: 3, targetRevision: 4 },
      status: "applied",
      summary: { changeCount: 4, errorCount: 0 },
      target: { packageVersion: 3, documentVersion: 4 },
    })
    expect(record?.packageValue).toMatchObject({ packageVersion: 3, document: { version: 4 } })
    expect(snapshot?.packageValue).toMatchObject({ packageVersion: 2, document: { version: 3 } })

    if (!snapshot) throw new Error("source snapshot missing")
    snapshot.packageValue.meta.title = "mutated clone"
    await expect(store.readMigrationSourceSnapshot(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID, 4))
      .resolves.toMatchObject({ packageValue: { meta: { title: "Product Report vNext Minimal" } } })
  })

  it("replays the same request id without creating another revision", async () => {
    const store = repository()
    const first = await executeBackendMigration(request(), { repository: store })
    const replay = await executeBackendMigration(request(), { repository: store })

    expect(first).toMatchObject({ idempotency: "new", revision: 4, status: "applied" })
    expect(replay).toMatchObject({
      idempotency: "replayed",
      revision: 4,
      status: "applied",
      summary: { changeCount: 4 },
    })
    await expect(store.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)).resolves.toMatchObject({ revision: 4 })
  })

  it("rejects request-id payload conflicts and stale base revisions", async () => {
    const store = repository()
    await executeBackendMigration(request(), { repository: store })

    const conflict = await executeBackendMigration(request({ reason: "different-reason" }), { repository: store })
    const staleStore = repository()
    const stale = await executeBackendMigration(request({ baseRevision: 2, requestId: "migration-stale" }), {
      repository: staleStore,
    })

    expect(conflict).toMatchObject({
      idempotency: null,
      issues: [expect.objectContaining({ code: "idempotency-conflict" })],
      revision: 4,
      status: "rejected",
    })
    expect(stale).toMatchObject({
      issues: [expect.objectContaining({ code: "revision-stale" })],
      revision: 3,
      status: "stale",
    })
  })

  it("keeps blocked migration plans at the source revision", async () => {
    const source = loadProductReportMinimalPackage()
    const section = source.document.document.sections[0]
    const row = section.nodes["detail-header-row"]
    if (row.type !== "table-row") throw new Error("table row missing")
    section.nodes["extra-cell"] = { id: "extra-cell", type: "table-cell", props: {}, childIds: [] }
    row.cellIds.push("extra-cell")
    const store = createInMemoryPackageRepository([{
      packageValue: source,
      revision: 3,
      updatedAt: "2026-06-20T00:00:00.000Z",
    }])

    const result = await executeBackendMigration(request(), { repository: store })

    expect(result).toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: "invalid-table-grid" })]),
      revision: 3,
      status: "rejected",
    })
    await expect(store.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)).resolves.toMatchObject({
      revision: 3,
      packageValue: { packageVersion: 2 },
    })
    await expect(store.readMigrationSourceSnapshot(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID, 4)).resolves.toBeNull()
  })

  it("rejects active document mutations after migration", async () => {
    const store = repository()
    await executeBackendMigration(request(), { repository: store })

    const result = await executeBackendMutation({
      baseRevision: 4,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: { kind: "node.delete", nodeId: "summary-columns" },
      requestId: "mutation-after-migration",
      source: "keyboard",
    }, { repository: store })

    expect(result).toMatchObject({
      issues: [expect.objectContaining({ code: "unsupported-version" })],
      revision: 4,
      status: "rejected",
    })
  })
})
