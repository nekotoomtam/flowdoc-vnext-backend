import { createHash } from "node:crypto"
import {
  DataSnapshotV2Schema,
  ImageAssetRegistryV1Schema,
  VNextDocumentInstanceIdentityV1Schema,
  VNextPublishedStructureCanonicalSnapshotInputV1Schema,
  VNextPublishedStructureGenerationDataContractV1Schema,
  VNextPublishedStructureMappingProfileV1Schema,
  VNextPublishedStructureVersionRefV1Schema,
  VNextTableCollectionValueV1Schema,
  createVNextPublishedStructureCanonicalContentFingerprintV1,
  createVNextPublishedStructureJsonPayloadDescriptorV1,
  runVNextPublishedStructureGenerationRuntimeV1,
  sameVNextPublishedStructureVersionRefV1,
  type ImageAssetDefinition,
  type ImageAssetRegistryV1,
  type VNextDocumentInstanceIdentityV1,
  type VNextPublishedStructureCanonicalSnapshotInputV1,
  type VNextPublishedStructureGenerationDataContractV1,
  type VNextPublishedStructureGenerationRuntimeDiagnosticsV1,
  type VNextPublishedStructureMappingProfileV1,
  type VNextPublishedStructureMappingRuntimeV1,
  type VNextPublishedStructureVersionRefV1,
  type VNextTableCollectionValueV1,
} from "@flowdoc/vnext-core"
import { z } from "zod"
import type { FlowDocBackendPdfExportAuthenticatedIdentityV1 } from "../pdfExport/pdfExportRoute.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_V1_SOURCE =
  "flowdoc-backend-docgen-local-admission" as const
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_CONTRACT_VERSION = 1 as const
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ADAPTED_PAYLOAD_BYTES_V1 = 1024 * 1024
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ID_LENGTH_V1 = 512

const NonBlankIdSchema = z.string().min(1).max(FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ID_LENGTH_V1)
  .refine((value) => value.trim().length > 0, { message: "identity must not be whitespace" })
const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
const CountSchema = z.number().int().nonnegative()
const ExactIsoSchema = z.string().refine((value) => (
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
), { message: "timestamp must be exact ISO-8601 UTC" })

export const FlowDocBackendDocGenLocalAdmissionRequestV1Schema = z.object({
  contractVersion: z.literal(FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_CONTRACT_VERSION),
  kind: z.literal("docgen-local-admission-request"),
  structure: VNextPublishedStructureVersionRefV1Schema,
  assets: ImageAssetRegistryV1Schema,
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("canonical-data"),
      data: DataSnapshotV2Schema,
      collections: z.record(NonBlankIdSchema, VNextTableCollectionValueV1Schema),
    }).strict(),
    z.object({
      kind: z.literal("adapted-json"),
      mappingProfile: z.object({
        mappingProfileId: NonBlankIdSchema,
        mappingProfileVersion: z.number().int().positive(),
      }).strict(),
      payloadText: z.string().min(1),
    }).strict(),
  ]),
}).strict()

export type FlowDocBackendDocGenLocalAdmissionRequestV1 = z.infer<
  typeof FlowDocBackendDocGenLocalAdmissionRequestV1Schema
>

export interface FlowDocBackendDocGenLocalAdmissionIssueV1 {
  severity: "error"
  code: string
  path: string
  message: string
}

export interface FlowDocBackendDocGenTrustedMappingV1 {
  profile: VNextPublishedStructureMappingProfileV1
  mapper: VNextPublishedStructureMappingRuntimeV1
}

export interface FlowDocBackendDocGenTrustedStructureEntryV1 {
  dataContract: VNextPublishedStructureGenerationDataContractV1
  mappings?: readonly FlowDocBackendDocGenTrustedMappingV1[]
}

export interface FlowDocBackendDocGenTrustedStructureRegistryV1 {
  resolveStructure(
    structure: VNextPublishedStructureVersionRefV1,
  ): VNextPublishedStructureGenerationDataContractV1 | null
  resolveMapping(input: {
    structure: VNextPublishedStructureVersionRefV1
    mappingProfileId: string
    mappingProfileVersion: number
  }): FlowDocBackendDocGenTrustedMappingV1 | null
}

export interface FlowDocBackendDocGenAssetAdmissionReadyV1 {
  status: "ready"
  registryFingerprint: string
  assetCount: number
  verifiedByteCount: number
  issues: []
}

export interface FlowDocBackendDocGenAssetAdmissionBlockedV1 {
  status: "blocked"
  registryFingerprint: null
  assetCount: number
  verifiedByteCount: number
  issues: FlowDocBackendDocGenLocalAdmissionIssueV1[]
}

export type FlowDocBackendDocGenAssetResolutionV1 =
  | (FlowDocBackendDocGenAssetAdmissionReadyV1 & { assets: FlowDocBackendDocGenTrustedAssetBytesV1[] })
  | (FlowDocBackendDocGenAssetAdmissionBlockedV1 & { assets: null })

