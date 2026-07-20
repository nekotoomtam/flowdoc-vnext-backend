import { z } from "zod"
import {
  ImageAssetRegistryV1Schema,
  VNextDraftStructurePreviewSnapshotV1Schema,
  VNextPublishedStructureMappingProfileV1Schema,
  type ImageAssetRegistryV1,
  type VNextDraftStructurePreviewSnapshotV1,
  type VNextPublishedStructureMappingProfileV1,
  type VNextPublishedStructureTestInputProjectionV1,
} from "@flowdoc/vnext-core"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  isFlowDocBackendPdfExportBoundedStringV1,
} from "../pdfExport/pdfExportOperation.js"
import type { FlowDocBackendPdfExportAuthenticatedIdentityV1 } from "../pdfExport/pdfExportRoute.js"
import {
  FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ADAPTED_PAYLOAD_BYTES_V1,
  type FlowDocBackendDocGenLocalAdmissionIssueV1,
  type FlowDocBackendDocGenLocalAdmissionReceiptV1,
  type FlowDocBackendDocGenLocalAdmissionServiceV1,
} from "./docGenLocalAdmission.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_V1_SOURCE =
  "flowdoc-backend-docgen-local-draft-preview" as const

const NonBlankIdSchema = z.string().min(1).max(512)
  .refine((value) => value.trim().length > 0, { message: "identity must not be whitespace" })
const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)

export const FlowDocBackendDocGenLocalDraftPreviewAdmissionRequestV1Schema = z.object({
  contractVersion: z.literal(1),
  kind: z.literal("docgen-local-draft-preview-admission-request"),
  snapshot: z.object({
    snapshotId: NonBlankIdSchema,
    snapshotFingerprint: FingerprintSchema,
  }).strict(),
  input: z.object({
    kind: z.literal("adapted-json"),
    mappingProfile: z.object({
      mappingProfileId: NonBlankIdSchema,
      mappingProfileVersion: z.number().int().positive(),
      profileFingerprint: FingerprintSchema,
    }).strict(),
    payloadText: z.string().min(1),
  }).strict(),
}).strict()

export type FlowDocBackendDocGenLocalDraftPreviewAdmissionRequestV1 = z.infer<
  typeof FlowDocBackendDocGenLocalDraftPreviewAdmissionRequestV1Schema
>

export interface FlowDocBackendDocGenLocalDraftPreviewMappingOptionV1 {
  label: string
  profile: VNextPublishedStructureMappingProfileV1
}

export interface FlowDocBackendDocGenLocalDraftPreviewContextV1 {
  source: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_V1_SOURCE
  contractVersion: 1
  kind: "docgen-local-draft-preview-context"
  status: "ready"
  authoring: VNextDraftStructurePreviewSnapshotV1["authoring"]
  target: {
    kind: "draft-preview"
    snapshot: VNextDraftStructurePreviewSnapshotV1
  }
  projection: VNextPublishedStructureTestInputProjectionV1
  mappingProfiles: FlowDocBackendDocGenLocalDraftPreviewMappingOptionV1[]
  admission: {
    contractVersion: 1
    kind: "docgen-local-draft-preview-admission-template"
    snapshotId: string
    snapshotFingerprint: string
    assets: ImageAssetRegistryV1
  }
  executionBridge: {
    kind: "published-generation-compatibility-bridge"
    structure: VNextPublishedStructureTestInputProjectionV1["owner"]
    sharedGenerationValidation: true
    sharedArtifactLifecycle: true
    publishedApiParity: false
  }
  limits: {
    adaptedPayloadMaxUtf8Bytes: number
  }
  contracts: {
    trustedBackendSnapshot: true
    exactDraftRevision: true
    immutableDraftSnapshot: true
    separateDraftAdmission: true
    businessValuesIncluded: false
    rawPayloadIncluded: false
    executableMapperIncluded: false
    publishedStructureVersion: false
    publishedApiParity: false
    productionBinding: false
  }
  contextFingerprint: string
}

