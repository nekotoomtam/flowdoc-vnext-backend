import { createHash, randomUUID } from "node:crypto"
import {
  createVNextPdfExportRequestV1,
  createVNextPublishedStructureCanonicalContentFingerprintV1,
  type VNextPdfExportProductionPolicyV1,
  type VNextPdfExportRequestV1,
  type VNextPdfExportSourceIdentityV1,
  type VNextPdfMeasuredDrawContractResultV1,
} from "@flowdoc/vnext-core"
import type {
  FlowDocBackendDocGenLocalAdmissionRepositoryV1,
  FlowDocBackendDocGenLocalProtectedAdmissionRecordV1,
  FlowDocBackendDocGenTrustedAssetBytesV1,
  FlowDocBackendDocGenTrustedAssetRegistryV1,
} from "./docGenLocalAdmission.js"
import type { FlowDocBackendPdfExportArtifactPersistenceRepositoryV1 } from "../pdfExport/pdfExportArtifactPersistence.js"
import type { FlowDocBackendPdfExportContentAddressedStoreV1 } from "../pdfExport/pdfExportContentAddressedStore.js"
import type { FlowDocBackendPdfExportLifecycleRepositoryV1 } from "../pdfExport/pdfExportLifecycleRepository.js"
import {
  createFlowDocBackendLocalPdfRendererV1,
  type FlowDocBackendLocalPdfRendererFontResourceV1,
  type FlowDocBackendLocalPdfRendererImageResourceV1,
  type FlowDocBackendLocalPdfRendererV1,
} from "../pdfExport/pdfExportLocalRenderer.js"
import type { FlowDocBackendPdfExportLocalWorkerExecutionInputV1 } from "../pdfExport/pdfExportLocalWorker.js"
import type { FlowDocBackendPdfExportObservabilityRepositoryV1 } from "../pdfExport/pdfExportObservability.js"
import {
  flowDocBackendPdfExportFingerprintV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "../pdfExport/pdfExportOperation.js"
import type { FlowDocBackendPdfExportOperationRepositoryV1 } from "../pdfExport/pdfExportOperationRepository.js"
import {
  createFlowDocBackendPdfExportRendererQualificationV1,
  flowDocBackendPdfExportCurrentRuntimeIdentityV1,
  type FlowDocBackendPdfExportRendererQualificationV1,
} from "../pdfExport/pdfExportRendererQualification.js"
import type {
  FlowDocBackendPdfExportAdmissionResolverV1,
  FlowDocBackendPdfExportAuthenticatedIdentityV1,
} from "../pdfExport/pdfExportRoute.js"
import type { FlowDocBackendPdfExportWorkflowInputV1 } from "../pdfExport/pdfExportWorkflow.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_PDF_EXPORT_V1_SOURCE =
  "flowdoc-backend-docgen-local-pdf-export" as const

type ConsumableMeasuredContractV1 = Extract<
  VNextPdfMeasuredDrawContractResultV1,
  { status: "consumable" }
>

export interface FlowDocBackendDocGenLocalMaterializedArtifactV1 {
  status: "ready"
  materializationFingerprint: string
  resolutionFingerprint: string
  measuredPlanFingerprint: string
  measuredBundleFingerprint: string
  artifactInputFingerprint: string
  measuredDrawContract: ConsumableMeasuredContractV1
  fontResources: FlowDocBackendLocalPdfRendererFontResourceV1[]
  imageResources: FlowDocBackendLocalPdfRendererImageResourceV1[]
  summary: {
    pageCount: number
    paintCommandCount: number
    glyphCount: number
    imageAssetCount: number
  }
  issues: []
}

export interface FlowDocBackendDocGenLocalMaterializationBlockedV1 {
  status: "blocked"
  materializationFingerprint: null
  resolutionFingerprint: null
  measuredPlanFingerprint: null
  measuredBundleFingerprint: null
  artifactInputFingerprint: null
  measuredDrawContract: null
  fontResources: null
  imageResources: null
  summary: null
  issues: Array<{ code: string; path: string; message: string; severity: "error" }>
}

export interface FlowDocBackendDocGenLocalArtifactMaterializerV1 {
  materializerId: string
  materializerVersion: string
  implementationFingerprint: string
  rendererProfileId: string
  measurementProfileId: string
  materialize(input: {
    record: FlowDocBackendDocGenLocalProtectedAdmissionRecordV1
    assets: readonly FlowDocBackendDocGenTrustedAssetBytesV1[]
  }): Promise<
    FlowDocBackendDocGenLocalMaterializedArtifactV1
    | FlowDocBackendDocGenLocalMaterializationBlockedV1
  >
}

export interface FlowDocBackendDocGenLocalArtifactWorkflowRepositoriesV1 {
  operationRepository: FlowDocBackendPdfExportOperationRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilityRepositoryV1
  contentStore: FlowDocBackendPdfExportContentAddressedStoreV1
}

export interface FlowDocBackendDocGenLocalArtifactBindingV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_PDF_EXPORT_V1_SOURCE
    runtimeProfile: "local-integration"
    lane: "backend-admitted-docgen"
    protectedCanonicalRecordOnly: true
    rawPayloadRead: false
    existingArtifactLifecycleReused: true
    defaultApplicationServerMounted: false
    durableGenerationPersistence: false
    productionBinding: false
  }
  policy: VNextPdfExportProductionPolicyV1
  renderer: FlowDocBackendLocalPdfRendererV1
  qualification: FlowDocBackendPdfExportRendererQualificationV1
  admissionResolver: FlowDocBackendPdfExportAdmissionResolverV1
  createWorkflowInput(
    execution: FlowDocBackendPdfExportLocalWorkerExecutionInputV1,
    repositories: FlowDocBackendDocGenLocalArtifactWorkflowRepositoriesV1,
  ): Promise<FlowDocBackendPdfExportWorkflowInputV1>
}