export interface FlowDocBackendDocGenTrustedAssetRegistryV1 {
  verify(registry: ImageAssetRegistryV1): Promise<
    FlowDocBackendDocGenAssetAdmissionReadyV1 | FlowDocBackendDocGenAssetAdmissionBlockedV1
  >
  resolve(registry: ImageAssetRegistryV1): Promise<
    FlowDocBackendDocGenAssetResolutionV1
  >
}

export interface FlowDocBackendDocGenTrustedAssetBytesV1 {
  definition: ImageAssetDefinition
  bytes: Uint8Array
}

export interface FlowDocBackendDocGenLocalAdmissionReceiptV1 {
  source: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_V1_SOURCE
  contractVersion: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_CONTRACT_VERSION
  kind: "docgen-local-admission-receipt"
  admissionId: string
  status: "ready" | "ready-with-warnings"
  lane: "direct" | "adapted"
  scope: {
    tenantId: string
    principalId: string
  }
  structure: VNextPublishedStructureVersionRefV1
  dataContract: {
    dataContractId: string
    dataContractFingerprint: string
    publishedStructureFingerprint: string
  }
  instance: VNextDocumentInstanceIdentityV1
  inputFingerprint: string
  canonicalInputFingerprint: string
  canonicalContentFingerprint: string
  mappingProfile: {
    mappingProfileId: string
    mappingProfileVersion: number
    profileFingerprint: string
  } | null
  assets: {
    registryFingerprint: string
    assetCount: number
    verifiedByteCount: number
  }
  diagnostics: VNextPublishedStructureGenerationRuntimeDiagnosticsV1
  nextStep: "materialization"
  execution: {
    mapping: "not-required" | "executed"
    runtimeValidation: "run-valid"
    materialization: "not-run"
    resolution: "not-run"
    measurement: "not-run"
    pagination: "not-run"
    artifact: "not-run"
  }
  contracts: {
    backendOwnedInstance: true
    exactPublishedStructureVersion: true
    trustedMapperOnly: true
    exactAssetBytesVerified: true
    rawPayloadRetained: false
    canonicalBusinessDataExposed: false
    durablePersistence: boolean
    workerEnqueued: false
    productionBinding: false
  }
  receiptFingerprint: string
}

export interface FlowDocBackendDocGenLocalProtectedAdmissionRecordV1 {
  source: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_V1_SOURCE
  contractVersion: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_CONTRACT_VERSION
  kind: "docgen-local-protected-admission-record"
  admissionId: string
  scope: {
    tenantId: string
    principalId: string
  }
  idempotency: {
    callerKey: string
    requestFingerprint: string
  }
  receipt: FlowDocBackendDocGenLocalAdmissionReceiptV1
  canonicalInput: VNextPublishedStructureCanonicalSnapshotInputV1
  runtimeReceiptFingerprint: string
  acceptedAt: string
  recordFingerprint: string
}

export interface FlowDocBackendDocGenLocalAdmissionRepositoryV1 {
  storage: {
    kind: "memory" | "sqlite"
    durablePersistence: boolean
    processRestartReplay: boolean
    productionBinding: false
  }
  readByIdempotency(input: {
    tenantId: string
    principalId: string
    callerKey: string
  }): Promise<FlowDocBackendDocGenLocalProtectedAdmissionRecordV1 | null>
  insert(record: FlowDocBackendDocGenLocalProtectedAdmissionRecordV1): Promise<
    "inserted" | "already-exists"
  >
  readByAdmissionId(admissionId: string): Promise<FlowDocBackendDocGenLocalProtectedAdmissionRecordV1 | null>
  readByInstanceId(instanceId: string): Promise<FlowDocBackendDocGenLocalProtectedAdmissionRecordV1 | null>
}

const RuntimeDiagnosticIssueSchema = z.object({
  source: z.enum(["planning", "payload", "mapping", "validation"]),
  severity: z.literal("error"),
  code: z.enum([
    "generation-input-blocked",
    "unexpected-adapted-runtime",
    "missing-adapted-runtime",
    "payload-byte-length-mismatch",
    "payload-fingerprint-mismatch",
    "invalid-json-payload",
    "mapping-execution-identity-mismatch",
    "mapping-execution-failed",
    "invalid-mapping-result",
    "mapping-rejected",
    "invalid-canonical-input",
    "invalid-scalar-value-type",
    "missing-instance-media",
    "missing-required-collection-item-field",
    "required-collection-item-value-null",
    "invalid-collection-item-value-type",
    "unsupported-published-image-default",
  ]),
  path: z.string().max(2_048),
  message: z.string().min(1).max(4_096),
  detailCode: NonBlankIdSchema.optional(),
}).strict()

const RuntimeDiagnosticWarningSchema = z.object({
  source: z.enum(["mapping", "validation"]),
  severity: z.literal("warning"),
  code: z.enum(["mapping-warning", "collection-item-default-applied"]),
  path: z.string().max(2_048),
  message: z.string().min(1).max(4_096),
  detailCode: NonBlankIdSchema.optional(),
}).strict()

