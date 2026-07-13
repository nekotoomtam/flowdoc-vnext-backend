import { finalizeVNextDocumentCompositionManifestV1 } from "@flowdoc/vnext-core"
import { describe, expect, it } from "vitest"
import {
  compositionFingerprint,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  initializeFlowDocBackendCompositionV1,
} from "../index.js"
import { createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })

function inputFor(manifest: ReturnType<typeof createCompositionSchedulerFixture>["manifest"], overrides: {
  jobId?: string
  requestId?: string
  baseRevision?: number
  currentRevision?: number
  maximumClosedPageCount?: number
} = {}) {
  const packageFingerprint = fp(`package:${overrides.jobId ?? "initialization"}`)
  return {
    request: {
      requestId: overrides.requestId ?? "initialization-request",
      jobId: overrides.jobId ?? "initialization-job",
      documentId: manifest.documentId,
      baseRevision: overrides.baseRevision ?? 7,
      profiles: {
        layoutProfileId: "layout-profile-v1",
        measurementProfileId: "measurement-profile-v1",
        compositionProfileId: "composition-profile-v1",
      },
      transitionLimits: {
        maximumClosedPageCount: overrides.maximumClosedPageCount ?? 4,
        maximumPlacementCount: 20,
        maximumFamilyPageCount: 4,
        maximumFamilyFragmentCount: 20,
      },
      executionLimits: {
        maximumTransitionCount: 100,
        maximumAttemptCount: 200,
        maximumRetainedByteCount: 10_000_000,
      },
      createdAt: "2026-07-13T08:00:00.000Z",
      expiresAt: "2026-07-14T08:00:00.000Z",
    },
    source: {
      currentRevision: overrides.currentRevision ?? 7,
      packageFingerprint,
      resolvedProjectionFingerprint: manifest.resolvedProjectionFingerprint,
      sourceSnapshot: {
        kind: "composition-source-snapshot",
        documentId: manifest.documentId,
        fingerprint: packageFingerprint,
      },
      manifest,
    },
  }
}

function emptyManifest(sectionCount: number) {
  const base = createCompositionSchedulerFixture().manifest
  const result = finalizeVNextDocumentCompositionManifestV1({
    source: base.source,
    contractVersion: base.contractVersion,
    kind: base.kind,
    documentId: `empty-composition-${sectionCount}`,
    documentStructureFingerprint: fp(`empty-structure:${sectionCount}`),
    resolvedProjectionFingerprint: fp(`empty-projection:${sectionCount}`),
    sections: Array.from({ length: sectionCount }, (_, sectionIndex) => ({
      ...base.sections[0],
      sectionIndex,
      sectionId: `section-${sectionIndex}`,
    })),
    bodyItems: [],
    limits: base.limits,
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.manifest
}

describe("durable composition scheduler initialization", () => {
  it("pins source, initializes core demand, stages immutable owners, and replays exactly", async () => {
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const manifest = createCompositionSchedulerFixture().manifest
    const input = inputFor(manifest)
    const first = await initializeFlowDocBackendCompositionV1({ repository, ...input })
    expect(first).toMatchObject({
      status: "ready",
      jobHead: { status: "waiting-window", headRevision: 0, transitionNumber: 0 },
    })
    const replay = await initializeFlowDocBackendCompositionV1({ repository, ...input })
    expect(replay).toMatchObject({
      status: "idempotent-replay",
      requestFingerprint: first.requestFingerprint,
      jobHead: first.jobHead,
    })
    if (first.status !== "ready") throw new Error("initialization blocked")
    await expect(repository.readImmutable({
      jobId: first.sourcePin.jobId,
      recordId: first.sourcePin.sourceSnapshotRef.recordId,
    })).resolves.toMatchObject({ status: "found" })
    await expect(repository.readImmutable({
      jobId: first.sourcePin.jobId,
      recordId: first.sourcePin.manifestRef.recordId,
    })).resolves.toMatchObject({ status: "found" })
  })

  it("rejects stale revision before retaining source or creating a head", async () => {
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const manifest = createCompositionSchedulerFixture().manifest
    const input = inputFor(manifest, { jobId: "stale-job", currentRevision: 8 })
    await expect(initializeFlowDocBackendCompositionV1({ repository, ...input })).resolves.toMatchObject({
      status: "stale",
      issues: [expect.objectContaining({ code: "composition-source-revision-stale" })],
    })
    await expect(repository.readHead("stale-job")).resolves.toMatchObject({ status: "not-found" })
    await expect(repository.readImmutable({ jobId: "stale-job", recordId: "stale-job:source" })).resolves.toMatchObject({
      status: "not-found",
    })
  })

  it("retains initialization pages for an empty document without a fake transition receipt", async () => {
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const manifest = emptyManifest(1)
    const result = await initializeFlowDocBackendCompositionV1({
      repository,
      ...inputFor(manifest, { jobId: "empty-job" }),
    })
    expect(result).toMatchObject({
      status: "ready",
      jobHead: {
        status: "ready-to-finalize",
        transitionNumber: 0,
        chain: {
          transitionReceiptTipFingerprint: null,
          pageCount: 1,
        },
      },
    })
    if (result.status !== "ready") throw new Error("empty initialization blocked")
    expect(result.jobHead.chain.closedPageChunkTipFingerprint).not.toBeNull()
    expect(result.jobHead.chain.closedPagePrefixFingerprint).toBe(result.jobHead.cursor.closedPrefix.fingerprint)
    await expect(repository.readImmutable({ jobId: "empty-job", recordId: "empty-job:chunk:0" })).resolves.toMatchObject({
      status: "found",
      value: { transitionNumber: 0, windowRef: null },
    })
  })

  it("preserves demand-free initialization output-limit as ready-to-advance", async () => {
    const repository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const manifest = emptyManifest(2)
    await expect(initializeFlowDocBackendCompositionV1({
      repository,
      ...inputFor(manifest, { jobId: "initial-output-limit", maximumClosedPageCount: 1 }),
    })).resolves.toMatchObject({
      status: "ready",
      jobHead: {
        status: "ready-to-advance",
        demand: null,
        cursor: { complete: false, activeRoot: null, closedPrefix: { pageCount: 1 } },
      },
    })
  })
})
