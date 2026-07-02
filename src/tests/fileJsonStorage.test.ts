import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createVNextArtifactManifestPlan } from "@flowdoc/vnext-core"
import {
  FLOWDOC_FILE_JSON_STORAGE_MODE,
  FLOWDOC_FILE_JSON_STORAGE_PACKAGE,
  FLOWDOC_FILE_JSON_STORAGE_SOURCE,
  createFlowDocFileJsonArtifactByteStore,
  createFlowDocFileJsonStorageAdapter,
  createFlowDocFileJsonStorageAdapterPlan,
} from "../storage/fileJsonStorage.js"
import type { FlowDocBackendSessionStorageRecord } from "../storage/sessionRecord.js"

function tempStorageRoot(): string {
  return mkdtempSync(join(tmpdir(), "flowdoc-backend-file-json-"))
}

function jsonRecord<T>(value: T): T {
  return value
}

describe("backend file JSON storage", () => {
  const tempRoots: string[] = []

  afterEach(() => {
    tempRoots.splice(0).forEach((root) => {
      rmSync(root, { recursive: true, force: true })
    })
  })

  function createTempAdapter() {
    const root = tempStorageRoot()
    tempRoots.push(root)

    return {
      root,
      adapter: createFlowDocFileJsonStorageAdapter({ rootDirectory: root }),
    }
  }

  it("writes session records through core storage contracts and backend-owned filesystem storage", async () => {
    const { adapter } = createTempAdapter()
    const now = "2026-07-02T10:00:00.000Z"
    const updatedNow = "2026-07-02T10:01:00.000Z"

    const created = await adapter.packageSessions.write({
      kind: "package-session",
      key: "session:backend-storage",
      value: jsonRecord({ sessionId: "backend-storage", title: "first" }) as unknown as FlowDocBackendSessionStorageRecord,
      expectedRevision: null,
      idempotencyKey: "idem:create",
      now,
    })

    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error("expected backend file JSON storage write to succeed")
    expect(created).toMatchObject({
      source: FLOWDOC_FILE_JSON_STORAGE_SOURCE,
      mode: FLOWDOC_FILE_JSON_STORAGE_MODE,
      status: "written",
      record: {
        revision: 0,
        metadata: {
          createdAt: now,
          updatedAt: now,
        },
      },
      contracts: {
        backendOwnedModule: true,
        importsCoreAsPublicPackage: true,
        consumesCoreStorageContracts: true,
        filesystemWrites: true,
        productionStorageReady: false,
      },
    })
    expect(existsSync(created.filePath)).toBe(true)

    const replay = await adapter.packageSessions.write({
      kind: "package-session",
      key: "session:backend-storage",
      value: jsonRecord({ sessionId: "backend-storage", title: "ignored replay" }) as unknown as FlowDocBackendSessionStorageRecord,
      expectedRevision: null,
      idempotencyKey: "idem:create",
      now: updatedNow,
    })

    expect(replay.ok).toBe(true)
    if (!replay.ok) throw new Error("expected backend file JSON idempotency replay to succeed")
    expect(replay.status).toBe("idempotent-replay")
    expect(replay.record.revision).toBe(0)
    expect(replay.record.value).toEqual(created.record.value)

    const conflict = await adapter.packageSessions.write({
      kind: "package-session",
      key: "session:backend-storage",
      value: jsonRecord({ sessionId: "backend-storage", title: "stale" }) as unknown as FlowDocBackendSessionStorageRecord,
      expectedRevision: null,
      idempotencyKey: "idem:conflict",
      now: updatedNow,
    })

    expect(conflict.ok).toBe(false)
    expect(conflict.status).toBe("conflict")
    expect(conflict.conflict).toEqual({ expectedRevision: null, actualRevision: 0 })

    await expect(adapter.packageSessions.read({
      kind: "package-session",
      key: "session:backend-storage",
    })).resolves.toMatchObject({
      ok: true,
      status: "found",
      record: {
        revision: 0,
      },
    })
  })

  it("writes artifact bytes and verifies rendered manifest consistency without mutating the manifest", async () => {
    const root = tempStorageRoot()
    tempRoots.push(root)
    const byteStore = createFlowDocFileJsonArtifactByteStore({ rootDirectory: root })
    const bytes = new TextEncoder().encode("%PDF-1.4\nbackend storage bytes\n")

    const written = await byteStore.write({
      artifactId: "artifact:backend-byte-store",
      mediaType: "application/pdf",
      bytes,
    })

    expect(written.ok).toBe(true)
    if (!written.ok) throw new Error("expected backend artifact bytes write to succeed")
    expect(written.contracts).toMatchObject({
      backendOwnedModule: true,
      artifactByteWrites: true,
      rendererExecution: false,
      productionStorageReady: false,
    })

    const manifestPlan = createVNextArtifactManifestPlan({
      artifactId: "artifact:backend-byte-store",
      sourcePackageId: "product-report-vnext-minimal",
      sessionId: "session:backend-storage",
      jobId: "job:backend-byte-store",
      rendererProfileId: "pdf-spike-profile-v1",
      measurementProfileId: "measurement-profile-v1",
      format: "pdf",
      mediaType: "application/pdf",
      byteLength: written.artifact.byteLength,
      sha256: written.artifact.sha256,
      storageKey: written.artifact.storageKey,
      createdAt: "2026-07-02T10:02:00.000Z",
      status: "rendered",
      error: null,
    })

    expect(manifestPlan.record).not.toBeNull()
    if (manifestPlan.record == null) throw new Error("expected rendered artifact manifest to validate")
    await expect(byteStore.verifyManifestConsistency(manifestPlan.record)).resolves.toMatchObject({
      ok: true,
      status: "consistent",
      artifact: {
        artifactId: "artifact:backend-byte-store",
        byteLength: bytes.byteLength,
        sha256: written.artifact.sha256,
      },
    })
  })

  it("exposes a bounded backend-owned storage plan", () => {
    const plan = createFlowDocFileJsonStorageAdapterPlan("tmp/backend-storage")

    expect(plan).toMatchObject({
      source: FLOWDOC_FILE_JSON_STORAGE_SOURCE,
      mode: FLOWDOC_FILE_JSON_STORAGE_MODE,
      status: "internal-alpha-record-adapter",
      adapterPackageName: FLOWDOC_FILE_JSON_STORAGE_PACKAGE,
      corePackageName: "@flowdoc/vnext-core",
      contracts: {
        backendOwnedModule: true,
        importsCoreAsPublicPackage: true,
        consumesCoreStorageContracts: true,
        concreteBackend: "file-backed-json",
        filesystemWrites: true,
        artifactByteWrites: false,
        productionStorageReady: false,
      },
    })
    expect(plan.adapterPackageName).toBe("flowdoc-vnext-backend")
  })
})
