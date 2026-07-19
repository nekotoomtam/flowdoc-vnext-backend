import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import type {
  FlowDocBackendDocGenLocalArtifactMaterializerV1,
  FlowDocBackendDocGenLocalMaterializedArtifactV1,
  FlowDocBackendDocGenLocalMaterializationBlockedV1,
} from "./docGenLocalPdfExport.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_MATERIALIZER_ID =
  "flowdoc-backend-docgen-local-uat-materializer" as const
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_MATERIALIZER_VERSION = "1.0.0" as const
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_RENDERER_PROFILE_ID =
  "flowdoc-local-measured-document-v1" as const
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_MEASUREMENT_PROFILE_ID =
  "flowdoc-uat-local-measured-v1" as const

interface MaterializerProcessReadyV1 {
  status: "ready"
  materializationFingerprint: string
  resolutionFingerprint: string
  measuredPlanFingerprint: string
  measuredBundleFingerprint: string
  artifactInputFingerprint: string
  measuredDrawContract: unknown
  fontResources: Array<{
    fontId: string
    subsetId: string
    subsetPrefix: string
    postScriptName: string
    subsetSha256: string
    sourceBytesBase64: string
    subsetBytesBase64: string
  }>
  imageResources: Array<{ assetId: string; bytesBase64: string }>
  summary: {
    pageCount: number
    paintCommandCount: number
    glyphCount: number
    imageAssetCount: number
  }
  issues: []
}

type MaterializerProcessResultV1 = MaterializerProcessReadyV1 | FlowDocBackendDocGenLocalMaterializationBlockedV1

function implementationFingerprint(): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    materializerId: FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_MATERIALIZER_ID,
    version: FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_MATERIALIZER_VERSION,
    coreRuntime: "packages/uat-realdoc/local-runtime:v1",
    transport: "bounded-local-subprocess-json-v1",
    input: "backend-protected-canonical-record",
    output: "measured-draw-contract-and-digest-bound-resources",
    productionBinding: false,
  })).digest("hex")}`
}

function blocked(message: string): FlowDocBackendDocGenLocalMaterializationBlockedV1 {
  return {
    status: "blocked",
    materializationFingerprint: null,
    resolutionFingerprint: null,
    measuredPlanFingerprint: null,
    measuredBundleFingerprint: null,
    artifactInputFingerprint: null,
    measuredDrawContract: null,
    fontResources: null,
    imageResources: null,
    summary: null,
    issues: [{
      code: "docgen-local-uat-materializer-process-blocked",
      path: "materializer",
      message,
      severity: "error",
    }],
  }
}

export function createFlowDocBackendDocGenLocalUatArtifactMaterializerV1(input: {
  coreRoot: string
}): FlowDocBackendDocGenLocalArtifactMaterializerV1 {
  const coreRoot = realpathSync(resolve(input.coreRoot))
  const commandPath = resolve(
    coreRoot,
    "packages/uat-realdoc/local-runtime/materialize-docgen-local.mjs",
  )
  if (!existsSync(commandPath)) throw new Error("Core UAT local materializer command is unavailable")

  return {
    materializerId: FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_MATERIALIZER_ID,
    materializerVersion: FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_MATERIALIZER_VERSION,
    implementationFingerprint: implementationFingerprint(),
    rendererProfileId: FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_RENDERER_PROFILE_ID,
    measurementProfileId: FLOWDOC_BACKEND_DOCGEN_LOCAL_UAT_MEASUREMENT_PROFILE_ID,
    async materialize({ record, assets }) {
      const processResult = spawnSync(process.execPath, [commandPath], {
        cwd: coreRoot,
        input: JSON.stringify({
          canonicalInput: record.canonicalInput,
          canonicalInputFingerprint: record.receipt.canonicalInputFingerprint,
          publishedStructureFingerprint: record.receipt.dataContract.publishedStructureFingerprint,
          assets: assets.map((asset) => ({
            assetId: asset.definition.id,
            bytesBase64: Buffer.from(asset.bytes).toString("base64"),
          })),
        }),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 300_000,
        windowsHide: true,
      })
      if (processResult.status !== 0) return blocked("Core UAT local materializer process failed")
      let result: MaterializerProcessResultV1
      try {
        result = JSON.parse(processResult.stdout) as MaterializerProcessResultV1
      } catch {
        return blocked("Core UAT local materializer returned invalid JSON")
      }
      if (result.status === "blocked") return result
      return {
        status: "ready",
        materializationFingerprint: result.materializationFingerprint,
        resolutionFingerprint: result.resolutionFingerprint,
        measuredPlanFingerprint: result.measuredPlanFingerprint,
        measuredBundleFingerprint: result.measuredBundleFingerprint,
        artifactInputFingerprint: result.artifactInputFingerprint,
        measuredDrawContract: result.measuredDrawContract as FlowDocBackendDocGenLocalMaterializedArtifactV1[
          "measuredDrawContract"
        ],
        fontResources: result.fontResources.map((resource) => ({
          fontId: resource.fontId,
          subsetId: resource.subsetId,
          subsetPrefix: resource.subsetPrefix,
          postScriptName: resource.postScriptName,
          subsetSha256: resource.subsetSha256,
          sourceBytes: new Uint8Array(Buffer.from(resource.sourceBytesBase64, "base64")),
          subsetBytes: new Uint8Array(Buffer.from(resource.subsetBytesBase64, "base64")),
        })),
        imageResources: result.imageResources.map((resource) => ({
          assetId: resource.assetId,
          bytes: new Uint8Array(Buffer.from(resource.bytesBase64, "base64")),
        })),
        summary: result.summary,
        issues: [],
      }
    },
  }
}