const POLICY: VNextPdfExportProductionPolicyV1 = {
  policyId: "pdf-export-realdoc-e4-local-artifact-policy-v1",
  maxAttempts: 2,
  executionDeadlineMs: 300_000,
  resources: {
    maxPageCount: 32,
    maxPaintCommandCount: 50_000,
    maxGlyphCount: 250_000,
    maxFontAssetCount: 8,
    maxImageAssetCount: 64,
    maxSingleImagePixelCount: 12_000_000,
    maxTotalImagePixelCount: 50_000_000,
    maxOutputByteLength: 10_000_000,
  },
}

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return { severity: "error", code, path, message }
}

function exactIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function sameSource(left: VNextPdfExportSourceIdentityV1, right: VNextPdfExportSourceIdentityV1): boolean {
  return left.documentId === right.documentId
    && left.documentRevision === right.documentRevision
    && left.documentFingerprint === right.documentFingerprint
    && left.sourcePackageId === right.sourcePackageId
    && left.sessionId === right.sessionId
}

function requestFor(input: {
  acceptedAt: string
  exportRequestId: string
  artifactId: string
  source: VNextPdfExportSourceIdentityV1
  measuredDrawContract: ConsumableMeasuredContractV1
}): VNextPdfExportRequestV1 {
  const result = createVNextPdfExportRequestV1({
    exportRequestId: input.exportRequestId,
    artifactId: input.artifactId,
    requestedAt: input.acceptedAt,
    source: input.source,
    measuredDrawContract: input.measuredDrawContract,
  })
  if (result.status !== "ready") throw new Error("DocGen local PDF request creation blocked")
  return result.request
}

