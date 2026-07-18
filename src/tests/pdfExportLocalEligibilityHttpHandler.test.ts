import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportLocalHttpServerV1,
} from "../index.js"
import {
  PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
  createPdfExportRouteFixture,
  pdfExportRouteDocumentPin,
} from "./helpers/pdfExportRouteFixture.js"

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function contentStore() {
  const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-local-f-eligibility-"))
  roots.push(root)
  return createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
}

describe("PDF export LOCAL-F eligibility HTTP contract", () => {
  it("authenticates the exact pin without admitting an export operation", async () => {
    const fixture = createPdfExportRouteFixture({ contentStore: contentStore() })
    const pin = pdfExportRouteDocumentPin(fixture)
    const localServer = createFlowDocBackendPdfExportLocalHttpServerV1({
      host: "127.0.0.1",
      port: 0,
      routeOptions: fixture.options,
      eligibilityOptions: {
        authenticator: fixture.options.authenticator,
        authorizer: fixture.options.authorizer,
        inspectEligibility(input) {
          if (input.documentId !== pin.documentId) return {
            status: "ineligible",
            lane: null,
            reason: "unsupported-document",
          }
          if (input.documentRevision !== pin.documentRevision) return {
            status: "stale",
            lane: null,
            reason: "revision-mismatch",
          }
          return { status: "eligible", lane: "canonical-evidence", reason: null }
        },
      },
    })

    try {
      const mounted = await localServer.start()
      const origin = `http://127.0.0.1:${mounted.listenerPort}`
      const unauthenticated = await fetch(
        `${origin}/pdf-export-local/eligibility?documentId=${encodeURIComponent(pin.documentId)}&documentRevision=${pin.documentRevision}`,
      )
      expect(unauthenticated.status).toBe(401)
      expect(unauthenticated.headers.get("www-authenticate")).toBe("Bearer")

      const response = await fetch(
        `${origin}/pdf-export-local/eligibility?documentId=${encodeURIComponent(pin.documentId)}&documentRevision=${pin.documentRevision}`,
        { headers: { authorization: PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION } },
      )
      expect(response.status).toBe(200)
      expect(response.headers.get("access-control-allow-origin")).toBeNull()
      await expect(response.json()).resolves.toEqual({
        source: "flowdoc-backend-pdf-export-local-eligibility",
        contractVersion: 1,
        kind: "pdf-export-local-eligibility",
        status: "eligible",
        documentId: pin.documentId,
        documentRevision: pin.documentRevision,
        lane: "canonical-evidence",
        reason: null,
        contracts: {
          exactDocumentPin: true,
          requestBodyIdentityFieldsForbidden: true,
          sameOriginDevelopmentProxyRequired: true,
          productionBinding: false,
        },
      })
      expect(fixture.resolverCalls()).toBe(0)
      expect(fixture.authorizationCalls).toEqual([
        expect.objectContaining({
          action: "pdf-export:request",
          documentId: pin.documentId,
          operationId: null,
        }),
      ])
    } finally {
      await localServer.close()
    }
  })

  it("reports stale and unsupported pins without fixture substitution", async () => {
    const fixture = createPdfExportRouteFixture({ contentStore: contentStore() })
    const pin = pdfExportRouteDocumentPin(fixture)
    const localServer = createFlowDocBackendPdfExportLocalHttpServerV1({
      host: "127.0.0.1",
      port: 0,
      routeOptions: fixture.options,
      eligibilityOptions: {
        authenticator: fixture.options.authenticator,
        authorizer: fixture.options.authorizer,
        inspectEligibility(input) {
          if (input.documentId !== pin.documentId) return {
            status: "ineligible",
            lane: null,
            reason: "unsupported-document",
          }
          if (input.documentRevision !== pin.documentRevision) return {
            status: "stale",
            lane: null,
            reason: "revision-mismatch",
          }
          return { status: "eligible", lane: "canonical-evidence", reason: null }
        },
      },
    })

    try {
      const mounted = await localServer.start()
      const origin = `http://127.0.0.1:${mounted.listenerPort}`
      const headers = { authorization: PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION }
      const stale = await fetch(
        `${origin}/pdf-export-local/eligibility?documentId=${encodeURIComponent(pin.documentId)}&documentRevision=${pin.documentRevision + 1}`,
        { headers },
      )
      expect(stale.status).toBe(200)
      await expect(stale.json()).resolves.toMatchObject({
        status: "stale",
        lane: null,
        reason: "revision-mismatch",
      })

      const unsupported = await fetch(
        `${origin}/pdf-export-local/eligibility?documentId=${encodeURIComponent("document:not-canonical")}&documentRevision=1`,
        { headers },
      )
      expect(unsupported.status).toBe(200)
      await expect(unsupported.json()).resolves.toMatchObject({
        status: "ineligible",
        lane: null,
        reason: "unsupported-document",
      })
      expect(fixture.resolverCalls()).toBe(0)
      expect(fixture.authorizationCalls).toHaveLength(1)
    } finally {
      await localServer.close()
    }
  })
})
