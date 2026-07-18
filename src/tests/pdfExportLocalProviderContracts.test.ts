import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  createFlowDocBackendPdfExportLocalPostgresPoolV1,
  ensureFlowDocBackendPdfExportLocalS3BucketV1,
  reconcileFlowDocBackendPdfExportResumableOrphanContentV1,
  type FlowDocBackendPdfExportContentCandidateV1,
  type FlowDocBackendPdfExportResumableContentAddressedStoreV1,
} from "../index.js"

function candidate(storageKey: string, modifiedAt: string): FlowDocBackendPdfExportContentCandidateV1 {
  const match = /^pdf-export-v1\.sha256\.([a-f0-9]{64})\.pdf$/u.exec(storageKey)
  if (match == null) throw new Error("candidate storage key fixture is invalid")
  return {
    storageKey,
    sha256: match[1]!,
    byteLength: 32,
    modifiedAt,
    storageLocator: `fake://${storageKey}`,
  }
}

function key(value: string): string {
  return `pdf-export-v1.sha256.${createHash("sha256").update(value).digest("hex")}.pdf`
}

describe("PDF export LOCAL-C provider contracts", () => {
  it("rejects non-loopback PostgreSQL targets before opening a provider pool", async () => {
    await expect(createFlowDocBackendPdfExportLocalPostgresPoolV1({
      runtimeProfile: "local-integration",
      connectionString: "postgresql://flowdoc:secret@database.example.com/flowdoc",
    })).rejects.toThrow("loopback")
  })

  it("rejects non-loopback S3 endpoints before opening a provider client", async () => {
    await expect(ensureFlowDocBackendPdfExportLocalS3BucketV1({
      runtimeProfile: "local-integration",
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "flowdoc-pdf-local",
      accessKeyId: "local-access-key",
      secretAccessKey: "local-secret-key",
    })).rejects.toThrow("loopback")
  })

  it("advances a resumable orphan cursor instead of rescanning the first prefix", async () => {
    const firstKey = key("first")
    const secondKey = key("second")
    const calls: Array<string | null> = []
    const deleted: string[] = []
    const pages = new Map<string | null, {
      candidate: FlowDocBackendPdfExportContentCandidateV1
      nextCursor: string | null
    }>([
      [null, { candidate: candidate(firstKey, "2026-07-18T08:00:00.000Z"), nextCursor: "cursor:second" }],
      ["cursor:second", { candidate: candidate(secondKey, "2026-07-18T08:00:01.000Z"), nextCursor: null }],
    ])
    const store: FlowDocBackendPdfExportResumableContentAddressedStoreV1 = {
      source: "flowdoc-backend-pdf-export-content-store",
      async write() {
        throw new Error("not used")
      },
      async read() {
        throw new Error("not used")
      },
      async scan() {
        throw new Error("not used")
      },
      async scanPage(input) {
        calls.push(input.cursor)
        const page = pages.get(input.cursor)
        if (page == null) return {
          status: "invalid",
          candidates: [],
          scannedCount: 0,
          truncated: false,
          nextCursor: null,
          issues: [],
        }
        return {
          status: "ready",
          candidates: [page.candidate],
          scannedCount: 1,
          truncated: page.nextCursor != null,
          nextCursor: page.nextCursor,
          issues: [],
        }
      },
      async delete(input) {
        deleted.push(input.storageKey)
        return { status: "deleted", issues: [] }
      },
    }
    const persistenceRepository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
    const first = await reconcileFlowDocBackendPdfExportResumableOrphanContentV1({
      now: "2026-07-18T10:00:00.000Z",
      gracePeriodMs: 60_000,
      maxScanCount: 1,
      maxDeleteCount: 1,
      cursor: null,
      contentStore: store,
      persistenceRepository,
    })
    const second = await reconcileFlowDocBackendPdfExportResumableOrphanContentV1({
      now: "2026-07-18T10:00:00.000Z",
      gracePeriodMs: 60_000,
      maxScanCount: 1,
      maxDeleteCount: 1,
      cursor: first.nextCursor,
      contentStore: store,
      persistenceRepository,
    })

    expect(first).toMatchObject({
      status: "completed",
      inputCursor: null,
      nextCursor: "cursor:second",
      deletedStorageKeys: [firstKey],
    })
    expect(second).toMatchObject({
      status: "completed",
      inputCursor: "cursor:second",
      nextCursor: null,
      deletedStorageKeys: [secondKey],
    })
    expect(calls).toEqual([null, "cursor:second"])
    expect(deleted).toEqual([firstKey, secondKey])
  })
})
