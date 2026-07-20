import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  createVNextPdfMeasuredDrawContractV1,
  type VNextPdfMeasuredDrawContractRequestV1,
} from "@flowdoc/vnext-core"
import thaiOnePageRequest from "@flowdoc/vnext-core/fixtures/pdf-pilot-thai-one-page-request.v1.json" with { type: "json" }
import type { FlowDocBackendDocGenLocalArtifactMaterializerV1 } from "../../index.js"

interface SubsetManifestV1 {
  subsetId: string
  fontId: string
  postScriptName: string
  subsetPrefix: string
  source: { path: string }
  subset: { path: string; sha256: string }
}

const CORE_ROOT = resolve(process.cwd(), "../flowdoc-vnext-core")

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(CORE_ROOT, path), "utf8")) as T
}

export function docGenLocalPdfMaterializer(
  onMaterialize?: () => void,
): FlowDocBackendDocGenLocalArtifactMaterializerV1 {
  const measuredRequest = structuredClone(thaiOnePageRequest) as VNextPdfMeasuredDrawContractRequestV1
  measuredRequest.rendererProfileId = "flowdoc-local-measured-document-v1"
  const measuredDrawContract = createVNextPdfMeasuredDrawContractV1(measuredRequest)
  if (measuredDrawContract.status !== "consumable") throw new Error(JSON.stringify(measuredDrawContract.issues))
  const manifest = readJson<SubsetManifestV1>(
    "packages/pdf-renderer-pilot/fixtures/font-subset-manifest.v1.json",
  )
  const sourceBytes = readFileSync(resolve(CORE_ROOT, manifest.source.path))
  const subsetBytes = readFileSync(resolve(CORE_ROOT, manifest.subset.path))
  const glyphCount = measuredDrawContract.pages.reduce((sum, page) => sum + page.commands.reduce(
    (pageSum, command) => pageSum + (command.kind === "glyph-run" ? command.glyphs.length : 0),
    0,
  ), 0)
  return {
    materializerId: "materializer:docgen-e4-test",
    materializerVersion: "1.0.0",
    implementationFingerprint: `sha256:${"6".repeat(64)}`,
    rendererProfileId: measuredDrawContract.rendererProfileId,
    measurementProfileId: measuredDrawContract.measurementProfileId,
    async materialize() {
      onMaterialize?.()
      return {
        status: "ready",
        materializationFingerprint: `sha256:${"1".repeat(64)}`,
        resolutionFingerprint: `sha256:${"2".repeat(64)}`,
        measuredPlanFingerprint: `sha256:${"3".repeat(64)}`,
        measuredBundleFingerprint: `sha256:${"4".repeat(64)}`,
        artifactInputFingerprint: `sha256:${"5".repeat(64)}`,
        measuredDrawContract: structuredClone(measuredDrawContract),
        fontResources: [{
          fontId: manifest.fontId,
          subsetId: manifest.subsetId,
          subsetPrefix: manifest.subsetPrefix,
          postScriptName: manifest.postScriptName,
          subsetSha256: manifest.subset.sha256,
          sourceBytes: new Uint8Array(sourceBytes),
          subsetBytes: new Uint8Array(subsetBytes),
        }],
        imageResources: [],
        summary: {
          pageCount: measuredDrawContract.summary.pageCount,
          paintCommandCount: measuredDrawContract.summary.paintCommandCount,
          glyphCount,
          imageAssetCount: 0,
        },
        issues: [],
      }
    },
  }
}
