import {
  ImageAssetRegistryV1Schema,
  VNextPublishedStructureMappingProfileV1Schema,
  type ImageAssetRegistryV1,
  type VNextPublishedStructureMappingProfileV1,
  type VNextPublishedStructureTestInputProjectionV1,
} from "@flowdoc/vnext-core"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  isFlowDocBackendPdfExportBoundedStringV1,
} from "../pdfExport/pdfExportOperation.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_PUBLISHED_PREVIEW_V1_SOURCE =
  "flowdoc-backend-docgen-local-published-preview" as const

export interface FlowDocBackendDocGenLocalPublishedPreviewMappingOptionV1 {
  label: string
  profile: VNextPublishedStructureMappingProfileV1
}

export interface FlowDocBackendDocGenLocalPublishedPreviewContextV1 {
  source: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_PUBLISHED_PREVIEW_V1_SOURCE
  contractVersion: 1
  kind: "docgen-local-published-preview-context"
  status: "ready"
  authoring: {
    documentId: string
    documentRevision: number
  }
  projection: VNextPublishedStructureTestInputProjectionV1
  mappingProfiles: FlowDocBackendDocGenLocalPublishedPreviewMappingOptionV1[]
  admission: {
    contractVersion: 1
    kind: "docgen-local-admission-template"
    structure: VNextPublishedStructureTestInputProjectionV1["owner"]
    assets: ImageAssetRegistryV1
  }
  limits: {
    adaptedPayloadMaxUtf8Bytes: number
  }
  contracts: {
    trustedBackendProjection: true
    trustedBackendProfiles: true
    exactPublishedStructureVersion: true
    businessValuesIncluded: false
    rawPayloadIncluded: false
    executableMapperIncluded: false
    productionBinding: false
  }
  contextFingerprint: string
}

export interface FlowDocBackendDocGenLocalPublishedPreviewRegistryV1 {
  resolve(input: {
    documentId: string
    documentRevision: number
  }): FlowDocBackendDocGenLocalPublishedPreviewContextV1 | null
}

export interface FlowDocBackendDocGenLocalPublishedPreviewEntryV1 {
  authoring: {
    documentId: string
    documentRevision: number
  }
  projection: VNextPublishedStructureTestInputProjectionV1
  mappingProfiles: readonly FlowDocBackendDocGenLocalPublishedPreviewMappingOptionV1[]
  assets: ImageAssetRegistryV1
}

function exactOwner(
  left: VNextPublishedStructureMappingProfileV1["owner"],
  right: VNextPublishedStructureTestInputProjectionV1["owner"],
): boolean {
  return left.structureId === right.structureId
    && left.structureVersionId === right.structureVersionId
    && left.versionOrdinal === right.versionOrdinal
}

function key(documentId: string, documentRevision: number): string {
  return JSON.stringify([documentId, documentRevision])
}

function inspectEntry(entry: FlowDocBackendDocGenLocalPublishedPreviewEntryV1): void {
  if (
    !isFlowDocBackendPdfExportBoundedStringV1(entry.authoring.documentId)
    || !Number.isSafeInteger(entry.authoring.documentRevision)
    || entry.authoring.documentRevision < 0
  ) throw new Error("Published Preview binding requires an exact authoring document pin")
  if (
    entry.projection.status !== "ready"
    || entry.projection.contracts.businessValuesAccepted !== false
    || entry.projection.contracts.productionBinding !== false
  ) throw new Error("Published Preview binding requires a value-free non-production Core projection")
  const parsedAssets = ImageAssetRegistryV1Schema.safeParse(entry.assets)
  if (!parsedAssets.success) throw new Error("Published Preview binding requires a valid asset registry")

  const mappingKeys = new Set<string>()
  for (const option of entry.mappingProfiles) {
    if (!isFlowDocBackendPdfExportBoundedStringV1(option.label)) {
      throw new Error("Published Preview mapping option requires a bounded label")
    }
    const parsedProfile = VNextPublishedStructureMappingProfileV1Schema.safeParse(option.profile)
    if (!parsedProfile.success) {
      throw new Error("Published Preview mapping option requires a canonical profile")
    }
    const profile = parsedProfile.data
    const mappingKey = JSON.stringify([profile.mappingProfileId, profile.mappingProfileVersion])
    if (mappingKeys.has(mappingKey)) throw new Error("Published Preview mapping profile identity is duplicated")
    mappingKeys.add(mappingKey)
    if (!exactOwner(profile.owner, entry.projection.owner)) {
      throw new Error("Published Preview mapping profile owner does not match the projection")
    }
    if (
      profile.target.dataContractId !== entry.projection.dataContract.dataContractId
      || profile.target.dataContractFingerprint
        !== entry.projection.dataContract.dataContractFingerprint
    ) throw new Error("Published Preview mapping profile target does not match the projection")
  }
}

function context(
  entry: FlowDocBackendDocGenLocalPublishedPreviewEntryV1,
): FlowDocBackendDocGenLocalPublishedPreviewContextV1 {
  const facts = {
    source: FLOWDOC_BACKEND_DOCGEN_LOCAL_PUBLISHED_PREVIEW_V1_SOURCE,
    contractVersion: 1 as const,
    kind: "docgen-local-published-preview-context" as const,
    status: "ready" as const,
    authoring: cloneFlowDocBackendPdfExportJsonV1(entry.authoring),
    projection: cloneFlowDocBackendPdfExportJsonV1(entry.projection),
    mappingProfiles: cloneFlowDocBackendPdfExportJsonV1([...entry.mappingProfiles]),
    admission: {
      contractVersion: 1 as const,
      kind: "docgen-local-admission-template" as const,
      structure: cloneFlowDocBackendPdfExportJsonV1(entry.projection.owner),
      assets: cloneFlowDocBackendPdfExportJsonV1(entry.assets),
    },
    limits: { adaptedPayloadMaxUtf8Bytes: 1024 * 1024 },
    contracts: {
      trustedBackendProjection: true as const,
      trustedBackendProfiles: true as const,
      exactPublishedStructureVersion: true as const,
      businessValuesIncluded: false as const,
      rawPayloadIncluded: false as const,
      executableMapperIncluded: false as const,
      productionBinding: false as const,
    },
  }
  return {
    ...facts,
    contextFingerprint: flowDocBackendPdfExportFingerprintV1(facts),
  }
}

export function createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1(
  entries: readonly FlowDocBackendDocGenLocalPublishedPreviewEntryV1[],
): FlowDocBackendDocGenLocalPublishedPreviewRegistryV1 {
  const contexts = new Map<string, FlowDocBackendDocGenLocalPublishedPreviewContextV1>()
  for (const entry of entries) {
    inspectEntry(entry)
    const entryKey = key(entry.authoring.documentId, entry.authoring.documentRevision)
    if (contexts.has(entryKey)) throw new Error("Published Preview binding is duplicated")
    contexts.set(entryKey, context(entry))
  }
  return {
    resolve(input) {
      if (
        !isFlowDocBackendPdfExportBoundedStringV1(input.documentId)
        || !Number.isSafeInteger(input.documentRevision)
        || input.documentRevision < 0
      ) return null
      const found = contexts.get(key(input.documentId, input.documentRevision))
      return found == null ? null : cloneFlowDocBackendPdfExportJsonV1(found)
    },
  }
}
