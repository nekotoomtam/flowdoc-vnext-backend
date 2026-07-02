import { afterEach, describe, expect, it } from "vitest"
import type { Server } from "node:http"
import {
  loadProductReportMinimalPackage,
  PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
  PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
} from "../fixtures/productReportMinimal.js"
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
        packageValue: loadProductReportMinimalPackage(),
        revision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
        updatedAt: "2026-06-20T00:00:00.000Z",
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
    await expect(response.json()).resolves.toMatchObject({
      revision: 4,
      status: "applied",
      targetNodeIds: ["summary-columns"],
    })
  })
})
