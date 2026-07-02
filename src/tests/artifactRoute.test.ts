import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  createVNextArtifactManifestPlan,
  type VNextArtifactManifestRecord,
} from "@flowdoc/vnext-core"
import {
  FLOWDOC_BACKEND_ARTIFACT_ROUTE_MODE,
  FLOWDOC_BACKEND_ARTIFACT_ROUTE_SOURCE,
  createFlowDocBackendArtifactDownloadMetadataRouteResponse,
  createFlowDocBackendArtifactGenerationRouteResponse,
  createFlowDocBackendArtifactStatusRouteResponse,
  createFlowDocBackendSessionArtifactListRouteResponse,
} from "../routes/artifactRoute.js"

const SHA256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

function permission(scope: string) {
  return {
    principalId: "user:backend-route-parity",
    tenantId: "tenant:flowdoc",
    scope,
  }
}

function artifactInput(overrides: Record<string, unknown> = {}) {
  return {
    artifactId: "artifact:backend-route-parity",
    sourcePackageId: "product-report-vnext-minimal",
    sessionId: "session:backend-route-parity",
    jobId: "job:backend-route-parity",
    rendererProfileId: "pdf-spike-profile-v1",
    measurementProfileId: "text-engine-profile-v1",
    format: "pdf",
    mediaType: "application/pdf",
    createdAt: "2026-07-03T01:00:00.000Z",
    ...overrides,
  }
}

function manifest(overrides: Record<string, unknown> = {}): VNextArtifactManifestRecord {
  const plan = createVNextArtifactManifestPlan({
    ...artifactInput(),
    byteLength: 4096,
    sha256: SHA256,
    storageKey: "artifacts/backend-route-parity/artifact.pdf",
    status: "rendered",
    error: null,
    ...overrides,
  })
  if (plan.record == null) throw new Error("test manifest did not validate")
  return plan.record
}

