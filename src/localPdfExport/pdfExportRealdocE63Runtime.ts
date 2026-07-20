import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import type { ImageAssetRegistryV1 } from "@flowdoc/vnext-core"
import { createVNextDraftStructurePreviewSnapshotV1 } from "@flowdoc/vnext-core"
import {
  createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1,
  createFlowDocBackendDocGenLocalAdmissionServiceV1,
  createFlowDocBackendDocGenTrustedStructureRegistryV1,
} from "../docgen/docGenLocalAdmission.js"
import {
  createFlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1,
  createFlowDocBackendDocGenLocalDraftPreviewRegistryV1,
} from "../docgen/docGenLocalDraftPreview.js"
import { createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1 } from "../docgen/docGenLocalDurablePdfExport.js"
import {
  createFlowDocBackendDocGenLocalDurablePdfExportRuntimeV1,
  type FlowDocBackendDocGenLocalDurablePdfExportRuntimeV1,
} from "../docgen/docGenLocalDurablePdfExportRuntime.js"
import { createFlowDocBackendDocGenLocalArtifactBindingV1 } from "../docgen/docGenLocalPdfExport.js"
import { createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1 } from "../docgen/docGenLocalPublishedPreview.js"
import { createFlowDocBackendDocGenLocalUatArtifactMaterializerV1 } from "../docgen/docGenLocalUatArtifact.js"
import type { FlowDocBackendPdfExportAuthenticatedIdentityV1 } from "../pdfExport/pdfExportRoute.js"
import {
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
  createFlowDocBackendRealdocE56UatMapperV1,
  prepareFlowDocBackendRealdocE56InputV1,
  type FlowDocBackendRealdocE56PreparedInputV1,
} from "./pdfExportRealdocE56Runtime.js"

export const FLOWDOC_BACKEND_REALDOC_E63_DURABLE_RUNTIME_V1_SOURCE =
  "flowdoc-backend-realdoc-e63-durable-runtime" as const

export interface FlowDocBackendRealdocE63DurableRuntimeV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_REALDOC_E63_DURABLE_RUNTIME_V1_SOURCE
    phaseId: "PDF-EXPORT-REALDOC-E.6.3"
    durablePersistence: true
    explicitRequestReplayResume: true
    automaticStartupDiscovery: false
    browserReconnectSupported: true
    defaultApplicationServerMounted: false
    productionBinding: false
  }
  prepared: FlowDocBackendRealdocE56PreparedInputV1
  origin(): string | null
  start(): ReturnType<FlowDocBackendDocGenLocalDurablePdfExportRuntimeV1["start"]>
  close(): Promise<void>
  readDispatchEvidence: FlowDocBackendDocGenLocalDurablePdfExportRuntimeV1["readDispatchEvidence"]
}

