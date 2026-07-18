import { createHash } from "node:crypto"
import type { VNextPdfExportRendererInputV1 } from "@flowdoc/vnext-core"
import type {
  FlowDocBackendPdfExportRendererCheckpointInputV1,
  FlowDocBackendPdfExportRendererResultV1,
  FlowDocBackendPdfExportRendererV1,
} from "./pdfExportRendererAttempt.js"

export const FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_V1_SOURCE =
  "flowdoc-backend-local-pdf-renderer" as const
export const FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_V1_VERSION = "1.0.0" as const
export const FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_DEFAULT_CHECKPOINT_INTERVAL = 64

export type FlowDocBackendLocalPdfRendererProfileV1 =
  | "thai-one-page"
  | "canonical-full-document"

export interface FlowDocBackendLocalPdfRendererIssueV1 {
  code: string
  path: string
  message: string
}

export interface FlowDocBackendLocalPdfRendererFontResourceV1 {
  fontId: string
  subsetId: string
  subsetPrefix: string
  postScriptName: string
  subsetSha256: string
  sourceBytes: Uint8Array
  subsetBytes: Uint8Array
}

export interface FlowDocBackendLocalPdfRendererImageResourceV1 {
  assetId: string
  bytes: Uint8Array
}

export type FlowDocBackendLocalPdfRendererResourceResolutionV1 =
  | {
      status: "ready"
      fontResources: FlowDocBackendLocalPdfRendererFontResourceV1[]
      imageResources: FlowDocBackendLocalPdfRendererImageResourceV1[]
      issues: []
    }
  | {
      status: "blocked" | "unavailable"
      fontResources: null
      imageResources: null
      issues: FlowDocBackendLocalPdfRendererIssueV1[]
    }

export interface FlowDocBackendLocalPdfRendererResourceResolverV1 {
  resolve(input: {
    profile: FlowDocBackendLocalPdfRendererProfileV1
    rendererInput: VNextPdfExportRendererInputV1
  }): Promise<FlowDocBackendLocalPdfRendererResourceResolutionV1>
}

export interface FlowDocBackendLocalPdfRendererOptionsV1 {
  profile: FlowDocBackendLocalPdfRendererProfileV1
  resourceResolver: FlowDocBackendLocalPdfRendererResourceResolverV1
  checkpointEveryPaintCommands?: number
}

export interface FlowDocBackendLocalPdfRendererV1 extends FlowDocBackendPdfExportRendererV1 {
  local: {
    source: typeof FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_V1_SOURCE
    profile: FlowDocBackendLocalPdfRendererProfileV1
    checkpointEveryPaintCommands: number
    canonicalEvidenceOnly: boolean
    fileWrites: false
    storageWrites: false
    concreteProductionRendererSelected: false
    productionBinding: false
  }
}

interface LocalPilotRenderedResultV1 {
  status: "rendered"
  bytes: Uint8Array
  artifact: {
    artifactId: string
    format: "pdf"
    mediaType: "application/pdf"
    byteLength: number
    sha256: string
    rendererProfileId: string
    measurementProfileId: string
  }
  summary: { pageCount: number }
  issues: []
}

type LocalPilotControlledResultV1 =
  | LocalPilotRenderedResultV1
  | {
      status: "blocked"
      bytes: null
      artifact: null
      issues: FlowDocBackendLocalPdfRendererIssueV1[]
    }
  | {
      status: "cancelled"
      bytes: null
      artifact: null
      issues: []
    }

interface LocalPilotModuleV1 {
  renderFlowDocCanonicalFullDocumentPdfPilotControlled(
    input: LocalPilotRenderInputV1,
    options: LocalPilotRenderOptionsV1,
  ): Promise<LocalPilotControlledResultV1>
  renderFlowDocThaiOnePagePdfPilotControlled(
    input: LocalPilotRenderInputV1,
    options: LocalPilotRenderOptionsV1,
  ): Promise<LocalPilotControlledResultV1>
}

interface LocalPilotRenderInputV1 {
  proofId: string
  artifactId: string
  contract: VNextPdfExportRendererInputV1["measuredDrawContract"]
  fontResources: FlowDocBackendLocalPdfRendererFontResourceV1[]
  imageResources: FlowDocBackendLocalPdfRendererImageResourceV1[]
}

interface LocalPilotRenderOptionsV1 {
  checkpointEveryPaintCommands: number
  control: {
    checkpoint(input: {
      paintCommandIndex: number
      totalPaintCommandCount: number
    }): Promise<{ status: "continue" } | { status: "cancel" }>
  }
}

async function loadLocalPilotModuleV1(): Promise<LocalPilotModuleV1> {
  const localPackageName: string = "@flowdoc/pdf-renderer-pilot/renderer"
  return await import(localPackageName) as unknown as LocalPilotModuleV1
}

