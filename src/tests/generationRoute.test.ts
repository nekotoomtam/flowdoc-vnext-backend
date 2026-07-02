import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { loadProductReportMinimalPackage } from "../fixtures/productReportMinimal.js"
import {
  FLOWDOC_BACKEND_GENERATION_ROUTE_ACTION,
  FLOWDOC_BACKEND_GENERATION_ROUTE_MODE,
  FLOWDOC_BACKEND_GENERATION_ROUTE_SOURCE,
  createFlowDocBackendGenerationRouteResponse,
} from "../routes/generationRoute.js"

describe("backend generation route parity", () => {
  it("wraps core readiness in a backend-owned route response", () => {
    const response = createFlowDocBackendGenerationRouteResponse({
      method: "POST",
      body: {
        requestId: "backend-generation-route-request-1",
        idempotencyKey: "backend-generation-route-idem-1",
        template: { package: loadProductReportMinimalPackage() },
        output: { kind: "diagnostics", measurementProfileId: "backend-default" },
      },
    })

    expect(response).toMatchObject({
      ok: true,
      source: FLOWDOC_BACKEND_GENERATION_ROUTE_SOURCE,
      mode: FLOWDOC_BACKEND_GENERATION_ROUTE_MODE,
      action: FLOWDOC_BACKEND_GENERATION_ROUTE_ACTION,
      method: "POST",
      allowedMethods: ["POST"],
      httpStatus: 200,
      headers: {
        allow: "POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
      body: {
        artifact: null,
        generatedDocument: null,
        issues: [],
        result: {
          ok: true,
          source: "vnext-generation-runtime",
          mode: "readiness-only",
          status: "ready",
          request: {
            requestId: "backend-generation-route-request-1",
            idempotencyKey: "backend-generation-route-idem-1",
            outputKind: "diagnostics",
            measurementProfileId: "backend-default",
          },
          artifact: null,
          generatedDocument: null,
        },
      },
      contracts: {
        backendOwnedModule: true,
        importsCoreAsPublicPackage: true,
        usesCoreReadinessRuntime: true,
        serverRoute: false,
        storageWrites: false,
        rendererExecution: false,
        productionRouteReady: false,
      },
    })
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
  })

  it("maps invalid generation requests and wrong methods without artifact execution", () => {
    const invalid = createFlowDocBackendGenerationRouteResponse({
      method: "post",
      body: {
        template: {},
        output: { kind: "diagnostics" },
      },
    })
    const wrongMethod = createFlowDocBackendGenerationRouteResponse({
      method: "GET",
      body: {
        template: { package: loadProductReportMinimalPackage() },
        output: { kind: "diagnostics" },
      },
    })

    expect(invalid).toMatchObject({
      ok: false,
      method: "POST",
      httpStatus: 400,
      body: {
        result: {
          ok: false,
          status: "blocked",
          reason: "invalid-request",
          artifact: null,
          generatedDocument: null,
        },
        artifact: null,
        generatedDocument: null,
      },
    })
    expect(invalid.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "request", path: "template.package" }),
    ]))
    expect(wrongMethod).toMatchObject({
      ok: false,
      method: "GET",
      allowedMethods: ["POST"],
      httpStatus: 405,
      body: {
        result: null,
        artifact: null,
        generatedDocument: null,
        issues: [expect.objectContaining({ code: "method-not-allowed" })],
      },
    })
  })

  it("keeps backend route parity independent from core route helpers and concrete execution", () => {
    const source = readFileSync(new URL("../routes/generationRoute.ts", import.meta.url), "utf8")

    expect(source).toContain("assessVNextGenerationReadiness")
    expect(source).toContain("backendOwnedModule: true")
    expect(source).not.toContain("createVNextGenerationApiRouteResponse")
    expect(source).not.toMatch(/node:http|node:https|express|fastify/)
    expect(source).not.toMatch(/node:fs|writeFile|createWriteStream|appendFile|mkdir|rm\(/)
    expect(source).not.toContain("fetch(")
    expect(source).not.toContain("runFlowDocBackendArtifactJobExecution")
    expect(source).not.toContain("createFlowDocFileJsonStorageAdapter")
  })
})