export interface FlowDocBackendDocGenLocalDraftPreviewEntryV1 {
  snapshot: VNextDraftStructurePreviewSnapshotV1
  projection: VNextPublishedStructureTestInputProjectionV1
  mappingProfiles: readonly FlowDocBackendDocGenLocalDraftPreviewMappingOptionV1[]
  assets: ImageAssetRegistryV1
}

export interface FlowDocBackendDocGenLocalDraftPreviewRegistryV1 {
  resolve(input: { documentId: string; documentRevision: number }): FlowDocBackendDocGenLocalDraftPreviewContextV1 | null
  resolveSnapshot(input: { snapshotId: string; snapshotFingerprint: string }): FlowDocBackendDocGenLocalDraftPreviewContextV1 | null
}

function exactOwner(
  left: VNextPublishedStructureMappingProfileV1["owner"],
  right: VNextPublishedStructureTestInputProjectionV1["owner"],
): boolean {
  return left.structureId === right.structureId
    && left.structureVersionId === right.structureVersionId
    && left.versionOrdinal === right.versionOrdinal
}

function authoringKey(documentId: string, documentRevision: number): string {
  return JSON.stringify([documentId, documentRevision])
}

function snapshotKey(snapshotId: string, snapshotFingerprint: string): string {
  return JSON.stringify([snapshotId, snapshotFingerprint])
}

function inspectEntry(entry: FlowDocBackendDocGenLocalDraftPreviewEntryV1): void {
  const parsedSnapshot = VNextDraftStructurePreviewSnapshotV1Schema.safeParse(entry.snapshot)
  if (!parsedSnapshot.success) throw new Error("Draft Preview requires a canonical immutable snapshot")
  if (entry.snapshot.draft.structureId !== entry.projection.owner.structureId) {
    throw new Error("Draft Preview snapshot and generation bridge must share one Structure lineage")
  }
  if (
    entry.projection.status !== "ready"
    || entry.projection.contracts.businessValuesAccepted !== false
    || entry.projection.contracts.productionBinding !== false
  ) throw new Error("Draft Preview requires a value-free non-production Core projection")
  if (!ImageAssetRegistryV1Schema.safeParse(entry.assets).success) {
    throw new Error("Draft Preview requires a valid asset registry")
  }

  const mappingKeys = new Set<string>()
  for (const option of entry.mappingProfiles) {
    if (!isFlowDocBackendPdfExportBoundedStringV1(option.label)) {
      throw new Error("Draft Preview mapping option requires a bounded label")
    }
    const parsedProfile = VNextPublishedStructureMappingProfileV1Schema.safeParse(option.profile)
    if (!parsedProfile.success) throw new Error("Draft Preview mapping option requires a canonical profile")
    const profile = parsedProfile.data
    const key = JSON.stringify([profile.mappingProfileId, profile.mappingProfileVersion])
    if (mappingKeys.has(key)) throw new Error("Draft Preview mapping profile identity is duplicated")
    mappingKeys.add(key)
    if (!exactOwner(profile.owner, entry.projection.owner)) {
      throw new Error("Draft Preview mapping profile owner does not match the generation bridge")
    }
    if (
      profile.target.dataContractId !== entry.projection.dataContract.dataContractId
      || profile.target.dataContractFingerprint !== entry.projection.dataContract.dataContractFingerprint
    ) throw new Error("Draft Preview mapping profile target does not match the projection")
  }
}