function implementationFingerprint(input: {
  profile: FlowDocBackendLocalPdfRendererProfileV1
  checkpointEveryPaintCommands: number
}): string {
  const payload = JSON.stringify({
    source: FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_V1_SOURCE,
    version: FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_V1_VERSION,
    profile: input.profile,
    checkpointEveryPaintCommands: input.checkpointEveryPaintCommands,
    renderer: "flowdoc-pdf-renderer-pilot-controlled:v1",
    cooperativeCancellation: true,
    productionBinding: false,
  })
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`
}

function blocked(issues: FlowDocBackendLocalPdfRendererIssueV1[]): FlowDocBackendPdfExportRendererResultV1 {
  return {
    status: "blocked",
    bytes: null,
    renderEvidence: null,
    issues,
  }
}

export function createFlowDocBackendLocalPdfRendererV1(
  options: FlowDocBackendLocalPdfRendererOptionsV1,
): FlowDocBackendLocalPdfRendererV1 {
  const checkpointEveryPaintCommands = options.checkpointEveryPaintCommands
    ?? FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_DEFAULT_CHECKPOINT_INTERVAL
  if (
    !Number.isSafeInteger(checkpointEveryPaintCommands)
    || checkpointEveryPaintCommands <= 0
    || checkpointEveryPaintCommands > 10_000
  ) throw new Error("local PDF renderer checkpoint interval must be an integer from 1 through 10000")

  const adapterId = `${FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_V1_SOURCE}:${options.profile}`
  const fingerprint = implementationFingerprint({
    profile: options.profile,
    checkpointEveryPaintCommands,
  })

  return {
    adapterId,
    adapterVersion: FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_V1_VERSION,
    implementationFingerprint: fingerprint,
    local: {
      source: FLOWDOC_BACKEND_LOCAL_PDF_RENDERER_V1_SOURCE,
      profile: options.profile,
      checkpointEveryPaintCommands,
      canonicalEvidenceOnly: options.profile === "canonical-full-document",
      fileWrites: false,
      storageWrites: false,
      concreteProductionRendererSelected: false,
      productionBinding: false,
    },
    async render({ rendererInput, control }) {
      let resources: FlowDocBackendLocalPdfRendererResourceResolutionV1
      try {
        resources = await options.resourceResolver.resolve({
          profile: options.profile,
          rendererInput,
        })
      } catch (error) {
        return blocked([{
          code: "local-pdf-renderer-resource-resolver-threw",
          path: "resourceResolver.resolve",
          message: error instanceof Error ? error.message : "local renderer resource resolver threw",
        }])
      }
      if (resources.status !== "ready") return blocked(resources.issues.length > 0
        ? resources.issues
        : [{
            code: resources.status === "unavailable"
              ? "local-pdf-renderer-resources-unavailable"
              : "local-pdf-renderer-resources-blocked",
            path: "resourceResolver",
            message: "local renderer resources were not resolved",
          }])

      const renderInput = {
        proofId: rendererInput.exportRequestId,
        artifactId: rendererInput.artifactId,
        contract: rendererInput.measuredDrawContract,
        fontResources: resources.fontResources,
        imageResources: resources.imageResources,
      }
      const renderOptions = {
        checkpointEveryPaintCommands,
        control: {
          checkpoint: (checkpoint: FlowDocBackendPdfExportRendererCheckpointInputV1) =>
            control.checkpoint(checkpoint),
        },
      }
      let pilot: LocalPilotModuleV1
      try {
        pilot = await loadLocalPilotModuleV1()
      } catch (error) {
        return blocked([{
          code: "local-pdf-renderer-module-unavailable",
          path: "rendererModule",
          message: error instanceof Error ? error.message : "local renderer module is unavailable",
        }])
      }
      const result = options.profile === "canonical-full-document"
        ? await pilot.renderFlowDocCanonicalFullDocumentPdfPilotControlled(renderInput, renderOptions)
        : await pilot.renderFlowDocThaiOnePagePdfPilotControlled(renderInput, renderOptions)
      if (result.status === "cancelled") return {
        status: "cancelled",
        bytes: null,
        renderEvidence: null,
        issues: [],
      }
      if (result.status === "blocked") return blocked(result.issues.map((issue) => ({
        code: issue.code,
        path: `pilot.${issue.path}`,
        message: issue.message,
      })))

      return {
        status: "rendered",
        bytes: result.bytes,
        renderEvidence: {
          status: "rendered",
          artifactId: result.artifact.artifactId,
          format: result.artifact.format,
          mediaType: result.artifact.mediaType,
          byteLength: result.artifact.byteLength,
          sha256: result.artifact.sha256,
          pageCount: result.summary.pageCount,
          rendererProfileId: result.artifact.rendererProfileId,
          measurementProfileId: result.artifact.measurementProfileId,
          sourceContractFingerprint: rendererInput.sourceContractFingerprint,
          sourceContractContentFingerprint: rendererInput.sourceContractContentFingerprint,
        },
        issues: [],
      }
    },
  }
}