export async function createFlowDocBackendRealdocE63DurableRuntimeV1(input: {
  semanticDirectory: string
  durableRootDirectory: string
  bearerToken: string
  port?: number
  coreRoot?: string
  operationDispatchDelayMs?: number
}): Promise<FlowDocBackendRealdocE63DurableRuntimeV1> {
  if (input.bearerToken.length < 32 || input.bearerToken.length > 512 || /\s/u.test(input.bearerToken)) {
    throw new Error("REALDOC-E.6.3 local runtime requires a bounded bearer token")
  }
  const coreRoot = resolve(input.coreRoot ?? resolve(process.cwd(), "../flowdoc-vnext-core"))
  const prepared = prepareFlowDocBackendRealdocE56InputV1(coreRoot, resolve(input.semanticDirectory))
  const composition = await createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1({
    rootDirectory: resolve(input.durableRootDirectory),
  })
  try {
    const identity: FlowDocBackendPdfExportAuthenticatedIdentityV1 = {
      tenantId: "tenant:pdf-export-realdoc-e63-local",
      principalId: "principal:pdf-export-realdoc-e63-local",
      authenticationId: "authentication:pdf-export-realdoc-e63-local",
    }
    const authenticator = {
      async authenticate({ authorization }: { authorization: string | null }) {
        return authorization === `Bearer ${input.bearerToken}`
          ? { status: "authenticated" as const, identity, issues: [] as [] }
          : { status: "unauthenticated" as const, identity: null, issues: [] as [] }
      },
    }
    const authorize = async () => ({
      status: "authorized" as const,
      authorizationId: "authorization:pdf-export-realdoc-e63-local",
      issues: [] as [],
    })
    const trustedAssetBytes = prepared.trustedAssets.map((asset) => ({
      definition: asset.definition,
      bytes: new Uint8Array(Buffer.from(asset.bytesBase64, "base64")),
    }))
    const assets = createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1(trustedAssetBytes)
    const structures = createFlowDocBackendDocGenTrustedStructureRegistryV1([{
      dataContract: prepared.dataContract,
      mappings: [{
        profile: prepared.mappingProfile,
        mapper: createFlowDocBackendRealdocE56UatMapperV1(coreRoot, prepared.mappingProfile),
      }],
    }])
    const admission = createFlowDocBackendDocGenLocalAdmissionServiceV1({
      structures,
      assets,
      repository: composition.admissionRepository,
    })
    const previewContexts = createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1([{
      authoring: {
        documentId: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
        documentRevision: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
      },
      projection: prepared.projection,
      mappingProfiles: [{ label: "69C semantic JSON", profile: prepared.mappingProfile }],
      assets: prepared.request.assets as ImageAssetRegistryV1,
    }])
    const draftSnapshot = createVNextDraftStructurePreviewSnapshotV1({
      snapshotId: "draft-preview:realdoc-e6-3-69c-section-2-1:0",
      draft: {
        contractVersion: 1,
        kind: "structure-definition-draft",
        structureId: prepared.projection.owner.structureId,
        draftId: "draft:realdoc-e6-3-69c-section-2-1",
        revision: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
      },
      authoring: {
        documentId: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
        documentRevision: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
      },
      sourcePackage: {
        packageId: "package:realdoc-e6-3-69c-section-2-1",
        packageVersion: 3,
        documentVersion: 4,
        packageFingerprint: prepared.evidence.sourceBundleFingerprint,
      },
    })
    const draftPreviewContexts = createFlowDocBackendDocGenLocalDraftPreviewRegistryV1([{
      snapshot: draftSnapshot,
      projection: prepared.projection,
      mappingProfiles: [{ label: "69C semantic JSON", profile: prepared.mappingProfile }],
      assets: prepared.request.assets as ImageAssetRegistryV1,
    }])
    const draftPreviewAdmission = createFlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1({
      registry: draftPreviewContexts,
      admission,
    })
    const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
      repository: composition.admissionRepository,
      assets,
      materializer: createFlowDocBackendDocGenLocalUatArtifactMaterializerV1({ coreRoot }),
      operationIdFactory: () => `realdoc-e63-${randomUUID()}`,
    })
    const runtime = createFlowDocBackendDocGenLocalDurablePdfExportRuntimeV1({
      composition,
      binding,
      host: "127.0.0.1",
      port: input.port ?? 4012,
      routeOptions: {
        authenticator,
        authorizer: { authorize },
      },
      docGenAdmissionOptions: {
        authenticator,
        authorizer: { authorize },
        admission,
      },
      publishedPreviewContextOptions: {
        authenticator,
        authorizer: { authorize },
        registry: previewContexts,
      },
      draftPreviewOptions: {
        authenticator,
        authorizer: { authorize },
        registry: draftPreviewContexts,
        admission: draftPreviewAdmission,
      },
      ...(input.operationDispatchDelayMs == null
        ? {}
        : { operationDispatchDelayMs: input.operationDispatchDelayMs }),
    })
    return {
      facts: {
        source: FLOWDOC_BACKEND_REALDOC_E63_DURABLE_RUNTIME_V1_SOURCE,
        phaseId: "PDF-EXPORT-REALDOC-E.6.3",
        durablePersistence: true,
        explicitRequestReplayResume: true,
        automaticStartupDiscovery: false,
        browserReconnectSupported: true,
        defaultApplicationServerMounted: false,
        productionBinding: false,
      },
      prepared,
      origin: runtime.origin,
      start: runtime.start,
      close: runtime.close,
      readDispatchEvidence: runtime.readDispatchEvidence,
    }
  } catch (error) {
    composition.close()
    throw error
  }
}
