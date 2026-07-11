import { afterEach, describe, expect, it } from "vitest"
import type { Server } from "node:http"
import {
  loadProductReportBaselinePackage,
  PRODUCT_REPORT_BASELINE_DOCUMENT_ID,
  PRODUCT_REPORT_BASELINE_INITIAL_REVISION,
} from "../fixtures/productReportBaseline.js"
import {
  loadProductReportMinimalPackage,
  PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
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
import { createFlowDocBackendServer } from "../http/server.js"
import { createInMemoryPackageRepository } from "../storage/packageRepository.js"

const servers: Server[] = []

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address === "object" && address) {
        resolve(`http://127.0.0.1:${address.port}`)
      }
    })
  })
}

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  servers.length = 0
})

describe("backend HTTP server", () => {
  it("exposes health and mutation endpoints", async () => {
    const repository = createInMemoryPackageRepository([
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
    const server = createFlowDocBackendServer({
      repository,
    })
    servers.push(server)
    const baseUrl = await listen(server)

    await expect(fetch(`${baseUrl}/health`).then((response) => response.json())).resolves.toMatchObject({
      service: "flowdoc-vnext-backend",
      status: "ready",
    })

    await expect(fetch(`${baseUrl}/capabilities/versions`).then((response) => response.json())).resolves.toMatchObject({
      contractVersion: 1,
      service: "flowdoc-vnext-backend",
      status: "ready",
      backend: {
        documentRead: {
          pairs: [{ packageVersion: 2, documentVersion: 3 }],
        },
        migrationPersistence: {
          sourceSnapshotRetention: true,
          status: "available",
        },
        mutation: {
          pairs: [{ packageVersion: 2, documentVersion: 3 }],
        },
      },
    })

    await expect(fetch(`${baseUrl}/documents/${REORDER_BLOCKED_TARGET_QA_DOCUMENT_ID}`)
      .then((response) => response.json())).resolves.toMatchObject({
        documentId: REORDER_BLOCKED_TARGET_QA_DOCUMENT_ID,
        packageValue: {
          id: REORDER_BLOCKED_TARGET_QA_DOCUMENT_ID,
        },
        revision: REORDER_BLOCKED_TARGET_QA_INITIAL_REVISION,
        status: "found",
      })

    await expect(fetch(`${baseUrl}/documents/${PRODUCT_REPORT_DOCUMENT_ID}`)
      .then((response) => response.json())).resolves.toMatchObject({
        documentId: PRODUCT_REPORT_DOCUMENT_ID,
        packageValue: {
          id: PRODUCT_REPORT_DOCUMENT_ID,
        },
        revision: PRODUCT_REPORT_INITIAL_REVISION,
        status: "found",
      })

    await expect(fetch(`${baseUrl}/documents/${PRODUCT_REPORT_BASELINE_DOCUMENT_ID}`)
      .then((response) => response.json())).resolves.toMatchObject({
        documentId: PRODUCT_REPORT_BASELINE_DOCUMENT_ID,
        packageValue: {
          id: PRODUCT_REPORT_BASELINE_DOCUMENT_ID,
          document: {
            document: {
              sections: [
                { id: "section-overview" },
                { id: "section-actions" },
              ],
            },
          },
        },
        revision: PRODUCT_REPORT_BASELINE_INITIAL_REVISION,
        status: "found",
      })

    const preflight = await fetch(`${baseUrl}/documents/${PRODUCT_REPORT_MINIMAL_DOCUMENT_ID}/mutations`, {
      headers: {
        "access-control-request-headers": "content-type",
        "access-control-request-method": "POST",
        origin: "http://127.0.0.1:4001",
      },
      method: "OPTIONS",
    })

    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*")
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST")

    const response = await fetch(`${baseUrl}/documents/${PRODUCT_REPORT_MINIMAL_DOCUMENT_ID}/mutations`, {
      body: JSON.stringify({
        baseRevision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
        documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
        operation: {
          kind: "node.delete",
          nodeId: "summary-columns",
        },
        requestId: "http-mutation-1",
        source: "keyboard",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    await expect(response.json()).resolves.toMatchObject({
      revision: 4,
      status: "applied",
      targetNodeIds: ["summary-columns"],
    })
  })
})
