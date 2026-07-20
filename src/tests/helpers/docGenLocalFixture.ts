import { createHash } from "node:crypto"
import {
  createVNextPublishedStructureGenerationDataContractV1,
  createVNextPublishedStructureMappingProfileV1,
  type ImageAssetRegistryV1,
  type VNextDocumentInstanceIdentityV1,
  type VNextPublishedCollectionItemContractV1,
  type VNextPublishedFieldContractV1,
  type VNextPublishedStructureCanonicalSnapshotInputV1,
  type VNextPublishedStructureGenerationDataContractV1,
  type VNextPublishedStructureMappingProfileV1,
  type VNextPublishedStructureMappingRuntimeV1,
  type VNextPublishedStructureVersionIdentityV1,
} from "@flowdoc/vnext-core"
import {
  createFlowDocBackendDocGenInMemoryAdmissionRepositoryV1,
  createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1,
  createFlowDocBackendDocGenLocalAdmissionServiceV1,
  createFlowDocBackendDocGenTrustedStructureRegistryV1,
  type FlowDocBackendDocGenLocalAdmissionRepositoryV1,
  type FlowDocBackendDocGenLocalAdmissionRequestV1,
  type FlowDocBackendDocGenTrustedAssetBytesV1,
  type FlowDocBackendPdfExportAuthenticatedIdentityV1,
} from "../../index.js"