const RuntimeDiagnosticsSchema = z.object({
  contentFree: z.literal(true),
  issues: z.array(RuntimeDiagnosticIssueSchema),
  warnings: z.array(RuntimeDiagnosticWarningSchema),
  summary: z.object({
    errorCount: CountSchema,
    warningCount: CountSchema,
    scalarValueCount: CountSchema,
    collectionSnapshotCount: CountSchema,
    collectionItemCount: CountSchema,
    mediaAssetCount: CountSchema,
    defaultAppliedCount: CountSchema,
  }).strict(),
  diagnosticsFingerprint: FingerprintSchema,
}).strict()

export const FlowDocBackendDocGenLocalAdmissionReceiptV1Schema: z.ZodType<
  FlowDocBackendDocGenLocalAdmissionReceiptV1
> = z.object({
  source: z.literal(FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_V1_SOURCE),
  contractVersion: z.literal(FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_CONTRACT_VERSION),
  kind: z.literal("docgen-local-admission-receipt"),
  admissionId: NonBlankIdSchema,
  status: z.enum(["ready", "ready-with-warnings"]),
  lane: z.enum(["direct", "adapted"]),
  scope: z.object({ tenantId: NonBlankIdSchema, principalId: NonBlankIdSchema }).strict(),
  structure: VNextPublishedStructureVersionRefV1Schema,
  dataContract: z.object({
    dataContractId: NonBlankIdSchema,
    dataContractFingerprint: FingerprintSchema,
    publishedStructureFingerprint: FingerprintSchema,
  }).strict(),
  instance: VNextDocumentInstanceIdentityV1Schema,
  inputFingerprint: FingerprintSchema,
  canonicalInputFingerprint: FingerprintSchema,
  canonicalContentFingerprint: FingerprintSchema,
  mappingProfile: z.object({
    mappingProfileId: NonBlankIdSchema,
    mappingProfileVersion: z.number().int().positive(),
    profileFingerprint: FingerprintSchema,
  }).strict().nullable(),
  assets: z.object({
    registryFingerprint: FingerprintSchema,
    assetCount: CountSchema,
    verifiedByteCount: CountSchema,
  }).strict(),
  diagnostics: RuntimeDiagnosticsSchema,
  nextStep: z.literal("materialization"),
  execution: z.object({
    mapping: z.enum(["not-required", "executed"]),
    runtimeValidation: z.literal("run-valid"),
    materialization: z.literal("not-run"),
    resolution: z.literal("not-run"),
    measurement: z.literal("not-run"),
    pagination: z.literal("not-run"),
    artifact: z.literal("not-run"),
  }).strict(),
  contracts: z.object({
    backendOwnedInstance: z.literal(true),
    exactPublishedStructureVersion: z.literal(true),
    trustedMapperOnly: z.literal(true),
    exactAssetBytesVerified: z.literal(true),
    rawPayloadRetained: z.literal(false),
    canonicalBusinessDataExposed: z.literal(false),
    durablePersistence: z.boolean(),
    workerEnqueued: z.literal(false),
    productionBinding: z.literal(false),
  }).strict(),
  receiptFingerprint: FingerprintSchema,
}).strict()

export const FlowDocBackendDocGenLocalProtectedAdmissionRecordV1Schema: z.ZodType<
  FlowDocBackendDocGenLocalProtectedAdmissionRecordV1
> = z.object({
  source: z.literal(FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_V1_SOURCE),
  contractVersion: z.literal(FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_CONTRACT_VERSION),
  kind: z.literal("docgen-local-protected-admission-record"),
  admissionId: NonBlankIdSchema,
  scope: z.object({ tenantId: NonBlankIdSchema, principalId: NonBlankIdSchema }).strict(),
  idempotency: z.object({
    callerKey: NonBlankIdSchema,
    requestFingerprint: FingerprintSchema,
  }).strict(),
  receipt: FlowDocBackendDocGenLocalAdmissionReceiptV1Schema,
  canonicalInput: VNextPublishedStructureCanonicalSnapshotInputV1Schema,
  runtimeReceiptFingerprint: FingerprintSchema,
  acceptedAt: ExactIsoSchema,
  recordFingerprint: FingerprintSchema,
}).strict()

export type FlowDocBackendDocGenLocalAdmissionResultV1 =
  | {
      status: "created" | "replayed"
      receipt: FlowDocBackendDocGenLocalAdmissionReceiptV1
      issues: []
    }
  | {
      status: "invalid-request" | "idempotency-conflict" | "blocked" | "unavailable"
      receipt: null
      issues: FlowDocBackendDocGenLocalAdmissionIssueV1[]
    }

export interface FlowDocBackendDocGenLocalAdmissionServiceV1 {
  admit(input: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    callerIdempotencyKey: string
    request: unknown
  }): Promise<FlowDocBackendDocGenLocalAdmissionResultV1>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value == null || typeof value !== "object") return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [
    key,
    canonicalValue((value as Record<string, unknown>)[key]),
  ]))
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex")}`
}

