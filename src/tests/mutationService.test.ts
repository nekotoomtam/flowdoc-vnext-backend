import { describe, expect, it } from "vitest"
import {
  loadProductReportMinimalPackage,
  PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
  PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
} from "../fixtures/productReportMinimal.js"
import { executeBackendMutation } from "../service/mutationService.js"
import { executeBackendMigration } from "../service/migrationService.js"
import { createInMemoryPackageRepository } from "../storage/packageRepository.js"

function createRepository() {
  return createInMemoryPackageRepository([
    {
      packageValue: loadProductReportMinimalPackage(),
      revision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
      updatedAt: "2026-06-20T00:00:00.000Z",
    },
  ])
}

describe("backend mutation service", () => {
  it("commits v4 rich-inline content with backend-owned draft context and exact replay", async () => {
    const repository = createRepository()
    await executeBackendMigration({
      baseRevision: 3,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      requestId: "mutation-v4-rich-migration",
      source: "editor",
    }, { repository })
    const migrated = await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)
    const title = migrated?.packageValue.document.document.sections[0].nodes.title
    if (!title || title.type !== "text-block") throw new Error("migrated title text block missing")
    const children = structuredClone(title.children)
    const text = children.find((item) => item.type === "text")
    if (!text || text.type !== "text") throw new Error("migrated title text missing")
    text.text = "Updated through backend"
    const request = {
      baseRevision: 4,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: {
        kind: "text-block.rich-inline.replace" as const,
        textBlockId: "title",
        children,
      },
      requestId: "mutation-v4-rich-1",
      source: "canvas" as const,
    }

    const first = await executeBackendMutation(request, { repository })
    const replay = await executeBackendMutation(request, { repository })
    const record = await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)

    expect(first).toMatchObject({
      core: { historyIntent: "content", renderInvalidation: { lane: "text-content" } },
      idempotency: "new",
      revision: 5,
      status: "applied",
      targetNodeIds: ["title"],
    })
    expect(replay).toMatchObject({ idempotency: "replayed", revision: 5, status: "applied" })
    expect(record).toMatchObject({
      authoringContext: {
        artifact: { kind: "structure-definition-draft", revision: 5 },
        fieldContract: { kind: "draft-field-contract" },
      },
      revision: 5,
    })
    const writtenTitle = record?.packageValue.document.document.sections[0].nodes.title
    expect(writtenTitle?.type === "text-block" && writtenTitle.children).toEqual(children)
  })

  it("rejects a reused mutation requestId with a different payload", async () => {
    const repository = createRepository()
    const first = {
      baseRevision: 3,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: { kind: "node.duplicate" as const, nodeId: "summary-columns" },
      requestId: "mutation-idempotency-conflict",
      source: "toolbar" as const,
    }
    await executeBackendMutation(first, { repository })
    const conflict = await executeBackendMutation({
      ...first,
      operation: { kind: "node.delete", nodeId: "summary-columns" },
    }, { repository })

    expect(conflict).toMatchObject({
      idempotency: null,
      issues: [expect.objectContaining({ code: "idempotency-conflict" })],
      revision: 4,
      status: "rejected",
    })
    expect((await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID))?.revision).toBe(4)
  })

  it("persists generic node lifecycle operations against package 3/document 4", async () => {
    const repository = createRepository()
    const migrated = await executeBackendMigration({
      baseRevision: 3,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      requestId: "mutation-v4-migration",
      source: "editor",
    }, { repository })
    expect(migrated).toMatchObject({ status: "applied", revision: 4 })

    const reordered = await executeBackendMutation({
      baseRevision: 4,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: { kind: "node.reorder", nodeId: "title", toIndex: 2 },
      requestId: "mutation-v4-reorder",
      source: "canvas",
    }, { repository })
    const deleted = await executeBackendMutation({
      baseRevision: 5,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: { kind: "node.delete", nodeId: "title" },
      requestId: "mutation-v4-delete",
      source: "inspector",
    }, { repository })
    const duplicated = await executeBackendMutation({
      baseRevision: 6,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: { kind: "node.duplicate", nodeId: "summary-columns" },
      requestId: "mutation-v4-duplicate",
      source: "inspector",
    }, { repository })
    const record = await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)

    expect(reordered).toMatchObject({
      core: { historyIntent: "structure", renderInvalidation: { lane: "node-structure" } },
      revision: 5,
      status: "applied",
      targetNodeIds: ["title"],
    })
    expect(deleted).toMatchObject({ revision: 6, status: "applied", targetNodeIds: ["title"] })
    expect(duplicated).toMatchObject({
      revision: 7,
      status: "applied",
      targetNodeIds: ["summary-columns", "summary-columns-copy"],
    })
    expect(record?.packageValue.document.document.sections[0].nodes["zone-cover-body"]).toMatchObject({
      childIds: ["summary-columns", "summary-columns-copy", "detail-table"],
    })
  })

  it("does not persist or advance revision for a same-index v4 reorder", async () => {
    const repository = createRepository()
    await executeBackendMigration({
      baseRevision: 3,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      requestId: "mutation-v4-no-op-migration",
      source: "editor",
    }, { repository })

    const result = await executeBackendMutation({
      baseRevision: 4,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: { kind: "node.reorder", nodeId: "title", toIndex: 0 },
      requestId: "mutation-v4-no-op-reorder",
      source: "canvas",
    }, { repository })
    const record = await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)

    expect(result).toMatchObject({
      issues: [expect.objectContaining({ code: "no-op-index" })],
      revision: 4,
      status: "rejected",
    })
    expect(record?.revision).toBe(4)
    expect(record?.packageValue.document.document.sections[0].nodes["zone-cover-body"]).toMatchObject({
      childIds: ["title", "summary-columns", "detail-table"],
    })
  })

  it("applies core-backed node mutations behind a backend revision envelope", async () => {
    const repository = createRepository()
    const result = await executeBackendMutation({
      baseRevision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: {
        kind: "node.duplicate",
        nodeId: "summary-columns",
      },
      reason: "toolbar-duplicate",
      requestId: "mutation-1",
      source: "toolbar",
    }, {
      now: () => Date.parse("2026-07-02T09:00:00.000Z"),
      repository,
    })
    const record = await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)

    expect(result).toMatchObject({
      baseRevision: 3,
      core: {
        historyIntent: "structure",
      },
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      issues: [],
      operationKind: "node.duplicate",
      revision: 4,
      status: "applied",
      targetNodeIds: ["summary-columns", "summary-columns-copy"],
    })
    expect(result.readEnvelope).toMatchObject({
      baseRevision: 3,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      purpose: "mutation-result",
      sourceKind: "mutation-result",
      sourceRevision: 4,
    })
    expect(record?.revision).toBe(4)
    expect(record?.packageValue.document.document.sections[0]?.nodes["summary-columns-copy"]).toMatchObject({
      id: "summary-columns-copy",
      type: "columns",
    })
  })

  it("blocks stale mutation requests before calling core", async () => {
    const repository = createRepository()
    const result = await executeBackendMutation({
      baseRevision: 2,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: {
        kind: "node.delete",
        nodeId: "summary-columns",
      },
      requestId: "mutation-2",
      source: "keyboard",
    }, {
      repository,
    })
    const record = await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)

    expect(result).toMatchObject({
      issues: [
        {
          code: "revision-stale",
        },
      ],
      revision: 3,
      status: "stale",
      targetNodeIds: ["summary-columns"],
    })
    expect(record?.packageValue.document.document.sections[0]?.nodes["summary-columns"]).toBeDefined()
  })

  it("returns core rejection issues without persisting unsupported targets", async () => {
    const repository = createRepository()
    const result = await executeBackendMutation({
      baseRevision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: {
        kind: "node.delete",
        nodeId: "zone-cover-body",
      },
      requestId: "mutation-3",
      source: "keyboard",
    }, {
      repository,
    })
    const record = await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)

    expect(result).toMatchObject({
      issues: [
        {
          code: "cannot-delete",
          nodeId: "zone-cover-body",
        },
      ],
      revision: 3,
      status: "rejected",
    })
    expect(record?.revision).toBe(3)
  })
})