function context(entry: FlowDocBackendDocGenLocalDraftPreviewEntryV1): FlowDocBackendDocGenLocalDraftPreviewContextV1 {
  const facts = {
    source: FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_V1_SOURCE,
    contractVersion: 1 as const,
    kind: "docgen-local-draft-preview-context" as const,
    status: "ready" as const,
    authoring: cloneFlowDocBackendPdfExportJsonV1(entry.snapshot.authoring),
    target: {
      kind: "draft-preview" as const,
      snapshot: cloneFlowDocBackendPdfExportJsonV1(entry.snapshot),
    },
    projection: cloneFlowDocBackendPdfExportJsonV1(entry.projection),
    mappingProfiles: cloneFlowDocBackendPdfExportJsonV1([...entry.mappingProfiles]),
    admission: {
      contractVersion: 1 as const,
      kind: "docgen-local-draft-preview-admission-template" as const,
      snapshotId: entry.snapshot.snapshotId,
      snapshotFingerprint: entry.snapshot.snapshotFingerprint,
      assets: cloneFlowDocBackendPdfExportJsonV1(entry.assets),
    },
    executionBridge: {
      kind: "published-generation-compatibility-bridge" as const,
      structure: cloneFlowDocBackendPdfExportJsonV1(entry.projection.owner),
      sharedGenerationValidation: true as const,
      sharedArtifactLifecycle: true as const,
      publishedApiParity: false as const,
    },
    limits: { adaptedPayloadMaxUtf8Bytes: FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ADAPTED_PAYLOAD_BYTES_V1 },
    contracts: {
      trustedBackendSnapshot: true as const,
      exactDraftRevision: true as const,
      immutableDraftSnapshot: true as const,
      separateDraftAdmission: true as const,
      businessValuesIncluded: false as const,
      rawPayloadIncluded: false as const,
      executableMapperIncluded: false as const,
      publishedStructureVersion: false as const,
      publishedApiParity: false as const,
      productionBinding: false as const,
    },
  }
  return { ...facts, contextFingerprint: flowDocBackendPdfExportFingerprintV1(facts) }
}

export function createFlowDocBackendDocGenLocalDraftPreviewRegistryV1(
  entries: readonly FlowDocBackendDocGenLocalDraftPreviewEntryV1[],
): FlowDocBackendDocGenLocalDraftPreviewRegistryV1 {
  const byAuthoring = new Map<string, FlowDocBackendDocGenLocalDraftPreviewContextV1>()
  const bySnapshot = new Map<string, FlowDocBackendDocGenLocalDraftPreviewContextV1>()
  for (const entry of entries) {
    inspectEntry(entry)
    const value = context(entry)
    const authoring = authoringKey(value.authoring.documentId, value.authoring.documentRevision)
    const snapshot = snapshotKey(value.target.snapshot.snapshotId, value.target.snapshot.snapshotFingerprint)
    if (byAuthoring.has(authoring) || bySnapshot.has(snapshot)) {
      throw new Error("Draft Preview binding is duplicated")
    }
    byAuthoring.set(authoring, value)
    bySnapshot.set(snapshot, value)
  }
  return {
    resolve(input) {
      if (!isFlowDocBackendPdfExportBoundedStringV1(input.documentId)
        || !Number.isSafeInteger(input.documentRevision)
        || input.documentRevision < 0) return null
      const found = byAuthoring.get(authoringKey(input.documentId, input.documentRevision))
      return found == null ? null : cloneFlowDocBackendPdfExportJsonV1(found)
    },
    resolveSnapshot(input) {
      if (!isFlowDocBackendPdfExportBoundedStringV1(input.snapshotId) || !FingerprintSchema.safeParse(input.snapshotFingerprint).success) return null
      const found = bySnapshot.get(snapshotKey(input.snapshotId, input.snapshotFingerprint))
      return found == null ? null : cloneFlowDocBackendPdfExportJsonV1(found)
    },
  }
}

export interface FlowDocBackendDocGenLocalDraftPreviewAdmissionReceiptV1 {
  source: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_V1_SOURCE
  contractVersion: 1
  kind: "docgen-local-draft-preview-admission-receipt"
  status: "ready" | "ready-with-warnings"
  draftSnapshot: VNextDraftStructurePreviewSnapshotV1
  generation: FlowDocBackendDocGenLocalAdmissionReceiptV1
  contracts: {
    exactDraftSnapshot: true
    separateDraftAdmission: true
    sharedGenerationValidation: true
    sharedArtifactLifecycle: true
    canonicalBusinessDataExposed: false
    rawPayloadRetained: false
    publishedApiParity: false
    productionBinding: false
  }
  receiptFingerprint: string
}