export function parseFlowDocBackendDocGenLocalProtectedAdmissionRecordV1(
  value: unknown,
): FlowDocBackendDocGenLocalProtectedAdmissionRecordV1 {
  const parsed = FlowDocBackendDocGenLocalProtectedAdmissionRecordV1Schema.safeParse(value)
  if (!parsed.success) throw new Error("protected DocGen admission record does not match its strict schema")
  const record = parsed.data
  const { recordFingerprint, ...recordFacts } = record
  const { receiptFingerprint, ...receiptFacts } = record.receipt
  const diagnostics = record.receipt.diagnostics
  const { diagnosticsFingerprint, ...diagnosticFacts } = diagnostics
  const receiptInstanceFingerprint = fingerprint(record.receipt.instance)
  const canonicalInstances = [
    record.canonicalInput.dataSnapshot.instance,
    record.canonicalInput.mediaSnapshot.instance,
    ...record.canonicalInput.collectionSnapshots.map((snapshot) => snapshot.instance),
  ]
  const structure = record.receipt.structure
  const instanceStructure = record.receipt.instance.structureVersion
  const expectedStatus = diagnostics.summary.warningCount > 0 ? "ready-with-warnings" : "ready"
  const expectedMapping = record.receipt.lane === "direct" ? "not-required" : "executed"

  if (
    recordFingerprint !== fingerprint(recordFacts)
    || receiptFingerprint !== fingerprint(receiptFacts)
    || diagnosticsFingerprint !== fingerprint(diagnosticFacts)
    || diagnostics.summary.errorCount !== diagnostics.issues.length
    || diagnostics.summary.warningCount !== diagnostics.warnings.length
    || record.receipt.status !== expectedStatus
    || record.receipt.execution.mapping !== expectedMapping
    || (record.receipt.lane === "direct") !== (record.receipt.mappingProfile == null)
    || record.admissionId !== record.receipt.admissionId
    || fingerprint(record.scope) !== fingerprint(record.receipt.scope)
    || record.idempotency.requestFingerprint !== record.receipt.inputFingerprint
    || record.receipt.canonicalInputFingerprint !== fingerprint(record.canonicalInput)
    || record.receipt.canonicalContentFingerprint
      !== createVNextPublishedStructureCanonicalContentFingerprintV1(record.canonicalInput)
    || record.receipt.assets.registryFingerprint !== fingerprint(record.canonicalInput.mediaSnapshot.registry)
    || canonicalInstances.some((instance) => fingerprint(instance) !== receiptInstanceFingerprint)
    || structure.structureId !== instanceStructure.structureId
    || structure.structureVersionId !== instanceStructure.structureVersionId
    || structure.versionOrdinal !== instanceStructure.versionOrdinal
  ) throw new Error("protected DocGen admission record identity or integrity drifted")

  return clone(record)
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function issue(code: string, path: string, message: string): FlowDocBackendDocGenLocalAdmissionIssueV1 {
  return { severity: "error", code, path, message }
}

function structureRef(contract: VNextPublishedStructureGenerationDataContractV1): VNextPublishedStructureVersionRefV1 {
  return {
    structureId: contract.publishedStructure.structureId,
    structureVersionId: contract.publishedStructure.structureVersionId,
    versionOrdinal: contract.publishedStructure.versionOrdinal,
  }
}

function structureKey(ref: VNextPublishedStructureVersionRefV1): string {
  return `${ref.structureId}\u0000${ref.structureVersionId}\u0000${ref.versionOrdinal}`
}

function mappingKey(ref: VNextPublishedStructureVersionRefV1, id: string, version: number): string {
  return `${structureKey(ref)}\u0000${id}\u0000${version}`
}

function scopeKey(tenantId: string, principalId: string, callerKey: string): string {
  return `${tenantId}\u0000${principalId}\u0000${callerKey}`
}

function exactExecution(
  left: VNextPublishedStructureMappingProfileV1["execution"],
  right: VNextPublishedStructureMappingRuntimeV1["execution"],
): boolean {
  return fingerprint(left) === fingerprint(right)
}

export function createFlowDocBackendDocGenTrustedStructureRegistryV1(
  entries: readonly FlowDocBackendDocGenTrustedStructureEntryV1[],
): FlowDocBackendDocGenTrustedStructureRegistryV1 {
  const structures = new Map<string, VNextPublishedStructureGenerationDataContractV1>()
  const mappings = new Map<string, FlowDocBackendDocGenTrustedMappingV1>()

  entries.forEach((entry) => {
    const contract = VNextPublishedStructureGenerationDataContractV1Schema.parse(entry.dataContract)
    const ref = structureRef(contract)
    const key = structureKey(ref)
    if (structures.has(key)) throw new Error("duplicate trusted Published Structure Version")
    structures.set(key, clone(contract))

    ;(entry.mappings ?? []).forEach((mapping) => {
      const profile = VNextPublishedStructureMappingProfileV1Schema.parse(mapping.profile)
      if (!sameVNextPublishedStructureVersionRefV1(profile.owner, ref)) {
        throw new Error("trusted mapping profile owner does not match its Published Structure Version")
      }
      if (
        profile.target.dataContractId !== contract.dataContractId
        || profile.target.dataContractFingerprint !== contract.dataContractFingerprint
      ) throw new Error("trusted mapping profile target does not match its generation data contract")
      if (!exactExecution(profile.execution, mapping.mapper.execution)) {
        throw new Error("trusted mapper execution identity does not match its mapping profile")
      }
      const profileKey = mappingKey(ref, profile.mappingProfileId, profile.mappingProfileVersion)
      if (mappings.has(profileKey)) throw new Error("duplicate trusted mapping profile identity")
      mappings.set(profileKey, { profile: clone(profile), mapper: mapping.mapper })
    })
  })

  return {
    resolveStructure(ref) {
      const contract = structures.get(structureKey(ref))
      return contract == null ? null : clone(contract)
    },
    resolveMapping(input) {
      const mapping = mappings.get(mappingKey(
        input.structure,
        input.mappingProfileId,
        input.mappingProfileVersion,
      ))
      return mapping == null ? null : { profile: clone(mapping.profile), mapper: mapping.mapper }
    },
  }
}

export function createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1(
  entries: readonly FlowDocBackendDocGenTrustedAssetBytesV1[],
): FlowDocBackendDocGenTrustedAssetRegistryV1 {
  const assets = new Map<string, { definition: ImageAssetDefinition; bytes: Uint8Array }>()
  entries.forEach((entry) => {
    const registry = ImageAssetRegistryV1Schema.parse({
      version: 1,
      images: { [entry.definition.id]: entry.definition },
    })
    const definition = registry.images[entry.definition.id]!
    if (assets.has(definition.id)) throw new Error("duplicate trusted asset identity")
    if (entry.bytes.byteLength !== definition.byteLength) {
      throw new Error("trusted asset byte length does not match its definition")
    }
    if (sha256(entry.bytes) !== definition.digest.value) {
      throw new Error("trusted asset digest does not match its bytes")
    }
    assets.set(definition.id, { definition: clone(definition), bytes: new Uint8Array(entry.bytes) })
  })

  async function resolveRegistry(registry: ImageAssetRegistryV1):
  Promise<FlowDocBackendDocGenAssetResolutionV1> {
    const admitted = ImageAssetRegistryV1Schema.parse(registry)
    const issues: FlowDocBackendDocGenLocalAdmissionIssueV1[] = []
    let verifiedByteCount = 0
    const resolved: FlowDocBackendDocGenTrustedAssetBytesV1[] = []
    Object.entries(admitted.images).forEach(([assetId, definition]) => {
        const trusted = assets.get(assetId)
        if (trusted == null) {
          issues.push(issue(
            "docgen-asset-not-found",
            `assets.images.${assetId}`,
            "asset bytes are not available in the trusted local registry",
          ))
          return
        }
        if (fingerprint(trusted.definition) !== fingerprint(definition)) {
          issues.push(issue(
            "docgen-asset-definition-mismatch",
            `assets.images.${assetId}`,
            "asset definition does not match the digest-bound trusted bytes",
          ))
          return
        }
        if (
          trusted.bytes.byteLength !== definition.byteLength
          || sha256(trusted.bytes) !== definition.digest.value
        ) {
          issues.push(issue(
            "docgen-asset-bytes-drift",
            `assets.images.${assetId}`,
            "trusted asset bytes no longer match the admitted definition",
          ))
          return
        }
        verifiedByteCount += trusted.bytes.byteLength
        resolved.push({ definition: clone(trusted.definition), bytes: new Uint8Array(trusted.bytes) })
    })
    if (issues.length > 0) return {
      status: "blocked",
      registryFingerprint: null,
      assetCount: Object.keys(admitted.images).length,
      verifiedByteCount,
      assets: null,
      issues,
    }
    return {
      status: "ready",
      registryFingerprint: fingerprint(admitted),
      assetCount: Object.keys(admitted.images).length,
      verifiedByteCount,
      assets: resolved,
      issues: [],
    }
  }

  return {
    async verify(registry) {
      const resolved = await resolveRegistry(registry)
      if (resolved.status === "blocked") {
        const { assets: _assets, ...result } = resolved
        return result
      }
      const { assets: _assets, ...result } = resolved
      return result
    },
    resolve: resolveRegistry,
  }
}

export function createFlowDocBackendDocGenInMemoryAdmissionRepositoryV1():
FlowDocBackendDocGenLocalAdmissionRepositoryV1 {
  const byScope = new Map<string, FlowDocBackendDocGenLocalProtectedAdmissionRecordV1>()
  const byAdmissionId = new Map<string, FlowDocBackendDocGenLocalProtectedAdmissionRecordV1>()
  const byInstanceId = new Map<string, FlowDocBackendDocGenLocalProtectedAdmissionRecordV1>()
  return {
    storage: {
      kind: "memory",
      durablePersistence: false,
      processRestartReplay: false,
      productionBinding: false,
    },
    async readByIdempotency(input) {
      const record = byScope.get(scopeKey(input.tenantId, input.principalId, input.callerKey))
      return record == null ? null : clone(record)
    },
    async insert(record) {
      const verified = parseFlowDocBackendDocGenLocalProtectedAdmissionRecordV1(record)
      const key = scopeKey(verified.scope.tenantId, verified.scope.principalId, verified.idempotency.callerKey)
      if (
        byScope.has(key)
        || byAdmissionId.has(verified.admissionId)
        || byInstanceId.has(verified.receipt.instance.instanceId)
      ) return "already-exists"
      const stored = clone(verified)
      byScope.set(key, stored)
      byAdmissionId.set(verified.admissionId, stored)
      byInstanceId.set(verified.receipt.instance.instanceId, stored)
      return "inserted"
    },
    async readByAdmissionId(admissionId) {
      const record = byAdmissionId.get(admissionId)
      return record == null ? null : clone(record)
    },
    async readByInstanceId(instanceId) {
      const record = byInstanceId.get(instanceId)
      return record == null ? null : clone(record)
    },
  }
}

function formatZodPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((current, segment) => {
    if (typeof segment === "number") return `${current}[${segment}]`
    const key = String(segment)
    return current.length === 0 ? key : `${current}.${key}`
  }, "")
}

