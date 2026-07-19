import { describe, expect, it } from "vitest"
import {
  loadProductReportBaselinePackage,
  PRODUCT_REPORT_BASELINE_DOCUMENT_ID,
  PRODUCT_REPORT_BASELINE_INITIAL_REVISION,
} from "../fixtures/productReportBaseline.js"
import {
  loadProductReportMinimalPackage,
  PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
} from "../fixtures/productReportMinimal.js"
import {
  loadProductReportPackage,
  PRODUCT_REPORT_DOCUMENT_ID,
  PRODUCT_REPORT_INITIAL_REVISION,
} from "../fixtures/productReport.js"
import {
  loadReorderBlockedTargetQaPackage,
  REORDER_BLOCKED_TARGET_QA_DOCUMENT_ID,
  REORDER_BLOCKED_TARGET_QA_INITIAL_REVISION,
} from "../fixtures/reorderBlockedTargetQa.js"
import { readBackendDocumentLibrary } from "../service/documentLibraryService.js"
import { createInMemoryPackageRepository } from "../storage/packageRepository.js"

function createRepository() {
  return createInMemoryPackageRepository([
    {
      packageValue: loadProductReportBaselinePackage(),
      revision: PRODUCT_REPORT_BASELINE_INITIAL_REVISION,
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
    {
      packageValue: loadProductReportPackage(),
      revision: PRODUCT_REPORT_INITIAL_REVISION,
      updatedAt: "2026-06-20T00:00:00.000Z",
    },
    {
      packageValue: loadProductReportMinimalPackage(),
      revision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
      updatedAt: "2026-06-20T00:00:00.000Z",
    },
    {
      packageValue: loadReorderBlockedTargetQaPackage(),
      revision: REORDER_BLOCKED_TARGET_QA_INITIAL_REVISION,
      updatedAt: "2026-07-04T00:00:00.000Z",
    },
  ])
}

describe("local document library", () => {
  it("returns a bounded content-free page ordered by update time", async () => {
    const first = await readBackendDocumentLibrary({
      limit: "2",
      repository: createRepository(),
    })

    expect(first.status).toBe("ready")
    if (first.status !== "ready") return
    expect(first.page.items.map((item) => item.documentId)).toEqual([
      REORDER_BLOCKED_TARGET_QA_DOCUMENT_ID,
      PRODUCT_REPORT_BASELINE_DOCUMENT_ID,
    ])
    expect(first.page.items[0]).toMatchObject({
      authoring: { draft: null, status: "migration-required" },
      capabilities: {
        design: { status: "available" },
        preview: { reason: "migration-required", status: "unavailable" },
      },
      published: { latestVersion: null, status: "unavailable" },
      thumbnail: { status: "placeholder" },
    })
    expect(first.page.nextCursor).not.toBeNull()
    expect(JSON.stringify(first.page)).not.toContain("packageValue")

    const second = await readBackendDocumentLibrary({
      cursor: first.page.nextCursor,
      limit: "2",
      repository: createRepository(),
    })
    expect(second.status).toBe("ready")
    if (second.status !== "ready") return
    expect(second.page.items.map((item) => item.documentId)).toEqual([
      PRODUCT_REPORT_DOCUMENT_ID,
      "product-report-vnext-minimal",
    ])
    expect(second.page.nextCursor).toBeNull()
  })

  it("rejects invalid bounds and opaque cursors without reading content", async () => {
    await expect(readBackendDocumentLibrary({
      limit: "0",
      repository: createRepository(),
    })).resolves.toMatchObject({
      issues: [{ code: "invalid-limit", path: "limit" }],
      status: "invalid-request",
    })

    await expect(readBackendDocumentLibrary({
      cursor: "not-a-library-cursor",
      repository: createRepository(),
    })).resolves.toMatchObject({
      issues: [{ code: "invalid-cursor", path: "cursor" }],
      status: "invalid-request",
    })
  })
})