const compactHash = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`

export const DOCGEN_LOCAL_AUTHORIZATION = "Bearer docgen-local-owner"
export const DOCGEN_LOCAL_IDEMPOTENCY_KEY = "docgen:test:request-001"
export const DOCGEN_LOCAL_EMPTY_ASSETS: ImageAssetRegistryV1 = { version: 1, images: {} }

export const DOCGEN_LOCAL_IDENTITY: FlowDocBackendPdfExportAuthenticatedIdentityV1 = {
  tenantId: "tenant:docgen-local-test",
  principalId: "principal:docgen-local-owner",
  authenticationId: "authentication:docgen-local-test",
}

export function docGenLocalStructureIdentity(): VNextPublishedStructureVersionIdentityV1 {
  return {
    contractVersion: 1,
    kind: "published-structure-version",
    structureId: "structure:docgen-report",
    structureVersionId: "structure-version:docgen-report:v1",
    versionOrdinal: 1,
    sourceDraft: {
      structureId: "structure:docgen-report",
      draftId: "draft:docgen-report",
      revision: 3,
    },
  }
}

export function docGenLocalStructureRef() {
  const structure = docGenLocalStructureIdentity()
  return {
    structureId: structure.structureId,
    structureVersionId: structure.structureVersionId,
    versionOrdinal: structure.versionOrdinal,
  }
}

function fieldContract(): VNextPublishedFieldContractV1 {
  return {
    contractVersion: 1,
    kind: "published-field-contract",
    fieldContractId: "fields:docgen-report:v1",
    owner: docGenLocalStructureRef(),
    registry: {
      version: 1,
      fields: {
        "report.title": { key: "report.title", label: "Title", type: "text" },
        "report.logo": { key: "report.logo", label: "Logo", type: "image" },
        "report.items": { key: "report.items", label: "Items", type: "collection" },
      },
    },
  }
}

function collectionContract(): VNextPublishedCollectionItemContractV1 {
  return {
    contractVersion: 1,
    kind: "published-collection-item-contract",
    collectionItemContractId: "collection-items:docgen-report:v1",
    publishedFieldContractId: "fields:docgen-report:v1",
    owner: docGenLocalStructureRef(),
    collections: {
      "report.items": {
        collectionFieldKey: "report.items",
        fields: {
          name: { key: "name", label: "Name", type: "text", required: true },
          amount: { key: "amount", label: "Amount", type: "number", required: true },
        },
      },
    },
  }
}

export function docGenLocalDataContract(): VNextPublishedStructureGenerationDataContractV1 {
  return createVNextPublishedStructureGenerationDataContractV1({
    dataContractId: "generation-data:docgen-report:v1",
    publishedStructure: docGenLocalStructureIdentity(),
    publishedStructureFingerprint: compactHash("1"),
    fieldContract: fieldContract(),
    collectionItemContract: collectionContract(),
  })
}

export const DOCGEN_LOCAL_MAPPING_EXECUTION = {
  kind: "named-adapter" as const,
  adapterId: "adapter:docgen-report-json",
  adapterVersion: 1,
  implementationFingerprint: compactHash("2"),
}

export function docGenLocalMappingProfile(
  contract = docGenLocalDataContract(),
): VNextPublishedStructureMappingProfileV1 {
  return createVNextPublishedStructureMappingProfileV1({
    mappingProfileId: "mapping:docgen-report-json",
    mappingProfileVersion: 1,
    owner: docGenLocalStructureRef(),
    sourceContract: {
      sourceContractId: "source:docgen-report-json",
      sourceContractVersion: 1,
      schemaFingerprint: compactHash("3"),
    },
    target: {
      dataContractId: contract.dataContractId,
      dataContractFingerprint: contract.dataContractFingerprint,
    },
    execution: DOCGEN_LOCAL_MAPPING_EXECUTION,
  })
}

export interface DocGenLocalPayload {
  title: string
  name: string
  amount: number
}

export function docGenLocalCanonicalInput(
  instance: VNextDocumentInstanceIdentityV1,
  payload: DocGenLocalPayload,
  assets: ImageAssetRegistryV1 = DOCGEN_LOCAL_EMPTY_ASSETS,
): VNextPublishedStructureCanonicalSnapshotInputV1 {
  const suffix = instance.instanceId.replace(/[^a-zA-Z0-9]/gu, "-")
  return {
    kind: "canonical-snapshot-input",
    dataSnapshot: {
      contractVersion: 1,
      kind: "instance-data-snapshot",
      dataSnapshotId: `mapped-data:${suffix}`,
      instance: structuredClone(instance),
      data: { version: 2, values: { "report.title": payload.title } },
    },
    collectionSnapshots: [{
      contractVersion: 1,
      kind: "table-collection-snapshot",
      collectionSnapshotId: `mapped-collections:${suffix}`,
      snapshotRevision: instance.revision,
      instance: structuredClone(instance),
      collections: {
        "report.items": {
          collectionFieldKey: "report.items",
          items: [{ itemKey: "item-001", values: { name: payload.name, amount: payload.amount } }],
        },
      },
    }],
    mediaSnapshot: {
      contractVersion: 1,
      kind: "instance-media-snapshot",
      mediaSnapshotId: `mapped-media:${suffix}`,
      instance: structuredClone(instance),
      registry: structuredClone(assets),
    },
  }
}

export function docGenLocalMapper(input: {
  onMap?: () => void
  map?: VNextPublishedStructureMappingRuntimeV1["map"]
} = {}): VNextPublishedStructureMappingRuntimeV1 {
  return {
    execution: DOCGEN_LOCAL_MAPPING_EXECUTION,
    map(payload, context) {
      input.onMap?.()
      if (input.map != null) return input.map(payload, context)
      return {
        status: "mapped",
        canonicalInput: docGenLocalCanonicalInput(context.instance, payload as DocGenLocalPayload),
        warnings: [],
      }
    },
  }
}

export function docGenLocalDirectRequest(
  payload: DocGenLocalPayload = { title: "Private report", name: "Private item", amount: 42 },
  assets: ImageAssetRegistryV1 = DOCGEN_LOCAL_EMPTY_ASSETS,
): FlowDocBackendDocGenLocalAdmissionRequestV1 {
  return {
    contractVersion: 1,
    kind: "docgen-local-admission-request",
    structure: docGenLocalStructureRef(),
    assets: structuredClone(assets),
    input: {
      kind: "canonical-data",
      data: { version: 2, values: { "report.title": payload.title } },
      collections: {
        "report.items": {
          collectionFieldKey: "report.items",
          items: [{ itemKey: "item-001", values: { name: payload.name, amount: payload.amount } }],
        },
      },
    },
  }
}

export function docGenLocalAdaptedRequest(
  payloadText: string,
  assets: ImageAssetRegistryV1 = DOCGEN_LOCAL_EMPTY_ASSETS,
): FlowDocBackendDocGenLocalAdmissionRequestV1 {
  return {
    contractVersion: 1,
    kind: "docgen-local-admission-request",
    structure: docGenLocalStructureRef(),
    assets: structuredClone(assets),
    input: {
      kind: "adapted-json",
      mappingProfile: {
        mappingProfileId: "mapping:docgen-report-json",
        mappingProfileVersion: 1,
      },
      payloadText,
    },
  }
}

export function createDocGenLocalAdmissionFixture(input: {
  mapper?: VNextPublishedStructureMappingRuntimeV1
  repository?: FlowDocBackendDocGenLocalAdmissionRepositoryV1
  trustedAssets?: readonly FlowDocBackendDocGenTrustedAssetBytesV1[]
  now?: () => string
} = {}) {
  const contract = docGenLocalDataContract()
  const mapper = input.mapper ?? docGenLocalMapper()
  const repository = input.repository ?? createFlowDocBackendDocGenInMemoryAdmissionRepositoryV1()
  const structures = createFlowDocBackendDocGenTrustedStructureRegistryV1([{
    dataContract: contract,
    mappings: [{ profile: docGenLocalMappingProfile(contract), mapper }],
  }])
  const assets = createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1(input.trustedAssets ?? [])
  const admission = createFlowDocBackendDocGenLocalAdmissionServiceV1({
    structures,
    assets,
    repository,
    now: input.now ?? (() => "2026-07-19T10:00:00.000Z"),
  })
  return { admission, assets, contract, mapper, repository, structures }
}

export function docGenLocalAsset(bytes: Uint8Array): FlowDocBackendDocGenTrustedAssetBytesV1 {
  return {
    definition: {
      id: "asset:report-logo",
      kind: "image",
      mediaType: "image/png",
      byteLength: bytes.byteLength,
      digest: { algorithm: "sha256", value: createHash("sha256").update(bytes).digest("hex") },
      intrinsic: { widthPx: 1, heightPx: 1 },
    },
    bytes,
  }
}
