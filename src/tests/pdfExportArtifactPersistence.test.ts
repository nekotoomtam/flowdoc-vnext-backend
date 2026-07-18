import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  persistFlowDocBackendPdfExportArtifactV1,
  reconcileFlowDocBackendPdfExportOrphanContentV1,
  type FlowDocBackendPdfExportContentAddressedStoreV1,
} from "../index.js"
import {
  createReadyPdfExportPersistenceFixture,
  pdfExportPersistenceInput,
} from "./helpers/pdfExportPersistenceFixture.js"

describe("PDF export artifact persistence", () => {
  const roots: string[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  function contentStore() {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-persistence-"))
    roots.push(root)
    return createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
  }

  it("persists only verified bytes, then atomically projects a rendered Core manifest and job", async () => {
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:success" })
    const store = contentStore()
    const repository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
    const result = await persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
      fixture,
      contentStore: store,
      persistenceRepository: repository,
    }))
    expect(result).toMatchObject({
      status: "persisted",
      orphanCandidateStorageKey: null,
      receipt: {
        operationId: fixture.fixture.operation.operationId,
        bytes: {
          readAfterWriteVerified: true,
          byteLength: fixture.rendererAttempt.bytes.byteLength,
          sha256: fixture.rendererAttempt.completion.artifact.sha256,
        },
        projection: {
          manifestRevision: 0,
          jobRevision: 0,
          manifest: { status: "rendered" },
          job: { status: "rendered" },
        },
        contracts: {
          atomicManifestJobCas: true,
          productionBinding: false,
        },
      },
      contracts: {
        backendRoute: false,
        authzExecution: false,
        productionBinding: false,
      },
    })
    if (result.status === "blocked") throw new Error(JSON.stringify(result.issues))
    expect(result.receipt.projection.job.artifactManifest).toEqual(result.receipt.projection.manifest)
    await expect(store.read({ storageKey: result.receipt.bytes.storageKey })).resolves.toMatchObject({
      status: "found",
      bytes: fixture.rendererAttempt.bytes,
    })
    await expect(repository.readByOperationId({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })).resolves.toMatchObject({
      status: "found",
      receipt: { persistenceReceiptFingerprint: result.receipt.persistenceReceiptFingerprint },
    })
  })

  it("returns one terminal owner and one exact replay under concurrent persistence", async () => {
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:concurrent" })
    const store = contentStore()
    const repository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
    const input = pdfExportPersistenceInput({ fixture, contentStore: store, persistenceRepository: repository })
    const results = await Promise.all([
      persistFlowDocBackendPdfExportArtifactV1(input),
      persistFlowDocBackendPdfExportArtifactV1(input),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["idempotent-replay", "persisted"])
    expect(results[0]!.receipt?.persistenceReceiptFingerprint).toBe(results[1]!.receipt?.persistenceReceiptFingerprint)
  })

  it("rejects reuse of a persistence identity across different operations", async () => {
    const firstFixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:identity:first" })
    const secondFixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:identity:second" })
    const store = contentStore()
    const repository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
    const persistenceId = "persistence:shared-identity"
    await expect(persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
      fixture: firstFixture,
      contentStore: store,
      persistenceRepository: repository,
      persistenceId,
      jobId: "job:persistence:identity:first",
    }))).resolves.toMatchObject({ status: "persisted" })
    await expect(persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
      fixture: secondFixture,
      contentStore: store,
      persistenceRepository: repository,
      persistenceId,
      jobId: "job:persistence:identity:second",
    }))).resolves.toMatchObject({
      status: "blocked",
      issues: [{ code: "pdf-export-persistence-cas-conflict" }],
    })
  })

  it("fails terminal replay when retained physical bytes are corrupt", async () => {
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:replay-corrupt" })
    const store = contentStore()
    const repository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
    const input = pdfExportPersistenceInput({ fixture, contentStore: store, persistenceRepository: repository })
    const persisted = await persistFlowDocBackendPdfExportArtifactV1(input)
    if (persisted.status === "blocked") throw new Error(JSON.stringify(persisted.issues))
    const retained = await store.read({ storageKey: persisted.receipt.bytes.storageKey })
    if (retained.status !== "found") throw new Error("retained replay fixture failed")
    await writeFile(retained.content.storageLocator, new TextEncoder().encode("corrupt-after-commit"))

    await expect(persistFlowDocBackendPdfExportArtifactV1(input)).resolves.toMatchObject({
      status: "blocked",
      receipt: { persistenceReceiptFingerprint: persisted.receipt.persistenceReceiptFingerprint },
      issues: [{ code: "pdf-export-content-stored-digest-mismatch" }],
    })
  })

  it("rejects mutated V-D evidence before writing bytes", async () => {
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:mutated" })
    const store = contentStore()
    const repository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
    const mutated = structuredClone(fixture.rendererAttempt)
    mutated.completion.artifact.sha256 = "0".repeat(64)
    const result = await persistFlowDocBackendPdfExportArtifactV1({
      ...pdfExportPersistenceInput({ fixture, contentStore: store, persistenceRepository: repository }),
      rendererAttempt: mutated,
    })
    expect(result).toMatchObject({
      status: "blocked",
      orphanCandidateStorageKey: null,
      issues: [{ code: "pdf-export-persistence-core-completion-invalid" }],
    })
    await expect(store.scan({
      modifiedBefore: "2026-07-18T10:00:00.000Z",
      maxScanCount: 10,
    })).resolves.toMatchObject({ status: "ready", scannedCount: 0 })
  })

  it("blocks when cancellation changes the durable head after V-D and before byte write", async () => {
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:lifecycle-drift" })
    const head = fixture.rendererAttempt.lifecycleHead
    if (head == null) throw new Error("ready renderer attempt must retain lifecycle head")
    await expect(fixture.lifecycleRepository.applyLifecycleTransition({
      transitionId: "transition:persistence:cancel-before-write",
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
      expectedHeadRevision: head.headRevision,
      transitionAt: "2026-07-18T09:00:05.100Z",
      kind: "request-cancellation",
    })).resolves.toMatchObject({ status: "applied" })
    const store = contentStore()
    const result = await persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
      fixture,
      contentStore: store,
      persistenceRepository: createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1(),
    }))
    expect(result).toMatchObject({
      status: "blocked",
      orphanCandidateStorageKey: null,
      issues: [{ code: "pdf-export-persistence-lifecycle-drift" }],
    })
  })

  it("reports an orphan candidate and commits no metadata when readback fails", async () => {
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:readback-fault" })
    const delegate = contentStore()
    const repository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
    const faulted: FlowDocBackendPdfExportContentAddressedStoreV1 = {
      source: delegate.source,
      write: (request) => delegate.write(request),
      read: async () => ({ status: "not-found", content: null, bytes: null, issues: [] }),
      scan: (request) => delegate.scan(request),
      delete: (request) => delegate.delete(request),
    }
    const result = await persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
      fixture,
      contentStore: faulted,
      persistenceRepository: repository,
    }))
    expect(result).toMatchObject({
      status: "blocked",
      orphanCandidateStorageKey: expect.stringMatching(/^pdf-export-v1\.sha256\./u),
      issues: [{ code: "pdf-export-persistence-readback-missing" }],
    })
    await expect(repository.readByOperationId({
      ...fixture.fixture.operation.scope,
      operationId: fixture.fixture.operation.operationId,
    })).resolves.toMatchObject({ status: "not-found" })
  })

  it("deletes only old unreferenced bytes and retains projected content", async () => {
    const fixture = await createReadyPdfExportPersistenceFixture({ operationId: "operation:persistence:orphan" })
    const store = contentStore()
    const repository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
    const persisted = await persistFlowDocBackendPdfExportArtifactV1(pdfExportPersistenceInput({
      fixture,
      contentStore: store,
      persistenceRepository: repository,
    }))
    if (persisted.status === "blocked") throw new Error(JSON.stringify(persisted.issues))
    const orphanBytes = new TextEncoder().encode("%PDF-1.7\norphan V-E content\n%%EOF\n")
    const orphanDigest = createHash("sha256").update(orphanBytes).digest("hex")
    const orphan = await store.write({
      bytes: orphanBytes,
      expectedSha256: orphanDigest,
      expectedByteLength: orphanBytes.byteLength,
    })
    if (orphan.content == null) throw new Error("orphan content fixture failed")
    const old = new Date("2026-07-18T08:00:00.000Z")
    const referenced = await store.read({ storageKey: persisted.receipt.bytes.storageKey })
    if (referenced.status !== "found") throw new Error("referenced content fixture failed")
    await utimes(referenced.content.storageLocator, old, old)
    await utimes(orphan.content.storageLocator, old, old)

    const reconciled = await reconcileFlowDocBackendPdfExportOrphanContentV1({
      now: "2026-07-18T10:00:00.000Z",
      gracePeriodMs: 60_000,
      maxScanCount: 10,
      maxDeleteCount: 1,
      contentStore: store,
      persistenceRepository: repository,
    })
    expect(reconciled).toMatchObject({
      status: "completed",
      candidateCount: 2,
      referencedCount: 1,
      deletedStorageKeys: [orphan.content.storageKey],
      retainedStorageKeys: [persisted.receipt.bytes.storageKey],
    })
    await expect(store.read({ storageKey: orphan.content.storageKey })).resolves.toMatchObject({ status: "not-found" })
    await expect(store.read({ storageKey: persisted.receipt.bytes.storageKey })).resolves.toMatchObject({ status: "found" })
  })

  it("keeps orphan cleanup policy bounded and rejects a zero-grace sweep", async () => {
    const result = await reconcileFlowDocBackendPdfExportOrphanContentV1({
      now: "2026-07-18T10:00:00.000Z",
      gracePeriodMs: 0,
      maxScanCount: 10,
      maxDeleteCount: 1,
      contentStore: contentStore(),
      persistenceRepository: createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1(),
    })
    expect(result).toMatchObject({
      status: "blocked",
      scannedCount: 0,
      issues: [{ code: "pdf-export-orphan-policy-invalid" }],
    })
  })
})