export type FlowDocBackendDocGenLocalDraftPreviewAdmissionResultV1 =
  | { status: "created" | "replayed"; receipt: FlowDocBackendDocGenLocalDraftPreviewAdmissionReceiptV1; issues: [] }
  | { status: "invalid-request" | "idempotency-conflict" | "blocked" | "unavailable"; receipt: null; issues: FlowDocBackendDocGenLocalAdmissionIssueV1[] }

export interface FlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1 {
  admit(input: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    callerIdempotencyKey: string
    request: unknown
  }): Promise<FlowDocBackendDocGenLocalDraftPreviewAdmissionResultV1>
}

function issue(code: string, path: string, message: string): FlowDocBackendDocGenLocalAdmissionIssueV1 {
  return { severity: "error", code, path, message }
}

export function createFlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1(input: {
  registry: FlowDocBackendDocGenLocalDraftPreviewRegistryV1
  admission: FlowDocBackendDocGenLocalAdmissionServiceV1
}): FlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1 {
  return {
    async admit(requestInput) {
      const parsed = FlowDocBackendDocGenLocalDraftPreviewAdmissionRequestV1Schema.safeParse(requestInput.request)
      if (!parsed.success) return {
        status: "invalid-request", receipt: null,
        issues: [issue("draft-preview-request-invalid", "body", "Draft Preview request does not match the strict local contract")],
      }
      const context = input.registry.resolveSnapshot(parsed.data.snapshot)
      if (context == null) return {
        status: "blocked", receipt: null,
        issues: [issue("draft-preview-snapshot-not-found", "snapshot", "exact immutable Draft Preview snapshot is not trusted")],
      }
      const selected = context.mappingProfiles.find(({ profile }) => (
        profile.mappingProfileId === parsed.data.input.mappingProfile.mappingProfileId
        && profile.mappingProfileVersion === parsed.data.input.mappingProfile.mappingProfileVersion
        && profile.profileFingerprint === parsed.data.input.mappingProfile.profileFingerprint
      ))
      if (selected == null) return {
        status: "blocked", receipt: null,
        issues: [issue("draft-preview-mapping-profile-not-found", "input.mappingProfile", "exact Draft Preview mapping profile is not trusted")],
      }
      const bridgeKey = `draft-preview:${flowDocBackendPdfExportFingerprintV1({
        callerIdempotencyKey: requestInput.callerIdempotencyKey,
        snapshotFingerprint: context.target.snapshot.snapshotFingerprint,
      }).slice("sha256:".length)}`
      const result = await input.admission.admit({
        identity: requestInput.identity,
        callerIdempotencyKey: bridgeKey,
        request: {
          contractVersion: 1,
          kind: "docgen-local-admission-request",
          structure: context.executionBridge.structure,
          assets: context.admission.assets,
          input: {
            kind: "adapted-json",
            mappingProfile: {
              mappingProfileId: selected.profile.mappingProfileId,
              mappingProfileVersion: selected.profile.mappingProfileVersion,
            },
            payloadText: parsed.data.input.payloadText,
          },
        },
      })
      if (result.status !== "created" && result.status !== "replayed") return {
        status: result.status,
        receipt: null,
        issues: result.issues,
      }
      const facts = {
        source: FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_V1_SOURCE,
        contractVersion: 1 as const,
        kind: "docgen-local-draft-preview-admission-receipt" as const,
        status: result.receipt.status,
        draftSnapshot: cloneFlowDocBackendPdfExportJsonV1(context.target.snapshot),
        generation: cloneFlowDocBackendPdfExportJsonV1(result.receipt),
        contracts: {
          exactDraftSnapshot: true as const,
          separateDraftAdmission: true as const,
          sharedGenerationValidation: true as const,
          sharedArtifactLifecycle: true as const,
          canonicalBusinessDataExposed: false as const,
          rawPayloadRetained: false as const,
          publishedApiParity: false as const,
          productionBinding: false as const,
        },
      }
      return {
        status: result.status,
        receipt: { ...facts, receiptFingerprint: flowDocBackendPdfExportFingerprintV1(facts) },
        issues: [],
      }
    },
  }
}
