import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { VNextArtifactJobCreateInput } from "@flowdoc/vnext-core"
import {
  FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_MODE,
  FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_SOURCE,
  runFlowDocBackendArtifactJobExecution,
  type FlowDocBackendArtifactJobExecutionIssue,
} from "../artifacts/artifactJobExecution.js"
import {
  createFlowDocFileJsonArtifactByteStore,
  createFlowDocFileJsonStorageAdapter,
} from "../storage/fileJsonStorage.js"

function jobInput(overrides: Partial<VNextArtifactJobCreateInput> = {}): VNextArtifactJobCreateInput {
  return {
    jobId: "job:backend-artifact-execution",
    artifactId: "artifact:backend-artifact-execution",
    sourcePackageId: "product-report-vnext-minimal",
    sessionId: "session:backend-artifact-execution",
    layoutProfileId: "layout-profile-v1",
    measurementProfileId: "measurement-profile-v1",
    rendererProfileId: "renderer-injected-v1",
    format: "pdf",
    mediaType: "application/pdf",
    createdAt: "2026-07-02T10:20:00.000Z",
    ...overrides,
  }
}

function rendererIssue(code: string, message: string): FlowDocBackendArtifactJobExecutionIssue {
  return {
    severity: "blocking",
    code,
    path: "renderer",
    message,
  }
}

describe("backend artifact job execution", () => {
  const tempRoots: string[] = []

  afterEach(() => {
    tempRoots.splice(0).forEach((root) => {
      rmSync(root, { recursive: true, force: true })
    })
  })

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-backend-artifact-job-"))
    tempRoots.push(root)
    return root
  }

  it("executes a job through injected renderer bytes and backend file storage", async () => {
    const rootDirectory = tempRoot()
    const result = await runFlowDocBackendArtifactJobExecution({
      rootDirectory,
      jobInput: jobInput(),
      now: "2026-07-02T10:20:00.000Z",
      renderArtifact: (request) => ({
        ok: true,
        status: "rendered",
        mediaType: request.job.artifact.mediaType,
        bytes: new TextEncoder().encode("%PDF-1.4\nbackend injected renderer\n"),
        rendererProfileId: request.job.profiles.rendererProfileId,
        productionFidelity: false,
        issues: [],
      }),
    })

    expect(result).toMatchObject({
      source: FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_SOURCE,
      mode: FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_MODE,
      status: "rendered",
      job: {
        jobId: "job:backend-artifact-execution",
        status: "rendered",
        revision: 1,
      },
      artifact: {
        artifactId: "artifact:backend-artifact-execution",
        status: "rendered",
        revision: 2,
      },
      renderer: {
        rendererProfileId: "renderer-injected-v1",
        status: "rendered",
        productionFidelity: false,
        injected: true,
      },
      bytes: {
        artifactId: "artifact:backend-artifact-execution",
        writeStatus: "written",
        readStatus: "found",
        consistencyStatus: "consistent",
      },
      contracts: {
        backendOwnedModule: true,
        importsCoreAsPublicPackage: true,
        usesConcreteFileJsonStorage: true,
        recordStorageWrites: true,
        artifactByteWrites: true,
        rendererInjected: true,
        workerOrQueue: false,
        backendRoute: false,
        authzExecution: false,
        productionRendererReady: false,
        productionStorageReady: false,
        multiRecordTransactions: false,
      },
      issues: [],
    })
    expect(result.records.map((entry) => [entry.kind, entry.revision, entry.artifactStatus, entry.jobStatus])).toEqual([
      ["artifact-manifest", 0, "planned", null],
      ["artifact-job", 0, null, "queued"],
      ["artifact-manifest", 1, "rendering", null],
      ["artifact-manifest", 2, "rendered", null],
      ["artifact-job", 1, null, "rendered"],
    ])
    expect(result.bytes?.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.artifact?.sha256).toBe(result.bytes?.sha256)

    const adapter = createFlowDocFileJsonStorageAdapter({ rootDirectory })
    const storedJob = await adapter.artifactJobs.read({
      kind: "artifact-job",
      key: "job:backend-artifact-execution",
    })
    const storedManifest = await adapter.artifactManifests.read({
      kind: "artifact-manifest",
      key: "artifact:backend-artifact-execution",
    })
    expect(storedJob.ok).toBe(true)
    expect(storedManifest.ok).toBe(true)
    if (!storedJob.ok || !storedManifest.ok || result.artifact?.storageKey == null) {
      throw new Error("stored backend artifact job evidence missing")
    }
    expect(storedJob.record.value.status).toBe("rendered")
    expect(storedManifest.record.value.status).toBe("rendered")

    const byteStore = createFlowDocFileJsonArtifactByteStore({ rootDirectory })
    const storedBytes = await byteStore.read({ storageKey: result.artifact.storageKey })
    expect(storedBytes.ok).toBe(true)
    if (!storedBytes.ok) throw new Error("stored backend artifact bytes missing")
    expect(Buffer.from(storedBytes.bytes).toString("utf8")).toContain("backend injected renderer")
  })

  it("persists failed job and failed manifest when the injected renderer blocks", async () => {
    const rootDirectory = tempRoot()
    const result = await runFlowDocBackendArtifactJobExecution({
      rootDirectory,
      jobInput: jobInput({
        jobId: "job:backend-artifact-failed",
        artifactId: "artifact:backend-artifact-failed",
      }),
      now: "2026-07-02T10:25:00.000Z",
      renderArtifact: (request) => ({
        ok: false,
        status: "blocked",
        mediaType: null,
        bytes: null,
        rendererProfileId: request.job.profiles.rendererProfileId,
        productionFidelity: false,
        issues: [rendererIssue("renderer-blocked-for-test", "injected renderer blocked for backend evidence")],
      }),
    })

    expect(result).toMatchObject({
      status: "failed",
      job: {
        jobId: "job:backend-artifact-failed",
        status: "failed",
        revision: 1,
      },
      artifact: {
        artifactId: "artifact:backend-artifact-failed",
        status: "failed",
        byteLength: null,
        sha256: null,
        storageKey: null,
        revision: 2,
      },
      renderer: {
        status: "blocked",
        injected: true,
      },
      bytes: null,
      issues: [expect.objectContaining({ code: "renderer-blocked-for-test" })],
    })
    expect(result.records.map((entry) => [entry.kind, entry.revision, entry.artifactStatus, entry.jobStatus])).toEqual([
      ["artifact-manifest", 0, "planned", null],
      ["artifact-job", 0, null, "queued"],
      ["artifact-manifest", 1, "rendering", null],
      ["artifact-manifest", 2, "failed", null],
      ["artifact-job", 1, null, "failed"],
    ])

    const adapter = createFlowDocFileJsonStorageAdapter({ rootDirectory })
    await expect(adapter.artifactJobs.read({
      kind: "artifact-job",
      key: "job:backend-artifact-failed",
    })).resolves.toMatchObject({
      ok: true,
      record: {
        value: {
          status: "failed",
        },
      },
    })
    await expect(adapter.artifactManifests.read({
      kind: "artifact-manifest",
      key: "artifact:backend-artifact-failed",
    })).resolves.toMatchObject({
      ok: true,
      record: {
        value: {
          status: "failed",
        },
      },
    })
  })
})
