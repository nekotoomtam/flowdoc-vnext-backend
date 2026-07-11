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
      if (typeof address === "object" && address) resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  servers.length = 0
})

describe("backend migration HTTP route", () => {
  it("persists a revision-gated migration and serves the target package", async () => {
    const repository = createInMemoryPackageRepository([{
      packageValue: loadProductReportMinimalPackage(),
      revision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
      updatedAt: "2026-06-20T00:00:00.000Z",
    }])
    const server = createFlowDocBackendServer({ repository })
    servers.push(server)
    const baseUrl = await listen(server)
    const route = `${baseUrl}/documents/${PRODUCT_REPORT_MINIMAL_DOCUMENT_ID}/migrations/package-v3-document-v4`

    const response = await fetch(route, {
      body: JSON.stringify({
        baseRevision: 3,
        documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
        requestId: "http-migration-1",
        source: "editor",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      idempotency: "new",
      revision: 4,
      status: "applied",
      target: { packageVersion: 3, documentVersion: 4 },
    })
    await expect(fetch(`${baseUrl}/documents/${PRODUCT_REPORT_MINIMAL_DOCUMENT_ID}`).then((item) => item.json()))
      .resolves.toMatchObject({
        packageValue: { packageVersion: 3, document: { version: 4 } },
        revision: 4,
        status: "found",
      })
    await expect(fetch(`${baseUrl}/capabilities/versions`).then((item) => item.json()))
      .resolves.toMatchObject({
        backend: {
          migrationPersistence: { sourceSnapshotRetention: true, status: "available" },
        },
      })

    const migrated = await repository.read(PRODUCT_REPORT_MINIMAL_DOCUMENT_ID)
    const title = migrated?.packageValue.document.document.sections[0].nodes.title
    if (!title || title.type !== "text-block") throw new Error("migrated title text block missing")
    const children = structuredClone(title.children)
    const text = children.find((item) => item.type === "text")
    if (!text || text.type !== "text") throw new Error("migrated title text missing")
    text.text = "Updated through HTTP"
    const mutationRoute = `${baseUrl}/documents/${PRODUCT_REPORT_MINIMAL_DOCUMENT_ID}/mutations`
    const mutationBody = JSON.stringify({
      baseRevision: 4,
      documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
      operation: {
        kind: "text-block.rich-inline.replace",
        textBlockId: "title",
        children,
      },
      requestId: "http-rich-inline-1",
      source: "canvas",
    })
    const mutation = await fetch(mutationRoute, {
      body: mutationBody,
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const replay = await fetch(mutationRoute, {
      body: mutationBody,
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(mutation.status).toBe(200)
    await expect(mutation.json()).resolves.toMatchObject({
      idempotency: "new",
      operationKind: "text-block.rich-inline.replace",
      revision: 5,
      status: "applied",
      targetNodeIds: ["title"],
    })
    await expect(replay.json()).resolves.toMatchObject({
      idempotency: "replayed",
      revision: 5,
      status: "applied",
    })
  })

  it("returns stale and invalid-request HTTP statuses", async () => {
    const repository = createInMemoryPackageRepository([{
      packageValue: loadProductReportMinimalPackage(),
      revision: 3,
      updatedAt: "2026-06-20T00:00:00.000Z",
    }])
    const server = createFlowDocBackendServer({ repository })
    servers.push(server)
    const baseUrl = await listen(server)
    const route = `${baseUrl}/documents/${PRODUCT_REPORT_MINIMAL_DOCUMENT_ID}/migrations/package-v3-document-v4`

    const stale = await fetch(route, {
      body: JSON.stringify({
        baseRevision: 2,
        documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID,
        requestId: "http-migration-stale",
        source: "editor",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const invalid = await fetch(route, {
      body: JSON.stringify({ documentId: PRODUCT_REPORT_MINIMAL_DOCUMENT_ID }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect(stale.status).toBe(409)
    expect(invalid.status).toBe(400)
  })
})