function parseRequest(value: unknown):
  | { status: "ready"; request: FlowDocBackendDocGenLocalAdmissionRequestV1; issues: [] }
  | { status: "invalid-request"; request: null; issues: FlowDocBackendDocGenLocalAdmissionIssueV1[] } {
  const parsed = FlowDocBackendDocGenLocalAdmissionRequestV1Schema.safeParse(value)
  if (!parsed.success) return {
    status: "invalid-request",
    request: null,
    issues: parsed.error.issues.map((item) => issue(
      "docgen-request-invalid",
      formatZodPath(item.path),
      "DocGen admission request does not match the strict local contract",
    )),
  }
  if (
    parsed.data.input.kind === "adapted-json"
    && new TextEncoder().encode(parsed.data.input.payloadText).byteLength
      > FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ADAPTED_PAYLOAD_BYTES_V1
  ) return {
    status: "invalid-request",
    request: null,
    issues: [issue(
      "docgen-adapted-payload-too-large",
      "input.payloadText",
      `adapted JSON payload must not exceed ${FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ADAPTED_PAYLOAD_BYTES_V1} UTF-8 bytes`,
    )],
  }
  return { status: "ready", request: parsed.data, issues: [] }
}

function validCallerKey(value: string): boolean {
  return value.length > 0
    && value.length <= FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ID_LENGTH_V1
    && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function instanceFor(
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1,
  callerKey: string,
  requestFingerprint: string,
  structure: VNextPublishedStructureVersionRefV1,
): VNextDocumentInstanceIdentityV1 {
  const digest = fingerprint({
    tenantId: identity.tenantId,
    principalId: identity.principalId,
    callerKey,
    requestFingerprint,
    structure,
  }).slice("sha256:".length)
  return {
    contractVersion: 1,
    kind: "document-instance",
    instanceId: `docgen-instance:${digest}`,
    revision: 0,
    structureVersion: clone(structure),
  }
}

function directCanonicalInput(
  instance: VNextDocumentInstanceIdentityV1,
  input: Extract<FlowDocBackendDocGenLocalAdmissionRequestV1["input"], { kind: "canonical-data" }>,
  assets: ImageAssetRegistryV1,
): VNextPublishedStructureCanonicalSnapshotInputV1 {
  const identityDigest = instance.instanceId.slice("docgen-instance:".length)
  const collections = Object.keys(input.collections).length === 0 ? [] : [{
    contractVersion: 1 as const,
    kind: "table-collection-snapshot" as const,
    collectionSnapshotId: `docgen-collections:${identityDigest}`,
    snapshotRevision: instance.revision,
    instance: clone(instance),
    collections: clone(input.collections),
  }]
  return {
    kind: "canonical-snapshot-input",
    dataSnapshot: {
      contractVersion: 1,
      kind: "instance-data-snapshot",
      dataSnapshotId: `docgen-data:${identityDigest}`,
      instance: clone(instance),
      data: clone(input.data),
    },
    collectionSnapshots: collections,
    mediaSnapshot: {
      contractVersion: 1,
      kind: "instance-media-snapshot",
      mediaSnapshotId: `docgen-media:${identityDigest}`,
      instance: clone(instance),
      registry: clone(assets),
    },
  }
}

function conflict(): FlowDocBackendDocGenLocalAdmissionResultV1 {
  return {
    status: "idempotency-conflict",
    receipt: null,
    issues: [issue(
      "docgen-idempotency-conflict",
      "idempotencyKey",
      "idempotency key is already bound to a different strict request",
    )],
  }
}

export function createFlowDocBackendDocGenLocalAdmissionServiceV1(input: {
  structures: FlowDocBackendDocGenTrustedStructureRegistryV1
  assets: FlowDocBackendDocGenTrustedAssetRegistryV1
  repository?: FlowDocBackendDocGenLocalAdmissionRepositoryV1
  now?: () => string
}): FlowDocBackendDocGenLocalAdmissionServiceV1 {
  const repository = input.repository ?? createFlowDocBackendDocGenInMemoryAdmissionRepositoryV1()
  const now = input.now ?? (() => new Date().toISOString())
  const inFlight = new Map<string, {
    requestFingerprint: string
    promise: Promise<FlowDocBackendDocGenLocalAdmissionResultV1>
  }>()

  async function execute(admissionInput: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    callerIdempotencyKey: string
    request: FlowDocBackendDocGenLocalAdmissionRequestV1
    requestFingerprint: string
  }): Promise<FlowDocBackendDocGenLocalAdmissionResultV1> {
    const { identity, callerIdempotencyKey, request, requestFingerprint } = admissionInput
    const contract = input.structures.resolveStructure(request.structure)
    if (contract == null) return {
      status: "blocked",
      receipt: null,
      issues: [issue(
        "docgen-structure-not-found",
        "structure",
        "exact Published Structure Version is not present in the trusted local registry",
      )],
    }

    let assetAdmission: Awaited<ReturnType<FlowDocBackendDocGenTrustedAssetRegistryV1["verify"]>>
    try {
      assetAdmission = await input.assets.verify(request.assets)
    } catch {
      return {
        status: "unavailable",
        receipt: null,
        issues: [issue(
          "docgen-asset-admission-unavailable",
          "assets",
          "trusted asset admission is unavailable",
        )],
      }
    }
    if (assetAdmission.status === "blocked") return {
      status: "blocked",
      receipt: null,
      issues: assetAdmission.issues,
    }

    const instance = instanceFor(identity, callerIdempotencyKey, requestFingerprint, request.structure)
    let runtimeInput
    let runtimeOptions: Parameters<typeof runVNextPublishedStructureGenerationRuntimeV1>[1] = {}
    if (request.input.kind === "canonical-data") {
      runtimeInput = {
        contractVersion: 1 as const,
        kind: "published-structure-generation-input-request" as const,
        dataContract: contract,
        instance,
        input: directCanonicalInput(instance, request.input, request.assets),
      }
    } else {
      const trustedMapping = input.structures.resolveMapping({
        structure: request.structure,
        mappingProfileId: request.input.mappingProfile.mappingProfileId,
        mappingProfileVersion: request.input.mappingProfile.mappingProfileVersion,
      })
      if (trustedMapping == null) return {
        status: "blocked",
        receipt: null,
        issues: [issue(
          "docgen-mapping-profile-not-found",
          "input.mappingProfile",
          "exact mapping profile and trusted mapper are not present in the local registry",
        )],
      }
      const payloadText = request.input.payloadText
      runtimeInput = {
        contractVersion: 1 as const,
        kind: "published-structure-generation-input-request" as const,
        dataContract: contract,
        instance,
        input: {
          kind: "adapted-payload-input" as const,
          payload: createVNextPublishedStructureJsonPayloadDescriptorV1(
            `docgen-payload:${requestFingerprint.slice("sha256:".length)}`,
            payloadText,
          ),
          mappingProfile: trustedMapping.profile,
        },
      }
      runtimeOptions = { adaptedInput: { payloadText, mapper: trustedMapping.mapper } }
    }

    const runtime = runVNextPublishedStructureGenerationRuntimeV1(runtimeInput, runtimeOptions)
    if (runtime.status === "blocked") return {
      status: "blocked",
      receipt: null,
      issues: runtime.diagnostics.issues.map((item) => issue(
        `docgen-runtime-${item.code}`,
        item.path,
        item.message,
      )),
    }
    if (fingerprint(runtime.canonicalInput.mediaSnapshot.registry) !== assetAdmission.registryFingerprint) {
      return {
        status: "blocked",
        receipt: null,
        issues: [issue(
          "docgen-canonical-assets-mismatch",
          "canonicalInput.mediaSnapshot.registry",
          "canonical mapped media does not match the digest-bound admitted asset registry",
        )],
      }
    }

    const admissionId = `docgen-admission:${fingerprint({
      scope: { tenantId: identity.tenantId, principalId: identity.principalId },
      callerIdempotencyKey,
      requestFingerprint,
    }).slice("sha256:".length)}`
    const receiptFacts = {
      source: FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_V1_SOURCE,
      contractVersion: FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_CONTRACT_VERSION,
      kind: "docgen-local-admission-receipt" as const,
      admissionId,
      status: runtime.status,
      lane: runtime.lane,
      scope: { tenantId: identity.tenantId, principalId: identity.principalId },
      structure: clone(request.structure),
      dataContract: {
        dataContractId: contract.dataContractId,
        dataContractFingerprint: contract.dataContractFingerprint,
        publishedStructureFingerprint: contract.publishedStructureFingerprint,
      },
      instance: clone(instance),
      inputFingerprint: requestFingerprint,
      canonicalInputFingerprint: runtime.canonicalInputFingerprint,
      canonicalContentFingerprint: runtime.canonicalContentFingerprint,
      mappingProfile: clone(runtime.mappingProfile),
      assets: {
        registryFingerprint: assetAdmission.registryFingerprint,
        assetCount: assetAdmission.assetCount,
        verifiedByteCount: assetAdmission.verifiedByteCount,
      },
      diagnostics: clone(runtime.diagnostics),
      nextStep: "materialization" as const,
      execution: {
        mapping: runtime.lane === "direct" ? "not-required" as const : "executed" as const,
        runtimeValidation: "run-valid" as const,
        materialization: "not-run" as const,
        resolution: "not-run" as const,
        measurement: "not-run" as const,
        pagination: "not-run" as const,
        artifact: "not-run" as const,
      },
      contracts: {
        backendOwnedInstance: true as const,
        exactPublishedStructureVersion: true as const,
        trustedMapperOnly: true as const,
        exactAssetBytesVerified: true as const,
        rawPayloadRetained: false as const,
        canonicalBusinessDataExposed: false as const,
        durablePersistence: repository.storage.durablePersistence,
        workerEnqueued: false as const,
        productionBinding: false as const,
      },
    }
    const receipt: FlowDocBackendDocGenLocalAdmissionReceiptV1 = {
      ...receiptFacts,
      receiptFingerprint: fingerprint(receiptFacts),
    }
    const acceptedAt = now()
    const recordFacts = {
      source: FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_V1_SOURCE,
      contractVersion: FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_CONTRACT_VERSION,
      kind: "docgen-local-protected-admission-record" as const,
      admissionId,
      scope: clone(receipt.scope),
      idempotency: { callerKey: callerIdempotencyKey, requestFingerprint },
      receipt: clone(receipt),
      canonicalInput: clone(runtime.canonicalInput),
      runtimeReceiptFingerprint: runtime.receiptFingerprint,
      acceptedAt,
    }
    const record: FlowDocBackendDocGenLocalProtectedAdmissionRecordV1 = {
      ...recordFacts,
      recordFingerprint: fingerprint(recordFacts),
    }
    const inserted = await repository.insert(record)
    if (inserted === "already-exists") {
      const existing = await repository.readByIdempotency({
        tenantId: identity.tenantId,
        principalId: identity.principalId,
        callerKey: callerIdempotencyKey,
      })
      if (existing?.idempotency.requestFingerprint !== requestFingerprint) return conflict()
      if (existing != null) return { status: "replayed", receipt: existing.receipt, issues: [] }
      return {
        status: "unavailable",
        receipt: null,
        issues: [issue("docgen-repository-unavailable", "repository", "admission repository is unavailable")],
      }
    }
    return { status: "created", receipt: clone(receipt), issues: [] }
  }

  return {
    async admit(admissionInput) {
      if (!validCallerKey(admissionInput.callerIdempotencyKey)) return {
        status: "invalid-request",
        receipt: null,
        issues: [issue(
          "docgen-idempotency-key-invalid",
          "idempotencyKey",
          `idempotency key must be a bounded non-empty string of at most ${FLOWDOC_BACKEND_DOCGEN_LOCAL_MAX_ID_LENGTH_V1} characters`,
        )],
      }
      const parsed = parseRequest(admissionInput.request)
      if (parsed.status === "invalid-request") return {
        status: parsed.status,
        receipt: null,
        issues: parsed.issues,
      }
      const requestFingerprint = fingerprint(parsed.request)
      const scopedKey = scopeKey(
        admissionInput.identity.tenantId,
        admissionInput.identity.principalId,
        admissionInput.callerIdempotencyKey,
      )

      try {
        const existing = await repository.readByIdempotency({
          tenantId: admissionInput.identity.tenantId,
          principalId: admissionInput.identity.principalId,
          callerKey: admissionInput.callerIdempotencyKey,
        })
        if (existing != null) {
          if (existing.idempotency.requestFingerprint !== requestFingerprint) return conflict()
          return { status: "replayed", receipt: existing.receipt, issues: [] }
        }

        const active = inFlight.get(scopedKey)
        if (active != null) {
          if (active.requestFingerprint !== requestFingerprint) return conflict()
          const result = await active.promise
          return result.status === "created"
            ? { status: "replayed", receipt: result.receipt, issues: [] }
            : result
        }

        const promise = execute({
          identity: admissionInput.identity,
          callerIdempotencyKey: admissionInput.callerIdempotencyKey,
          request: parsed.request,
          requestFingerprint,
        })
        inFlight.set(scopedKey, { requestFingerprint, promise })
        try {
          return await promise
        } finally {
          inFlight.delete(scopedKey)
        }
      } catch {
        return {
          status: "unavailable",
          receipt: null,
          issues: [issue(
            "docgen-admission-unavailable",
            "admission",
            "local DocGen admission is unavailable",
          )],
        }
      }
    },
  }
}
