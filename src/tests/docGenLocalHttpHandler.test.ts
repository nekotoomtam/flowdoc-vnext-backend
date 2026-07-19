import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportLocalHttpServerV1,
  type FlowDocBackendDocGenLocalHttpHandlerOptionsV1,
  type FlowDocBackendPdfExportAuthenticatedIdentityV1,
} from "../index.js"
import {
  DOCGEN_LOCAL_AUTHORIZATION,
  DOCGEN_LOCAL_IDEMPOTENCY_KEY,
  DOCGEN_LOCAL_IDENTITY,
  createDocGenLocalAdmissionFixture,
  docGenLocalDirectRequest,
  docGenLocalStructureRef,
} from "./helpers/docGenLocalFixture.js"
import { createPdfExportRouteFixture } from "./helpers/pdfExportRouteFixture.js"

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function contentStore() {
  const root = mkdtempSync(join(tmpdir(), "flowdoc-docgen-local-http-"))
  roots.push(root)
  return createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
}

function docGenHttpOptions(input: {
  maximum?: number
  authorizationCalls?: Array<{ principalId: string; structureVersionId: string }>
} = {}): FlowDocBackendDocGenLocalHttpHandlerOptionsV1 {
  const fixture = createDocGenLocalAdmissionFixture()
  return {
    admission: fixture.admission,
    ...(input.maximum == null ? {} : { maxBodyBytes: input.maximum }),
    authenticator: {
      async authenticate({ authorization }) {
        if (authorization === DOCGEN_LOCAL_AUTHORIZATION) {
          return { status: "authenticated", identity: DOCGEN_LOCAL_IDENTITY, issues: [] }
        }
        if (authorization === "Bearer docgen-local-denied") {
          const identity: FlowDocBackendPdfExportAuthenticatedIdentityV1 = {
            ...DOCGEN_LOCAL_IDENTITY,
            principalId: "principal:docgen-local-denied",
            authenticationId: "authentication:docgen-local-denied",
          }
          return { status: "authenticated", identity, issues: [] }
        }
        return {
          status: "unauthenticated",
          identity: null,
          issues: [{ severity: "error", code: "test-unauthenticated", path: "authorization", message: "denied" }],
        }
      },
    },
    authorizer: {
      async authorize({ identity, action, structure }) {
        input.authorizationCalls?.push({
          principalId: identity.principalId,
          structureVersionId: structure.structureVersionId,
        })
        if (
          action === "docgen:admit"
          && identity.principalId === DOCGEN_LOCAL_IDENTITY.principalId
          && structure.structureVersionId === docGenLocalStructureRef().structureVersionId
        ) return { status: "authorized", authorizationId: "authorization:docgen-admit", issues: [] }
        return {
          status: "denied",
          authorizationId: null,
          issues: [{ severity: "error", code: "test-denied", path: "structure", message: "denied" }],
        }
      },
    },
  }
}

async function localServer(docGenAdmissionOptions?: FlowDocBackendDocGenLocalHttpHandlerOptionsV1) {
  const pdfFixture = createPdfExportRouteFixture({ contentStore: contentStore() })
  const server = createFlowDocBackendPdfExportLocalHttpServerV1({
    host: "127.0.0.1",
    port: 0,
    routeOptions: pdfFixture.options,
    ...(docGenAdmissionOptions == null ? {} : { docGenAdmissionOptions }),
  })
  const evidence = await server.start()
  return { server, origin: `http://127.0.0.1:${evidence.listenerPort}`, evidence }
}

function requestHeaders(authorization = DOCGEN_LOCAL_AUTHORIZATION) {
  return {
    authorization,
    "content-type": "application/json",
    "idempotency-key": DOCGEN_LOCAL_IDEMPOTENCY_KEY,
  }
}