function verifyProtectedRecord(record: FlowDocBackendDocGenLocalProtectedAdmissionRecordV1): void {
  const { recordFingerprint, ...recordFacts } = record
  const { receiptFingerprint, ...receiptFacts } = record.receipt
  if (
    recordFingerprint !== fingerprint(recordFacts)
    || receiptFingerprint !== fingerprint(receiptFacts)
    || record.receipt.canonicalInputFingerprint !== fingerprint(record.canonicalInput)
    || record.receipt.canonicalContentFingerprint
      !== createVNextPublishedStructureCanonicalContentFingerprintV1(record.canonicalInput)
    || record.receipt.instance.instanceId !== record.canonicalInput.dataSnapshot.instance.instanceId
    || record.receipt.instance.revision !== record.canonicalInput.dataSnapshot.instance.revision
    || record.receipt.structure.structureId !== record.receipt.instance.structureVersion.structureId
    || record.receipt.structure.structureVersionId !== record.receipt.instance.structureVersion.structureVersionId
    || record.receipt.structure.versionOrdinal !== record.receipt.instance.structureVersion.versionOrdinal
  ) throw new Error("protected DocGen admission record identity drifted")
}

function verifyMaterializedArtifact(
  materializer: FlowDocBackendDocGenLocalArtifactMaterializerV1,
  artifact: FlowDocBackendDocGenLocalMaterializedArtifactV1,
): void {
  const fingerprints = [
    artifact.materializationFingerprint,
    artifact.resolutionFingerprint,
    artifact.measuredPlanFingerprint,
    artifact.measuredBundleFingerprint,
    artifact.artifactInputFingerprint,
    artifact.measuredDrawContract.fingerprint,
  ]
  if (!fingerprints.every((value) => FINGERPRINT.test(value))) {
    throw new Error("DocGen materializer returned an invalid compact fingerprint")
  }
  if (
    artifact.measuredDrawContract.rendererProfileId !== materializer.rendererProfileId
    || artifact.measuredDrawContract.measurementProfileId !== materializer.measurementProfileId
    || artifact.measuredDrawContract.summary.pageCount !== artifact.summary.pageCount
    || artifact.measuredDrawContract.summary.paintCommandCount !== artifact.summary.paintCommandCount
  ) throw new Error("DocGen materializer result does not match its measured contract")

  const fonts = new Map(artifact.fontResources.map((resource) => [resource.fontId, resource]))
  if (fonts.size !== artifact.fontResources.length || fonts.size !== artifact.measuredDrawContract.fontAssets.length) {
    throw new Error("DocGen materializer font resource set is not exact")
  }
  artifact.measuredDrawContract.fontAssets.forEach((asset) => {
    const resource = fonts.get(asset.fontId)
    if (
      resource == null
      || sha256(resource.sourceBytes) !== asset.sha256
      || sha256(resource.subsetBytes) !== resource.subsetSha256
    ) throw new Error(`DocGen materializer font bytes drifted: ${asset.fontId}`)
  })

  const images = new Map(artifact.imageResources.map((resource) => [resource.assetId, resource]))
  if (images.size !== artifact.imageResources.length || images.size !== artifact.measuredDrawContract.imageAssets.length) {
    throw new Error("DocGen materializer image resource set is not exact")
  }
  artifact.measuredDrawContract.imageAssets.forEach((asset) => {
    const resource = images.get(asset.assetId)
    if (resource == null || sha256(resource.bytes) !== asset.sha256) {
      throw new Error(`DocGen materializer image bytes drifted: ${asset.assetId}`)
    }
  })
}

