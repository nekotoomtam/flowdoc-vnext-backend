import { createServer, type Server } from "node:http"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportHttpHandlerV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
} from "../index.js"
import {
  PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
  PDF_EXPORT_ROUTE_CALLER_KEY,
  createPdfExportRouteFixture,
  pdfExportRouteDocumentPin,
} from "./helpers/pdfExportRouteFixture.js"
import { pdfExportWorkflowInput } from "./helpers/pdfExportWorkflowFixture.js"

describe("PDF export V-G concrete HTTP adapter", () => {
  const roots: string[] = []
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function setup() {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-http-"))
    roots.push(root)
    const fixture = createPdfExportRouteFixture({
      contentStore: createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root }),
    })
    const handler = createFlowDocBackendPdfExportHttpHandlerV1(fixture.options)
    const server = createServer(async (request, response) => {
      if (!await handler(request, response)) {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "not-found" }))
      }
    })
    servers.push(server)
    const baseUrl = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (typeof address === "object" && address != null) resolve(`http://127.0.0.1:${address.port}`)
      })
    })
    return { fixture, baseUrl }
  }

  it("executes authenticated request/status routes without permissive CORS", async () => {
    const { fixture, baseUrl } = await setup()
    const created = await fetch(`${baseUrl}/pdf-exports`, {
      method: "POST",
      headers: {
        authorization: PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
        "content-type": "application/json",
        "idempotency-key": PDF_EXPORT_ROUTE_CALLER_KEY,
      },
      body: JSON.stringify(pdfExportRouteDocumentPin(fixture)),
    })
    expect(created.status).toBe(202)
    expect(created.headers.get("access-control-allow-origin")).toBeNull()
    await expect(created.json()).resolves.toMatchObject({ status: "created", export: { state: "pending" } })

    const status = await fetch(`${baseUrl}/pdf-exports/${encodeURIComponent(fixture.workflowFixture.fixture.operation.operationId)}`, {
      headers: { authorization: PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION },
    })
    expect(status.status).toBe(200)
    await expect(status.json()).resolves.toMatchObject({ status: "found", export: { state: "pending" } })

    const unauthenticated = await fetch(`${baseUrl}/pdf-exports/${encodeURIComponent(fixture.workflowFixture.fixture.operation.operationId)}`)
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get("www-authenticate")).toBe("Bearer")

    const method = await fetch(`${baseUrl}/pdf-exports`, { method: "PUT" })
    expect(method.status).toBe(405)
    expect(method.headers.get("allow")).toBe("POST")
  })

  it("enforces bounded JSON and returns only verified terminal PDF bytes", async () => {
    const { fixture, baseUrl } = await setup()
    const oversized = await fetch(`${baseUrl}/pdf-exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(17 * 1024) }),
    })
    expect(oversized.status).toBe(413)
    const unsupported = await fetch(`${baseUrl}/pdf-exports`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    })
    expect(unsupported.status).toBe(415)

    const pin = pdfExportRouteDocumentPin(fixture)
    await fetch(`${baseUrl}/pdf-exports`, {
      method: "POST",
      headers: {
        authorization: PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
        "content-type": "application/json",
        "idempotency-key": PDF_EXPORT_ROUTE_CALLER_KEY,
      },
      body: JSON.stringify(pin),
    })
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture: fixture.workflowFixture,
      repositories: fixture.repositories,
      contentStore: fixture.options.contentStore,
    }))
    if (completed.status === "blocked") throw new Error(JSON.stringify(completed.issues))
    const response = await fetch(`${baseUrl}/pdf-exports/${encodeURIComponent(fixture.workflowFixture.fixture.operation.operationId)}/download`, {
      headers: { authorization: PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toContain("attachment")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(Buffer.from(bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(Number(response.headers.get("content-length"))).toBe(bytes.byteLength)
  })

  it("keeps the candidate out of the default application server", () => {
    const entry = readFileSync(new URL("../server.ts", import.meta.url), "utf8")
    const server = readFileSync(new URL("../http/server.ts", import.meta.url), "utf8")
    expect(entry).not.toMatch(/pdfExportHttpHandler|pdf-exports/u)
    expect(server).not.toMatch(/pdfExportHttpHandler|pdf-exports/u)
  })
})
