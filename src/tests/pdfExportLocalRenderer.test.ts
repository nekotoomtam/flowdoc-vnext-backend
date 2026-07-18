import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  createVNextPdfExportHandoffV1,
  type VNextPdfExportRendererInputV1,
} from "@flowdoc/vnext-core"
import {
  createFlowDocBackendLocalPdfRendererV1,
  createFlowDocBackendPdfExportRendererQualificationV1,
  createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1,
  flowDocBackendPdfExportCurrentRuntimeIdentityV1,
  runFlowDocBackendPdfExportRendererAttemptV1,
  type FlowDocBackendLocalPdfRendererResourceResolverV1,
  type FlowDocBackendLocalPdfRendererV1,
} from "../index.js"
import {
  createPdfExportRendererFixture,
  preparePdfExportRendererLifecycle,
  rendererAttemptInput,
} from "./helpers/pdfExportRendererFixture.js"

interface SubsetManifest {
  subsetId: string
  fontId: string
  postScriptName: string
  subsetPrefix: string
  source: { path: string }
  subset: { path: string; sha256: string }
}

const CORE_ROOT = resolve(process.cwd(), "../flowdoc-vnext-core")
const CANONICAL_REPORT_ROOT = resolve(
  process.env.FLOWDOC_PDF_PILOT_REPORT_ROOT
    ?? "../ocr-benchmark-skeleton/reports/INV_9437125258",
)
const CANONICAL_IMAGE_FILES = [
  ["source-evidence-image", "source_evidence.png"],
  ["ocr-accuracy-image", "ocr_accuracy.png"],
  ["native-extraction-image", "native_extraction.png"],
  ["latency-rounds-image", "latency_rounds.png"],
  ["mapping-gap-image", "mapping_gap.png"],
] as const
const CANONICAL_RESOURCES_AVAILABLE = CANONICAL_IMAGE_FILES.every(([, fileName]) => (
  existsSync(resolve(CANONICAL_REPORT_ROOT, "assets", fileName))
))

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(CORE_ROOT, path), "utf8")) as T
}

function readyResourceResolver(): FlowDocBackendLocalPdfRendererResourceResolverV1 {
  const manifest = readJson<SubsetManifest>(
    "packages/pdf-renderer-pilot/fixtures/font-subset-manifest.v1.json",
  )
  return {
    async resolve() {
      return {
        status: "ready",
        fontResources: [{
          fontId: manifest.fontId,
          subsetId: manifest.subsetId,
          subsetPrefix: manifest.subsetPrefix,
          postScriptName: manifest.postScriptName,
          subsetSha256: manifest.subset.sha256,
          sourceBytes: readFileSync(resolve(CORE_ROOT, manifest.source.path)),
          subsetBytes: readFileSync(resolve(CORE_ROOT, manifest.subset.path)),
        }],
        imageResources: [],
        issues: [],
      }
    },
  }
}

function localRenderer(
  resourceResolver: FlowDocBackendLocalPdfRendererResourceResolverV1 = readyResourceResolver(),
): FlowDocBackendLocalPdfRendererV1 {
  return createFlowDocBackendLocalPdfRendererV1({
    profile: "thai-one-page",
    resourceResolver,
    checkpointEveryPaintCommands: 2,
  })
}

function handoff() {
  const fixture = createPdfExportRendererFixture()
  const result = createVNextPdfExportHandoffV1({
    request: fixture.request,
    currentSource: fixture.currentSource,
    measuredDrawContract: fixture.measuredDrawContract,
  })
  if (result.status !== "ready") throw new Error(JSON.stringify(result.issues))
  return { fixture, rendererInput: result.rendererInput }
}

function qualification(
  renderer: FlowDocBackendLocalPdfRendererV1,
  fixture: ReturnType<typeof createPdfExportRendererFixture>,
) {
  const result = createFlowDocBackendPdfExportRendererQualificationV1({
    qualificationId: "qualification:pdf-export-local-b:one-page",
    adapterId: renderer.adapterId,
    adapterVersion: renderer.adapterVersion,
    implementationFingerprint: renderer.implementationFingerprint,
    rendererProfileId: fixture.measuredDrawContract.rendererProfileId,
    measurementProfileId: fixture.measuredDrawContract.measurementProfileId,
    runtime: flowDocBackendPdfExportCurrentRuntimeIdentityV1(),
    maximumPaintCommandsBetweenChecks: 2,
    minimumCheckpointCount: 3,
    suiteFingerprint: `sha256:${"a".repeat(64)}`,
    qualifiedAt: "2026-07-18T10:00:00.000Z",
  })
  if (result.status !== "ready") throw new Error(JSON.stringify(result.issues))
  return result.qualification
}