describe("backend artifact route parity", () => {
  it("accepts artifact generation requests as backend-owned planned manifests", () => {
    const response = createFlowDocBackendArtifactGenerationRouteResponse({
      method: "POST",
      body: {
        requestId: "request:backend-artifact-route",
        idempotencyKey: "idem:backend-artifact-route",
        permission: permission("artifact:generate"),
        artifact: artifactInput(),
      },
    })

    expect(response).toMatchObject({
      ok: true,
      source: FLOWDOC_BACKEND_ARTIFACT_ROUTE_SOURCE,
      mode: FLOWDOC_BACKEND_ARTIFACT_ROUTE_MODE,
      action: "artifact.request",
      method: "POST",
      allowedMethods: ["POST"],
      httpStatus: 202,
      body: {
        result: {
          status: "accepted",
          requestId: "request:backend-artifact-route",
          idempotencyKey: "idem:backend-artifact-route",
          artifactStatus: "planned",
          permission: {
            required: true,
            checked: false,
            context: {
              principalId: "user:backend-route-parity",
              tenantId: "tenant:flowdoc",
              scope: "artifact:generate",
              checked: false,
            },
          },
          retry: {
            safe: true,
            idempotencyKey: "idem:backend-artifact-route",
            retryAfterMs: 1000,
          },
          job: {
            status: "not-created",
            reason: "backend-route-contract-only",
          },
          storage: {
            reads: false,
            writes: false,
            reason: "backend-route-contract-only",
          },
          renderer: {
            execution: false,
          },
        },
        artifact: {
          artifactId: "artifact:backend-route-parity",
          status: "planned",
          byteLength: null,
          sha256: null,
          storageKey: null,
          storageStatus: "not-written",
        },
        bytes: null,
        download: null,
      },
      contracts: {
        backendOwnedModule: true,
        importsCoreAsPublicPackage: true,
        usesCoreArtifactManifestContract: true,
        serverRoute: false,
        storageWrites: false,
        authzExecution: false,
        rendererExecution: false,
        productionRouteReady: false,
      },
    })
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
  })

  it("maps invalid artifact request shapes to bounded route responses", () => {
    const response = createFlowDocBackendArtifactGenerationRouteResponse({
      method: "POST",
      body: {
        permission: permission("artifact:read"),
        artifact: artifactInput({ format: "spreadsheet" }),
      },
    })

    expect(response.ok).toBe(false)
    expect(response.httpStatus).toBe(400)
    expect(response.body.result).toBeNull()
    expect(response.body.artifact).toBeNull()
    expect(response.body.bytes).toBeNull()
    expect(response.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "request", code: "invalid-string", path: "idempotencyKey" }),
      expect.objectContaining({ category: "permission", code: "invalid-permission-scope", path: "permission.scope" }),
      expect.objectContaining({ category: "artifact", code: "invalid-format", path: "artifact.format" }),
    ]))
  })

  it("reports artifact status, lists session artifacts, and returns download metadata without bytes", () => {
    const rendering = manifest({
      byteLength: null,
      sha256: null,
      storageKey: "artifacts/backend-route-parity/rendering.pdf",
      status: "rendering",
    })
    const first = manifest({ artifactId: "artifact:session-match-1", sessionId: "session:backend-route-parity" })
    const second = manifest({ artifactId: "artifact:other-session", sessionId: "session:other" })
    const rendered = manifest()

    const status = createFlowDocBackendArtifactStatusRouteResponse({
      method: "GET",
      body: {
        requestId: "request:artifact-status",
        artifactId: rendering.artifactId,
        permission: permission("artifact:read"),
        artifactManifest: rendering,
      },
    })
    const listed = createFlowDocBackendSessionArtifactListRouteResponse({
      method: "GET",
      body: {
        requestId: "request:artifact-list",
        sessionId: "session:backend-route-parity",
        permission: permission("artifact:list"),
        artifacts: [first, second, rendered],
      },
    })
    const download = createFlowDocBackendArtifactDownloadMetadataRouteResponse({
      method: "GET",
      body: {
        requestId: "request:artifact-download",
        artifactId: rendered.artifactId,
        permission: permission("artifact:download"),
        artifactManifest: rendered,
      },
    })

    expect(status).toMatchObject({
      ok: true,
      httpStatus: 200,
      body: {
        action: "artifact.status",
        result: {
          status: "ready",
          requestId: "request:artifact-status",
          artifactStatus: "rendering",
          retry: {
            retryAfterMs: 1000,
          },
        },
        artifact: {
          artifactId: rendering.artifactId,
          status: "rendering",
        },
        bytes: null,
      },
    })
    expect(listed.ok).toBe(true)
    expect(listed.body.artifacts.map((artifact) => artifact.artifactId)).toEqual([
      "artifact:session-match-1",
      "artifact:backend-route-parity",
    ])
    expect(download).toMatchObject({
      ok: true,
      httpStatus: 200,
      body: {
        action: "artifact.downloadMetadata",
        bytes: null,
        download: {
          artifactId: rendered.artifactId,
          byteLength: 4096,
          sha256: SHA256,
          storageKey: "artifacts/backend-route-parity/artifact.pdf",
          url: null,
          bytes: null,
          status: "metadata-only",
        },
      },
    })
  })

  it("blocks non-rendered downloads and rejects wrong methods", () => {
    const planned = manifest({
      byteLength: null,
      sha256: null,
      storageKey: null,
      status: "planned",
    })
    const blockedDownload = createFlowDocBackendArtifactDownloadMetadataRouteResponse({
      method: "GET",
      body: {
        artifactId: planned.artifactId,
        permission: permission("artifact:download"),
        artifactManifest: planned,
      },
    })
    const methodBlocked = createFlowDocBackendArtifactStatusRouteResponse({
      method: "POST",
      body: {
        artifactId: planned.artifactId,
        permission: permission("artifact:read"),
        artifactManifest: planned,
      },
    })

    expect(blockedDownload.ok).toBe(false)
    expect(blockedDownload.httpStatus).toBe(400)
    expect(blockedDownload.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "artifact-not-rendered", path: "artifactManifest.status" }),
    ]))
    expect(methodBlocked).toMatchObject({
      ok: false,
      method: "POST",
      allowedMethods: ["GET"],
      httpStatus: 405,
      body: {
        action: "artifact.status",
        result: null,
        artifact: null,
        bytes: null,
      },
    })
  })

  it("keeps backend artifact route parity independent from core route helpers and concrete execution", () => {
    const source = readFileSync(new URL("../routes/artifactRoute.ts", import.meta.url), "utf8")

    expect(source).toContain("createVNextArtifactManifestPlan")
    expect(source).toContain("backendOwnedModule: true")
    expect(source).not.toContain("createVNextArtifactGenerationApiRouteResponse")
    expect(source).not.toContain("createVNextArtifactStatusApiRouteResponse")
    expect(source).not.toMatch(/node:http|node:https|express|fastify/)
    expect(source).not.toMatch(/node:fs|writeFile|createWriteStream|appendFile|mkdir|rm\(/)
    expect(source).not.toContain("fetch(")
    expect(source).not.toContain("runFlowDocBackendArtifactJobExecution")
    expect(source).not.toContain("createFlowDocFileJsonStorageAdapter")
    expect(source).not.toContain("ReadableStream")
  })
})