export function createFlowDocBackendDocGenLocalArtifactBindingV1(input: {
  repository: FlowDocBackendDocGenLocalAdmissionRepositoryV1
  assets: FlowDocBackendDocGenTrustedAssetRegistryV1
  materializer: FlowDocBackendDocGenLocalArtifactMaterializerV1
  operationIdFactory?: () => string
  qualifiedAt?: string
}): FlowDocBackendDocGenLocalArtifactBindingV1 {
  if (!FINGERPRINT.test(input.materializer.implementationFingerprint)) {
    throw new Error("DocGen local artifact materializer implementation fingerprint is invalid")
  }
  const operationIdFactory = input.operationIdFactory ?? randomUUID
  const materializedByRecord = new Map<string, Promise<FlowDocBackendDocGenLocalMaterializedArtifactV1>>()
  const materializedByContract = new Map<string, FlowDocBackendDocGenLocalMaterializedArtifactV1>()

  async function materialize(record: FlowDocBackendDocGenLocalProtectedAdmissionRecordV1) {
    verifyProtectedRecord(record)
    const cached = materializedByRecord.get(record.recordFingerprint)
    if (cached != null) return cached
    const pending = (async () => {
      const assets = await input.assets.resolve(record.canonicalInput.mediaSnapshot.registry)
      if (
        assets.status !== "ready"
        || assets.registryFingerprint !== record.receipt.assets.registryFingerprint
        || assets.assetCount !== record.receipt.assets.assetCount
        || assets.verifiedByteCount !== record.receipt.assets.verifiedByteCount
      ) throw new Error("protected DocGen asset identity drifted before materialization")
      const result = await input.materializer.materialize({ record, assets: assets.assets })
      if (result.status !== "ready") throw new Error("trusted DocGen materializer blocked the canonical record")
      verifyMaterializedArtifact(input.materializer, result)
      const retained = structuredClone(result)
      materializedByContract.set(retained.measuredDrawContract.fingerprint, retained)
      return retained
    })()
    materializedByRecord.set(record.recordFingerprint, pending)
    try {
      return await pending
    } catch (error) {
      materializedByRecord.delete(record.recordFingerprint)
      throw error
    }
  }

  const renderer = createFlowDocBackendLocalPdfRendererV1({
    profile: "local-measured-document",
    checkpointEveryPaintCommands: 64,
    resourceResolver: {
      async resolve({ profile, rendererInput }) {
        const artifact = materializedByContract.get(rendererInput.measuredDrawContract.fingerprint)
        if (
          profile !== "local-measured-document"
          || artifact == null
          || artifact.measuredDrawContract.fingerprint
            !== rendererInput.measuredDrawContract.fingerprint
        ) return {
          status: "blocked",
          fontResources: null,
          imageResources: null,
          issues: [{
            code: "docgen-local-pdf-resources-not-bound",
            path: "rendererInput.measuredDrawContract",
            message: "renderer input is not bound to one protected DocGen materialization",
          }],
        }
        return {
          status: "ready",
          fontResources: structuredClone(artifact.fontResources),
          imageResources: structuredClone(artifact.imageResources),
          issues: [],
        }
      },
    },
  })
  const qualificationResult = createFlowDocBackendPdfExportRendererQualificationV1({
    qualificationId: "qualification:pdf-export-realdoc-e4:local-measured-document:v1",
    adapterId: renderer.adapterId,
    adapterVersion: renderer.adapterVersion,
    implementationFingerprint: renderer.implementationFingerprint,
    rendererProfileId: input.materializer.rendererProfileId,
    measurementProfileId: input.materializer.measurementProfileId,
    runtime: flowDocBackendPdfExportCurrentRuntimeIdentityV1(),
    maximumPaintCommandsBetweenChecks: 64,
    minimumCheckpointCount: 2,
    suiteFingerprint: flowDocBackendPdfExportFingerprintV1({
      phase: "PDF-EXPORT-REALDOC-E.4",
      materializerId: input.materializer.materializerId,
      materializerVersion: input.materializer.materializerVersion,
      implementationFingerprint: input.materializer.implementationFingerprint,
    }),
    qualifiedAt: input.qualifiedAt ?? "2026-07-19T00:00:00.000Z",
  })
  if (qualificationResult.status !== "ready") throw new Error("DocGen local renderer qualification is invalid")
  const qualification = qualificationResult.qualification

  async function recordFor(inputRecord: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    documentId: string
  }): Promise<FlowDocBackendDocGenLocalProtectedAdmissionRecordV1 | null> {
    const record = await input.repository.readByInstanceId(inputRecord.documentId)
    if (
      record == null
      || record.scope.tenantId !== inputRecord.identity.tenantId
      || record.scope.principalId !== inputRecord.identity.principalId
    ) return null
    return record
  }

  const admissionResolver: FlowDocBackendPdfExportAdmissionResolverV1 = {
    async resolve(admissionInput) {
      try {
        const record = await recordFor(admissionInput)
        if (record == null) return {
          status: "not-found",
          operationId: null,
          request: null,
          currentSource: null,
          measuredDrawContract: null,
          policy: null,
          issues: [],
        }
        if (record.receipt.instance.revision !== admissionInput.documentRevision) return {
          status: "stale",
          operationId: null,
          request: null,
          currentSource: null,
          measuredDrawContract: null,
          policy: null,
          issues: [issue(
            "docgen-local-pdf-revision-stale", "documentRevision",
            "requested revision does not match the protected DocGen generation",
          )],
        }
        if (!exactIso(admissionInput.acceptedAt)) throw new Error("local clock is invalid")
        const artifact = await materialize(record)
        const suffix = operationIdFactory()
        if (typeof suffix !== "string" || suffix.trim().length === 0 || suffix.length > 200) {
          throw new Error("operation identity factory returned an invalid value")
        }
        const source: VNextPdfExportSourceIdentityV1 = {
          documentId: record.receipt.instance.instanceId,
          documentRevision: record.receipt.instance.revision,
          documentFingerprint: fingerprint({
            recordFingerprint: record.recordFingerprint,
            canonicalInputFingerprint: record.receipt.canonicalInputFingerprint,
            materializer: {
              id: input.materializer.materializerId,
              version: input.materializer.materializerVersion,
              implementationFingerprint: input.materializer.implementationFingerprint,
            },
            artifactInputFingerprint: artifact.artifactInputFingerprint,
          }),
          sourcePackageId: `docgen:${record.admissionId}`,
          sessionId: null,
        }
        const request = requestFor({
          acceptedAt: admissionInput.acceptedAt,
          exportRequestId: `export:docgen-local-e4:${suffix}`,
          artifactId: `artifact:docgen-local-e4:${suffix}`,
          source,
          measuredDrawContract: artifact.measuredDrawContract,
        })
        return {
          status: "ready",
          operationId: `operation:docgen-local-e4:${suffix}`,
          request,
          currentSource: structuredClone(source),
          measuredDrawContract: structuredClone(artifact.measuredDrawContract),
          policy: structuredClone(POLICY),
          issues: [],
        }
      } catch {
        return {
          status: "unavailable",
          operationId: null,
          request: null,
          currentSource: null,
          measuredDrawContract: null,
          policy: null,
          issues: [issue(
            "docgen-local-pdf-admission-unavailable", "admissionResolver",
            "trusted DocGen artifact admission could not be created",
          )],
        }
      }
    },
  }

  return {
    facts: {
      source: FLOWDOC_BACKEND_DOCGEN_LOCAL_PDF_EXPORT_V1_SOURCE,
      runtimeProfile: "local-integration",
      lane: "backend-admitted-docgen",
      protectedCanonicalRecordOnly: true,
      rawPayloadRead: false,
      existingArtifactLifecycleReused: true,
      defaultApplicationServerMounted: false,
      durableGenerationPersistence: false,
      productionBinding: false,
    },
    policy: structuredClone(POLICY),
    renderer,
    qualification,
    admissionResolver,
    async createWorkflowInput(execution, repositories) {
      const operation = execution.operation
      const source = operation.admission.exportIdentity.sourceIdentity
      const record = await recordFor({
        identity: {
          tenantId: operation.scope.tenantId,
          principalId: operation.scope.principalId,
          authenticationId: "authentication:docgen-local-worker",
        },
        documentId: source.documentId,
      })
      if (record == null || record.receipt.instance.revision !== source.documentRevision) {
        throw new Error("durable PDF operation no longer resolves to its protected DocGen generation")
      }
      const artifact = await materialize(record)
      const expectedSource: VNextPdfExportSourceIdentityV1 = {
        documentId: record.receipt.instance.instanceId,
        documentRevision: record.receipt.instance.revision,
        documentFingerprint: fingerprint({
          recordFingerprint: record.recordFingerprint,
          canonicalInputFingerprint: record.receipt.canonicalInputFingerprint,
          materializer: {
            id: input.materializer.materializerId,
            version: input.materializer.materializerVersion,
            implementationFingerprint: input.materializer.implementationFingerprint,
          },
          artifactInputFingerprint: artifact.artifactInputFingerprint,
        }),
        sourcePackageId: `docgen:${record.admissionId}`,
        sessionId: null,
      }
      if (!sameSource(source, expectedSource) || JSON.stringify(operation.admission.policy) !== JSON.stringify(POLICY)) {
        throw new Error("durable PDF operation drifted from its protected DocGen materialization")
      }
      const request = requestFor({
        acceptedAt: operation.acceptedAt,
        exportRequestId: operation.admission.exportIdentity.exportRequestId,
        artifactId: operation.admission.exportIdentity.artifactId,
        source: expectedSource,
        measuredDrawContract: artifact.measuredDrawContract,
      })
      if (request.requestFingerprint !== operation.admission.exportIdentity.requestFingerprint) {
        throw new Error("durable DocGen PDF request could not be reconstructed")
      }
      const executionAt = Date.parse(execution.now())
      if (!Number.isFinite(executionAt)) throw new Error("local worker clock is invalid")
      let rendererClockOffset = 3
      const attempt = execution.attemptNumber ?? execution.lifecycleHead.attemptCount
      const id = (kind: string) => `${kind}:${operation.operationId}:attempt:${attempt}`
      const expectedBeforeRenderRevision = execution.lifecycleHead.status === "claimed"
        && execution.lifecycleHead.checkpoint === "before-handoff"
        ? execution.lifecycleHead.headRevision + 1
        : execution.lifecycleHead.headRevision
      return {
        workflowId: `workflow:${operation.operationId}`,
        operation,
        request,
        currentSource: structuredClone(expectedSource),
        measuredDrawContract: structuredClone(artifact.measuredDrawContract),
        qualification: structuredClone(qualification),
        renderer,
        ...repositories,
        worker: {
          workerId: execution.workerId,
          claimToken: execution.claimToken,
          claimTransitionId: id("claim"),
          claimedAt: execution.lifecycleHead.claim?.claimedAt ?? new Date(executionAt).toISOString(),
          claimExpiresAt: execution.lifecycleHead.claim?.expiresAt
            ?? new Date(executionAt + 180_000).toISOString(),
          beforeHandoffTransitionId: id("before-handoff"),
          beforeHandoffAt: new Date(executionAt + 1).toISOString(),
        },
        rendererAttempt: {
          renderAttemptId: id("render-attempt"),
          completionId: id("render-completion"),
          beforeRenderTransitionId: id("before-render"),
          beforeRenderExpectedHeadRevision: expectedBeforeRenderRevision,
          beforeRenderAt: new Date(executionAt + 2).toISOString(),
          beforePersistTransitionId: id("before-persist"),
          now: () => new Date(executionAt + rendererClockOffset++).toISOString(),
        },
        persistence: {
          persistenceId: `persistence:${operation.operationId}`,
          jobId: `job:${operation.operationId}`,
          layoutProfileId: "layout:pdf-export-realdoc-e4-local:v1",
          persistedAt: new Date(executionAt + 4_000).toISOString(),
        },
        events: {
          renderStartedAt: new Date(executionAt + 1_000).toISOString(),
          renderCompletedAt: new Date(executionAt + 2_000).toISOString(),
          persistStartedAt: new Date(executionAt + 3_000).toISOString(),
          persistCompletedAt: new Date(executionAt + 4_000).toISOString(),
          workflowCompletedAt: new Date(executionAt + 5_000).toISOString(),
        },
      }
    },
  }
}