describe("PDF export REALDOC-E.3 local DocGen HTTP admission", () => {
  it("does not allow composition to raise the fixed E.3 HTTP ceiling", () => {
    const options = docGenHttpOptions({ maximum: 2 * 1024 * 1024 + 1 })
    const pdfFixture = createPdfExportRouteFixture({ contentStore: contentStore() })
    expect(() => createFlowDocBackendPdfExportLocalHttpServerV1({
      host: "127.0.0.1",
      port: 0,
      routeOptions: pdfFixture.options,
      docGenAdmissionOptions: options,
    })).toThrow("no greater than the E.3 maximum")
  })

  it("is absent unless explicitly mounted on the loopback-only local server", async () => {
    const withoutDocGen = await localServer()
    try {
      expect(withoutDocGen.evidence).toMatchObject({
        listenerScope: "loopback-only",
        docGenAdmissionMounted: false,
        defaultApplicationServerMounted: false,
        corsEnabled: false,
        productionBinding: false,
      })
      const response = await fetch(`${withoutDocGen.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(docGenLocalDirectRequest()),
      })
      expect(response.status).toBe(404)
    } finally {
      await withoutDocGen.server.close()
    }

    const withDocGen = await localServer(docGenHttpOptions())
    try {
      expect(withDocGen.evidence.docGenAdmissionMounted).toBe(true)
      const response = await fetch(`${withDocGen.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(docGenLocalDirectRequest()),
      })
      expect(response.status).toBe(202)
      expect(response.headers.get("access-control-allow-origin")).toBeNull()
    } finally {
      await withDocGen.server.close()
    }
  })

  it("authenticates, authorizes the exact Structure, and returns a content-free receipt", async () => {
    const authorizationCalls: Array<{ principalId: string; structureVersionId: string }> = []
    const mounted = await localServer(docGenHttpOptions({ authorizationCalls }))
    try {
      const unauthenticated = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": DOCGEN_LOCAL_IDEMPOTENCY_KEY },
        body: JSON.stringify(docGenLocalDirectRequest()),
      })
      expect(unauthenticated.status).toBe(401)
      expect(unauthenticated.headers.get("www-authenticate")).toBe("Bearer")

      const denied = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: requestHeaders("Bearer docgen-local-denied"),
        body: JSON.stringify(docGenLocalDirectRequest()),
      })
      expect(denied.status).toBe(403)

      const admitted = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(docGenLocalDirectRequest()),
      })
      expect(admitted.status).toBe(202)
      const body = await admitted.json() as { status: string; admission: unknown }
      expect(body).toMatchObject({
        status: "created",
        admission: {
          lane: "direct",
          instance: { revision: 0 },
          nextStep: "materialization",
          contracts: { workerEnqueued: false, productionBinding: false },
        },
      })
      expect(JSON.stringify(body)).not.toContain("Private report")
      expect(JSON.stringify(body)).not.toContain("Private item")
      expect(JSON.stringify(body)).not.toContain(DOCGEN_LOCAL_IDEMPOTENCY_KEY)
      expect(authorizationCalls).toEqual([
        {
          principalId: "principal:docgen-local-denied",
          structureVersionId: docGenLocalStructureRef().structureVersionId,
        },
        {
          principalId: DOCGEN_LOCAL_IDENTITY.principalId,
          structureVersionId: docGenLocalStructureRef().structureVersionId,
        },
      ])
    } finally {
      await mounted.server.close()
    }
  })

  it("enforces bounded JSON, content type, methods, replay, and idempotency conflicts", async () => {
    const mounted = await localServer(docGenHttpOptions({ maximum: 2_048 }))
    try {
      const unsupported = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      })
      expect(unsupported.status).toBe(415)

      const oversized = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(3_000) }),
      })
      expect(oversized.status).toBe(413)

      const method = await fetch(`${mounted.origin}/docgen-local/admissions`, { method: "GET" })
      expect(method.status).toBe(405)
      expect(method.headers.get("allow")).toBe("POST")

      const created = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(docGenLocalDirectRequest()),
      })
      expect(created.status).toBe(202)
      const replayed = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(docGenLocalDirectRequest()),
      })
      expect(replayed.status).toBe(200)
      await expect(replayed.json()).resolves.toMatchObject({ status: "replayed" })

      const conflict = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(docGenLocalDirectRequest({ title: "Changed", name: "Item", amount: 1 })),
      })
      expect(conflict.status).toBe(409)
      await expect(conflict.json()).resolves.toMatchObject({
        status: "idempotency-conflict",
        issues: [{ code: "docgen-idempotency-conflict" }],
      })
    } finally {
      await mounted.server.close()
    }
  })

  it("maps admission failures to 422 without exposing provider or business content", async () => {
    const mounted = await localServer(docGenHttpOptions())
    try {
      const request = docGenLocalDirectRequest()
      request.structure = { ...request.structure, versionOrdinal: 2 }
      const response = await fetch(`${mounted.origin}/docgen-local/admissions`, {
        method: "POST",
        headers: { ...requestHeaders(), "idempotency-key": "docgen:http:unknown-structure" },
        body: JSON.stringify(request),
      })
      expect(response.status).toBe(422)
      const body = await response.json()
      expect(body).toMatchObject({ status: "blocked", issues: [{ code: "docgen-structure-not-found" }] })
      expect(JSON.stringify(body)).not.toContain("Private report")
    } finally {
      await mounted.server.close()
    }
  })
})