describe("PDF-EXPORT-LOCAL-B local renderer adapter", () => {
  it("renders deterministic pilot bytes through the generic Backend SPI", async () => {
    const input = handoff()
    const renderer = localRenderer()
    const checkpoints: number[][] = []
    const render = async () => {
      const current: number[] = []
      checkpoints.push(current)
      return await renderer.render({
        rendererInput: input.rendererInput,
        control: {
          async checkpoint(checkpoint) {
            current.push(checkpoint.paintCommandIndex)
            expect(checkpoint.totalPaintCommandCount).toBe(4)
            return { status: "continue" }
          },
        },
      })
    }

    const first = await render()
    const second = await render()
    expect(first.status).toBe("rendered")
    expect(second.status).toBe("rendered")
    if (first.status !== "rendered" || second.status !== "rendered") {
      throw new Error("local renderer must produce deterministic bytes")
    }
    expect(checkpoints).toEqual([[0, 2, 4], [0, 2, 4]])
    expect(second.bytes).toEqual(first.bytes)
    expect(second.renderEvidence).toEqual(first.renderEvidence)
    expect(renderer.local).toMatchObject({
      profile: "thai-one-page",
      checkpointEveryPaintCommands: 2,
      fileWrites: false,
      storageWrites: false,
      concreteProductionRendererSelected: false,
      productionBinding: false,
    })
  })

  it("returns cooperative cancellation without bytes or partial evidence", async () => {
    const input = handoff()
    const checkpoints: number[] = []
    const result = await localRenderer().render({
      rendererInput: input.rendererInput,
      control: {
        async checkpoint(checkpoint) {
          checkpoints.push(checkpoint.paintCommandIndex)
          return checkpoint.paintCommandIndex >= 2
            ? { status: "cancel", reason: "cancellation-requested" }
            : { status: "continue" }
        },
      },
    })

    expect(checkpoints).toEqual([0, 2])
    expect(result).toEqual({
      status: "cancelled",
      bytes: null,
      renderEvidence: null,
      issues: [],
    })
  })

  it("fails closed when trusted renderer resources are unavailable or throw", async () => {
    const input = handoff()
    const unavailable = localRenderer({
      async resolve() {
        return {
          status: "unavailable",
          fontResources: null,
          imageResources: null,
          issues: [{
            code: "font-store-unavailable",
            path: "fontResources",
            message: "font resource store is unavailable",
          }],
        }
      },
    })
    const unavailableResult = await unavailable.render({
      rendererInput: input.rendererInput,
      control: { async checkpoint() { return { status: "continue" } } },
    })
    expect(unavailableResult).toMatchObject({
      status: "blocked",
      bytes: null,
      renderEvidence: null,
      issues: [expect.objectContaining({ code: "font-store-unavailable" })],
    })

    const throwing = localRenderer({ async resolve() { throw new Error("resource read failed") } })
    const throwingResult = await throwing.render({
      rendererInput: input.rendererInput,
      control: { async checkpoint() { return { status: "continue" } } },
    })
    expect(throwingResult).toMatchObject({
      status: "blocked",
      bytes: null,
      renderEvidence: null,
      issues: [expect.objectContaining({
        code: "local-pdf-renderer-resource-resolver-threw",
        message: "resource read failed",
      })],
    })
  })

  it("passes V-D lifecycle, qualification, receipt, and completion validation", async () => {
    const fixture = createPdfExportRendererFixture()
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    await preparePdfExportRendererLifecycle({ repository, fixture })
    const renderer = localRenderer()
    const result = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
      fixture,
      repository,
      renderer,
      qualification: qualification(renderer, fixture),
    }))

    expect(result).toMatchObject({
      status: "ready-for-persistence",
      renderer: {
        adapterId: renderer.adapterId,
        adapterVersion: renderer.adapterVersion,
        implementationFingerprint: renderer.implementationFingerprint,
        status: "rendered",
        checkpointCount: 3,
        maximumObservedPaintCommandGap: 2,
      },
      contracts: {
        exactCoreHandoff: true,
        exactCoreReceipt: true,
        exactCoreRenderCompletion: true,
        cooperativeCancellation: true,
        concreteProductionRendererSelected: false,
        productionBinding: false,
      },
      issues: [],
    })
  })

  ;(CANONICAL_RESOURCES_AVAILABLE ? it : it.skip)(
    "retains exact canonical 13-page bytes with bounded local checkpoints",
    async () => {
      const bundle = readJson<any>("fixtures/pdf-pilot-canonical-report-body-display-list.v1.json")
      const contract = bundle.rendererHandoff.measuredDrawContract
      const manifests = [
        readJson<SubsetManifest>(
          "packages/pdf-renderer-pilot/fixtures/canonical-full-document-regular-font-subset-manifest.v1.json",
        ),
        readJson<SubsetManifest>(
          "packages/pdf-renderer-pilot/fixtures/canonical-full-document-bold-font-subset-manifest.v1.json",
        ),
      ]
      const renderer = createFlowDocBackendLocalPdfRendererV1({
        profile: "canonical-full-document",
        checkpointEveryPaintCommands: 64,
        resourceResolver: {
          async resolve() {
            return {
              status: "ready",
              fontResources: manifests.map((manifest) => ({
                fontId: manifest.fontId,
                subsetId: manifest.subsetId,
                subsetPrefix: manifest.subsetPrefix,
                postScriptName: manifest.postScriptName,
                subsetSha256: manifest.subset.sha256,
                sourceBytes: readFileSync(resolve(CORE_ROOT, manifest.source.path)),
                subsetBytes: readFileSync(resolve(CORE_ROOT, manifest.subset.path)),
              })),
              imageResources: CANONICAL_IMAGE_FILES.map(([assetId, fileName]) => ({
                assetId,
                bytes: readFileSync(resolve(CANONICAL_REPORT_ROOT, "assets", fileName)),
              })),
              issues: [],
            }
          },
        },
      })
      const rendererInput: VNextPdfExportRendererInputV1 = {
        exportRequestId: "export:pdf-export-local-b:canonical",
        artifactId: "artifact:pdf-export-local-b:canonical",
        measuredDrawContract: contract,
        sourceContractFingerprint: contract.fingerprint,
        sourceContractContentFingerprint: contract.contentFingerprint,
      }
      const checkpoints: number[] = []
      const result = await renderer.render({
        rendererInput,
        control: {
          async checkpoint(checkpoint) {
            checkpoints.push(checkpoint.paintCommandIndex)
            expect(checkpoint.totalPaintCommandCount).toBe(1814)
            return { status: "continue" }
          },
        },
      })

      expect(result).toMatchObject({
        status: "rendered",
        renderEvidence: {
          artifactId: rendererInput.artifactId,
          pageCount: 13,
          byteLength: 1_212_656,
          sha256: "c4d09f0dfd66e1e3983bc679602fdc7d397de30edcb4f93fac3a0fa0c422960b",
        },
        issues: [],
      })
      expect(checkpoints[0]).toBe(0)
      expect(checkpoints.at(-1)).toBe(1814)
      expect(checkpoints).toHaveLength(30)
      expect(checkpoints.slice(1).every((value, index) => value - checkpoints[index]! <= 64)).toBe(true)
      expect(renderer.local).toMatchObject({
        profile: "canonical-full-document",
        canonicalEvidenceOnly: true,
        concreteProductionRendererSelected: false,
        productionBinding: false,
      })
    },
    20_000,
  )

  it("rejects an invalid local checkpoint interval before creating an adapter", () => {
    expect(() => createFlowDocBackendLocalPdfRendererV1({
      profile: "thai-one-page",
      resourceResolver: readyResourceResolver(),
      checkpointEveryPaintCommands: 0,
    })).toThrow("checkpoint interval")
  })
})
