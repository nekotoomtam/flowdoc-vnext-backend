import { describe, expect, it } from "vitest"
import {
  loadProductReportMinimalPackage,
  PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
  PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
} from "../fixtures/productReportMinimal.js"
import { executeBackendMutation } from "../service/mutationService.js"
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
