import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createVNextEditableSession,
  createVNextSessionStorageRecord,
  type VNextArtifactJobCreateInput,
} from "@flowdoc/vnext-core"
import { loadProductReportMinimalPackage } from "../fixtures/productReportMinimal.js"
import { createFlowDocFileJsonStorageAdapter } from "../storage/fileJsonStorage.js"
import {
  FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER,
  FLOWDOC_STORAGE_ROUTE_BINDING_MODE,
  FLOWDOC_STORAGE_ROUTE_BINDING_SOURCE,
  createFlowDocStorageRouteBinding,
} from "../storage/storageRouteBinding.js"

describe("backend storage route binding", () => {
  const tempRoots: string[] = []

  afterEach(() => {
    tempRoots.splice(0).forEach((root) => {
      rmSync(root, { recursive: true, force: true })
    })
  })

  function createBinding() {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-backend-route-storage-"))
    tempRoots.push(root)
    const storageAdapter = createFlowDocFileJsonStorageAdapter({ rootDirectory: root })

    return createFlowDocStorageRouteBinding({ storageAdapter })
  }

  function sessionRecord() {
    const session = createVNextEditableSession(loadProductReportMinimalPackage())

    return createVNextSessionStorageRecord(session, {
      reason: "backend-storage-route-binding-test",
      storageKey: "session:backend-route-binding",
    })
  }

  function jobInput(overrides: Partial<VNextArtifactJobCreateInput> = {}): VNextArtifactJobCreateInput {
    return {
      jobId: "job:backend-route-binding",
      artifactId: "artifact:backend-route-binding",
      sourcePackageId: "product-report-vnext-minimal",
      sessionId: "session:backend-route-binding",
      layoutProfileId: "layout-profile-v1",
      measurementProfileId: "measurement-profile-v1",
      rendererProfileId: "pdf-spike-profile-v1",
      format: "pdf",
      mediaType: "application/pdf",
      createdAt: "2026-07-02T10:10:00.000Z",
      ...overrides,
    }
  }

  it("saves and loads session records through backend-owned storage", async () => {
    const binding = createBinding()
    const record = sessionRecord()

    const saved = await binding.saveSession({
      method: "POST",
      body: {
        requestId: "request:save-session",
        key: "session:backend-route-binding",
        expectedRevision: null,
        idempotencyKey: "idem:save-session",
        now: "2026-07-02T10:10:00.000Z",
        record,
      },
    })
    const loaded = await binding.loadSession({
      method: "GET",
      body: {
        requestId: "request:load-session",
        key: "session:backend-route-binding",
      },
    })

    expect(saved).toMatchObject({
      ok: true,
      source: FLOWDOC_STORAGE_ROUTE_BINDING_SOURCE,
      mode: FLOWDOC_STORAGE_ROUTE_BINDING_MODE,
      action: "session.save",
      method: "POST",
      httpStatus: 201,
      body: {
        bytes: null,
        result: {
          status: "saved",
          storage: {
            adapter: FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER,
            reads: false,
            writes: true,
            recordKinds: ["package-session"],
            byteReads: false,
            byteWrites: false,
          },
        },
        session: {
          manifest: {
            packageId: "product-report-vnext-minimal",
          },
        },
      },
      contracts: {
        routeShapeOnly: true,
        concreteStorageAdapter: true,
        serverRoute: false,
        authzExecution: false,
        artifactByteWrites: false,
        productionStorageReady: false,
      },
    })
    expect(loaded).toMatchObject({
      ok: true,
      action: "session.load",
      method: "GET",
      httpStatus: 200,
      body: {
        result: {
          status: "loaded",
          storage: {
            adapter: FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER,
            reads: true,
            writes: false,
            recordKinds: ["package-session"],
          },
        },
        session: {
          manifest: {
            packageId: "product-report-vnext-minimal",
          },
        },
      },
    })
    expect(JSON.parse(JSON.stringify(loaded))).toEqual(loaded)
  })

  it("maps storage conflict, missing records, and wrong methods into bounded route responses", async () => {
    const binding = createBinding()
    const record = sessionRecord()
    await binding.saveSession({
      method: "POST",
      body: {
        key: "session:route-conflict",
        expectedRevision: null,
        idempotencyKey: "idem:first",
        now: "2026-07-02T10:11:00.000Z",
        record,
      },
    })

    const conflict = await binding.saveSession({
      method: "POST",
      body: {
        key: "session:route-conflict",
        expectedRevision: null,
        idempotencyKey: "idem:conflict",
        now: "2026-07-02T10:12:00.000Z",
        record,
      },
    })
    const missing = await binding.loadSession({
      method: "GET",
      body: {
        key: "session:missing",
      },
    })
    const wrongMethod = await binding.loadSession({
      method: "POST",
      body: {
        key: "session:route-conflict",
      },
    })

    expect(conflict).toMatchObject({
      ok: false,
      httpStatus: 409,
      body: {
        result: {
          status: "conflict",
        },
        issues: [expect.objectContaining({ code: "revision-conflict" })],
      },
    })
    expect(missing).toMatchObject({
      ok: false,
      httpStatus: 404,
      body: {
        result: {
          status: "missing",
        },
      },
    })
    expect(wrongMethod).toMatchObject({
      ok: false,
      method: "POST",
      allowedMethods: ["GET"],
      httpStatus: 405,
      body: {
        result: null,
        bytes: null,
        issues: [expect.objectContaining({ code: "method-not-allowed" })],
      },
    })
  })

  it("creates artifact request records and reads job status and manifest metadata through storage", async () => {
    const binding = createBinding()
    const requested = await binding.requestArtifactGeneration({
      method: "POST",
      body: {
        requestId: "request:artifact-generation",
        idempotencyKey: "idem:artifact-generation",
        now: "2026-07-02T10:13:00.000Z",
        jobInput: jobInput(),
      },
    })
    const status = await binding.getArtifactStatus({
      method: "GET",
      body: {
        requestId: "request:artifact-status",
        jobKey: "job:backend-route-binding",
      },
    })
    const metadata = await binding.getArtifactMetadata({
      method: "GET",
      body: {
        requestId: "request:artifact-metadata",
        artifactId: "artifact:backend-route-binding",
      },
    })

    expect(requested).toMatchObject({
      ok: true,
      action: "artifact.request",
      httpStatus: 202,
      body: {
        result: {
          status: "accepted",
          retry: {
            idempotencyKey: "idem:artifact-generation",
            retryAfterMs: 1000,
          },
          storage: {
            adapter: FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER,
            reads: false,
            writes: true,
            recordKinds: ["artifact-manifest", "artifact-job"],
            byteReads: false,
            byteWrites: false,
          },
        },
        artifact: {
          artifactId: "artifact:backend-route-binding",
          status: "planned",
          byteLength: null,
          sha256: null,
          storageKey: null,
        },
        job: {
          jobId: "job:backend-route-binding",
          status: "queued",
        },
      },
    })
    expect(status).toMatchObject({
      ok: true,
      action: "artifact.status",
      httpStatus: 200,
      body: {
        result: {
          status: "ready",
          retry: {
            retryAfterMs: 1000,
          },
          storage: {
            adapter: FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER,
            reads: true,
            writes: false,
            recordKinds: ["artifact-job"],
          },
        },
        job: {
          jobId: "job:backend-route-binding",
          status: "queued",
        },
        artifact: {
          artifactId: "artifact:backend-route-binding",
          status: "planned",
        },
      },
    })
    expect(metadata).toMatchObject({
      ok: true,
      action: "artifact.metadata",
      httpStatus: 200,
      body: {
        result: {
          status: "ready",
          storage: {
            adapter: FLOWDOC_BACKEND_FILE_JSON_STORAGE_ADAPTER,
            reads: true,
            writes: false,
            recordKinds: ["artifact-manifest"],
          },
        },
        artifact: {
          artifactId: "artifact:backend-route-binding",
          status: "planned",
        },
        job: null,
      },
    })
  })
})
