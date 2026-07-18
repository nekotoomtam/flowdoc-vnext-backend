import { createHash, randomUUID } from "node:crypto"
import { readFile, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import {
  createVNextPdfExportRequestV1,
  type VNextPdfExportProductionPolicyV1,
  type VNextPdfExportRequestV1,
  type VNextPdfExportSourceIdentityV1,
  type VNextPdfMeasuredDrawContractResultV1,
} from "@flowdoc/vnext-core"
import {
  createFlowDocBackendLocalPdfRendererV1,
  type FlowDocBackendLocalPdfRendererResourceResolverV1,
  type FlowDocBackendLocalPdfRendererV1,
} from "./pdfExportLocalRenderer.js"
import type { FlowDocBackendPdfExportLocalWorkerExecutionInputV1 } from "./pdfExportLocalWorker.js"
import type { FlowDocBackendPdfExportArtifactPersistenceRepositoryV1 } from "./pdfExportArtifactPersistence.js"
import type { FlowDocBackendPdfExportContentAddressedStoreV1 } from "./pdfExportContentAddressedStore.js"
import type { FlowDocBackendPdfExportLifecycleRepositoryV1 } from "./pdfExportLifecycleRepository.js"
import type { FlowDocBackendPdfExportObservabilityRepositoryV1 } from "./pdfExportObservability.js"
import {
  flowDocBackendPdfExportFingerprintV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"
import type { FlowDocBackendPdfExportOperationRepositoryV1 } from "./pdfExportOperationRepository.js"
import {
  createFlowDocBackendPdfExportRendererQualificationV1,
  flowDocBackendPdfExportCurrentRuntimeIdentityV1,
  type FlowDocBackendPdfExportRendererQualificationV1,
} from "./pdfExportRendererQualification.js"
import type {
  FlowDocBackendPdfExportAdmissionResolverV1,
  FlowDocBackendPdfExportAuthenticatedIdentityV1,
} from "./pdfExportRoute.js"
import type { FlowDocBackendPdfExportWorkflowInputV1 } from "./pdfExportWorkflow.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EVIDENCE_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-canonical-evidence" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID =
  "instance-ocr-benchmark-inv_9437125258-2026-07-16" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION = 1 as const
export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH = 1_212_656
export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256 =
  "c4d09f0dfd66e1e3983bc679602fdc7d397de30edcb4f93fac3a0fa0c422960b" as const

const BUNDLE_PATH = "fixtures/pdf-pilot-canonical-report-body-display-list.v1.json"
const BUNDLE_SHA256 = "0635ee177a136263261d0f8c865dc2c5df62071a7ef8feec0c480f2d0fd0d35b"
const REAL_EXPORT_HANDOFF_PATH =
  "packages/pdf-renderer-pilot/fixtures/canonical-report-real-export-handoff.v1.json"
const REAL_EXPORT_HANDOFF_SHA256 = "554702ccf6f54b773f45c09358a70f17b70980504b8d34291f987ab043c674cb"
const SOURCE_BUNDLE_FINGERPRINT = "96c48b7287fc0c5532059cf8ad4ff135df5f07fb63bfe6bf6054e150775a8b67"
const CONTRACT_FINGERPRINT = "sha256:020881c6099d8eec5e73d5558efa0c0d65de67599aa99e82f8cbf9d62e4e6917"
const CONTRACT_CONTENT_FINGERPRINT = "sha256:5f28958947715a3a9bdc006a73688bf8226f782047db5f5c53ffe0349dbd8b78"
const RENDERER_PROFILE_ID = "pdf-pilot-08b-r2c-l-full-document-v1"
const REGULAR_MANIFEST_PATH =
  "packages/pdf-renderer-pilot/fixtures/canonical-full-document-regular-font-subset-manifest.v1.json"
const REGULAR_MANIFEST_SHA256 = "30b89c25e9f32d1e6eae2bd18638c1a6aae4412ca665f1334f4f09bcd984fbde"
const BOLD_MANIFEST_PATH =
  "packages/pdf-renderer-pilot/fixtures/canonical-full-document-bold-font-subset-manifest.v1.json"
const BOLD_MANIFEST_SHA256 = "4a2c3ef79187920d31fcb8703eef60abb7bc42f35bdcec535ecd8404a61ec85e"

const IMAGE_FILES = [
  ["source-evidence-image", "source_evidence.png"],
  ["ocr-accuracy-image", "ocr_accuracy.png"],
  ["native-extraction-image", "native_extraction.png"],
  ["latency-rounds-image", "latency_rounds.png"],
  ["mapping-gap-image", "mapping_gap.png"],
] as const

const POLICY: VNextPdfExportProductionPolicyV1 = {
  policyId: "pdf-export-local-canonical-evidence-policy-v1",
  maxAttempts: 2,
  executionDeadlineMs: 300_000,
  resources: {
    maxPageCount: 20,
    maxPaintCommandCount: 5_000,
    maxGlyphCount: 100_000,
    maxFontAssetCount: 4,
    maxImageAssetCount: 8,
    maxSingleImagePixelCount: 5_000_000,
    maxTotalImagePixelCount: 15_000_000,
    maxOutputByteLength: 5_000_000,
  },
}

interface CanonicalBundleV1 {
  rendererHandoff: {
    measuredDrawContract: VNextPdfMeasuredDrawContractResultV1
  }
}

interface CanonicalFontSubsetManifestV1 {
  subsetId: string
  fontId: string
  postScriptName: string
  subsetPrefix: string
  source: { path: string; sha256: string; bytes: number }
  subset: { path: string; sha256: string; bytes: number }
}

interface CanonicalRealExportHandoffV1 {
  status: "rendered"
  sourceBundleFingerprint: string
  sourceIdentity: VNextPdfExportSourceIdentityV1
  request: {
    expectedSource: VNextPdfExportSourceIdentityV1
    measuredDrawContract: {
      fingerprint: string
      contentFingerprint: string
      rendererProfileId: string
      measurementProfileId: string
      pageCount: number
    }
  }
  renderer: {
    status: "rendered"
    artifact: {
      byteLength: number
      sha256: string
      sourceContractFingerprint: string
    }
  }
}

export interface FlowDocBackendPdfExportLocalCanonicalEvidenceOptionsV1 {
  coreRoot: string
  reportRoot: string
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
  operationIdFactory?: () => string
}

export interface FlowDocBackendPdfExportLocalCanonicalWorkflowRepositoriesV1 {
  operationRepository: FlowDocBackendPdfExportOperationRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilityRepositoryV1
  contentStore: FlowDocBackendPdfExportContentAddressedStoreV1
}

export interface FlowDocBackendPdfExportLocalCanonicalEvidenceV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EVIDENCE_V1_SOURCE
    runtimeProfile: "local-integration"
    lane: "canonical-evidence"
    documentId: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID
    documentRevision: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION
    bundleIdentityFingerprint: string
    measuredContractFingerprint: typeof CONTRACT_FINGERPRINT
    resourceDigestsVerifiedBeforeUse: true
    fixtureSubstitutionAllowed: false
    productDocumentEligibility: false
    expectedPdfByteLength: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH
    expectedPdfSha256: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256
    productionBinding: false
  }
  sourceIdentity: VNextPdfExportSourceIdentityV1
  policy: VNextPdfExportProductionPolicyV1
  renderer: FlowDocBackendLocalPdfRendererV1
  qualification: FlowDocBackendPdfExportRendererQualificationV1
  admissionResolver: FlowDocBackendPdfExportAdmissionResolverV1
  inspectEligibility(input: {
    documentId: string
    documentRevision: number
  }): FlowDocBackendPdfExportLocalEligibilityInspectionV1
  createWorkflowInput(
    execution: FlowDocBackendPdfExportLocalWorkerExecutionInputV1,
    repositories: FlowDocBackendPdfExportLocalCanonicalWorkflowRepositoriesV1,
  ): FlowDocBackendPdfExportWorkflowInputV1
}

export type FlowDocBackendPdfExportLocalEligibilityInspectionV1 =
  | {
      status: "eligible"
      lane: "canonical-evidence"
      reason: null
    }
  | {
      status: "ineligible"
      lane: null
      reason: "unsupported-document"
    }
  | {
      status: "stale"
      lane: null
      reason: "revision-mismatch"
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

function sameIdentity(
  left: FlowDocBackendPdfExportAuthenticatedIdentityV1,
  right: FlowDocBackendPdfExportAuthenticatedIdentityV1,
): boolean {
  return left.tenantId === right.tenantId
    && left.principalId === right.principalId
    && left.authenticationId === right.authenticationId
}

async function resolvedRoot(path: string, label: string): Promise<string> {
  try {
    return await realpath(resolve(path))
  } catch {
    throw new Error(`${label} is unavailable`)
  }
}

async function readInside(root: string, path: string, expectedSha256: string | null): Promise<Uint8Array> {
  const candidate = await realpath(resolve(root, path))
  const fromRoot = relative(root, candidate)
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("canonical PDF evidence path escaped its trusted root")
  }
  const bytes = new Uint8Array(await readFile(candidate))
  if (expectedSha256 != null && sha256(bytes) !== expectedSha256) {
    throw new Error("canonical PDF evidence digest mismatch")
  }
  return bytes
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as T
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
}

function inspectContract(value: VNextPdfMeasuredDrawContractResultV1): asserts value is
VNextPdfMeasuredDrawContractResultV1 & { status: "consumable" } {
  if (
    value.source !== "vnext-pdf-measured-draw-contract"
    || value.contractVersion !== 1
    || value.status !== "consumable"
    || value.fingerprint !== CONTRACT_FINGERPRINT
    || value.rendererProfileId !== RENDERER_PROFILE_ID
    || value.pages?.length !== 13
    || value.fontAssets?.length !== 2
    || value.imageAssets?.length !== 5
    || value.summary?.pageCount !== 13
    || value.summary.paintCommandCount !== 1_814
    || value.contracts.mayRelayout !== false
    || value.execution.productionBinding !== false
  ) throw new Error("canonical measured draw contract does not match the retained LOCAL-E evidence")
}

function inspectManifest(value: CanonicalFontSubsetManifestV1): void {
  if (
    typeof value !== "object"
    || value == null
    || typeof value.subsetId !== "string"
    || typeof value.fontId !== "string"
    || typeof value.postScriptName !== "string"
    || typeof value.subsetPrefix !== "string"
    || typeof value.source?.path !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.source.sha256)
    || !Number.isSafeInteger(value.source.bytes)
    || typeof value.subset?.path !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.subset.sha256)
    || !Number.isSafeInteger(value.subset.bytes)
  ) throw new Error("canonical font subset manifest is invalid")
}

function exactSource(left: VNextPdfExportSourceIdentityV1, right: VNextPdfExportSourceIdentityV1): boolean {
  return left.documentId === right.documentId
    && left.documentRevision === right.documentRevision
    && left.documentFingerprint === right.documentFingerprint
    && left.sourcePackageId === right.sourcePackageId
    && left.sessionId === right.sessionId
}

function requestForOperation(input: {
  operationId: string
  acceptedAt: string
  exportRequestId: string
  artifactId: string
  sourceIdentity: VNextPdfExportSourceIdentityV1
  measuredDrawContract: VNextPdfMeasuredDrawContractResultV1
}): VNextPdfExportRequestV1 {
  const request = createVNextPdfExportRequestV1({
    exportRequestId: input.exportRequestId,
    artifactId: input.artifactId,
    requestedAt: input.acceptedAt,
    source: input.sourceIdentity,
    measuredDrawContract: input.measuredDrawContract,
  })
  if (request.status !== "ready") {
    throw new Error(`canonical PDF export request could not be created for ${input.operationId}`)
  }
  return request.request
}

export async function createFlowDocBackendPdfExportLocalCanonicalEvidenceV1(
  options: FlowDocBackendPdfExportLocalCanonicalEvidenceOptionsV1,
): Promise<FlowDocBackendPdfExportLocalCanonicalEvidenceV1> {
  const coreRoot = await resolvedRoot(options.coreRoot, "FlowDoc Core root")
  const reportRoot = await resolvedRoot(options.reportRoot, "canonical report root")
  const bundleBytes = await readInside(coreRoot, BUNDLE_PATH, BUNDLE_SHA256)
  const bundle = parseJson<CanonicalBundleV1>(bundleBytes, "canonical PDF bundle")
  const measuredDrawContract = structuredClone(bundle.rendererHandoff?.measuredDrawContract)
  inspectContract(measuredDrawContract)

  const realExportHandoff = parseJson<CanonicalRealExportHandoffV1>(
    await readInside(coreRoot, REAL_EXPORT_HANDOFF_PATH, REAL_EXPORT_HANDOFF_SHA256),
    "canonical real export handoff",
  )

  const sourceIdentity: VNextPdfExportSourceIdentityV1 = {
    documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
    documentRevision: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
    documentFingerprint: `sha256:${SOURCE_BUNDLE_FINGERPRINT}`,
    sourcePackageId: "body-display-list:ocr-benchmark-report-body-display-list-v1",
    sessionId: null,
  }
  if (
    realExportHandoff.status !== "rendered"
    || realExportHandoff.sourceBundleFingerprint !== SOURCE_BUNDLE_FINGERPRINT
    || !exactSource(realExportHandoff.sourceIdentity, sourceIdentity)
    || !exactSource(realExportHandoff.request.expectedSource, sourceIdentity)
    || realExportHandoff.request.measuredDrawContract.fingerprint !== CONTRACT_FINGERPRINT
    || realExportHandoff.request.measuredDrawContract.contentFingerprint !== CONTRACT_CONTENT_FINGERPRINT
    || realExportHandoff.request.measuredDrawContract.rendererProfileId !== measuredDrawContract.rendererProfileId
    || realExportHandoff.request.measuredDrawContract.measurementProfileId !== measuredDrawContract.measurementProfileId
    || realExportHandoff.request.measuredDrawContract.pageCount !== 13
    || realExportHandoff.renderer.status !== "rendered"
    || realExportHandoff.renderer.artifact.byteLength
      !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH
    || realExportHandoff.renderer.artifact.sha256
      !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256
    || realExportHandoff.renderer.artifact.sourceContractFingerprint !== CONTRACT_FINGERPRINT
  ) throw new Error("canonical source identity does not match the retained Phase T real export handoff")
  const contractProbe = createVNextPdfExportRequestV1({
    exportRequestId: "export:pdf-local-e:contract-probe",
    artifactId: "artifact:pdf-local-e:contract-probe",
    requestedAt: "2026-07-18T00:00:00.000Z",
    source: sourceIdentity,
    measuredDrawContract,
  })
  if (contractProbe.status !== "ready") {
    throw new Error("canonical measured draw contract failed the current Core handoff contract")
  }
  const expectedContentFingerprint = contractProbe.request.measuredDrawContract.contentFingerprint
  if (expectedContentFingerprint !== CONTRACT_CONTENT_FINGERPRINT) {
    throw new Error("canonical measured contract content drifted from the retained Phase T handoff")
  }

  const manifests = await Promise.all([
    readInside(coreRoot, REGULAR_MANIFEST_PATH, REGULAR_MANIFEST_SHA256)
      .then((bytes) => parseJson<CanonicalFontSubsetManifestV1>(bytes, "canonical regular font manifest")),
    readInside(coreRoot, BOLD_MANIFEST_PATH, BOLD_MANIFEST_SHA256)
      .then((bytes) => parseJson<CanonicalFontSubsetManifestV1>(bytes, "canonical bold font manifest")),
  ])
  const fontResources = await Promise.all(manifests.map(async (manifest) => {
    inspectManifest(manifest)
    const contractAsset = measuredDrawContract.fontAssets.find((asset) => asset.fontId === manifest.fontId)
    if (contractAsset == null || contractAsset.sha256 !== manifest.source.sha256) {
      throw new Error("canonical font manifest does not match the measured contract")
    }
    const [sourceBytes, subsetBytes] = await Promise.all([
      readInside(coreRoot, manifest.source.path, manifest.source.sha256),
      readInside(coreRoot, manifest.subset.path, manifest.subset.sha256),
    ])
    if (sourceBytes.byteLength !== manifest.source.bytes || subsetBytes.byteLength !== manifest.subset.bytes) {
      throw new Error("canonical font byte length does not match its manifest")
    }
    return {
      fontId: manifest.fontId,
      subsetId: manifest.subsetId,
      subsetPrefix: manifest.subsetPrefix,
      postScriptName: manifest.postScriptName,
      subsetSha256: manifest.subset.sha256,
      sourceBytes,
      subsetBytes,
    }
  }))
  const imageResources = await Promise.all(IMAGE_FILES.map(async ([assetId, fileName]) => {
    const contractAsset = measuredDrawContract.imageAssets.find((asset) => asset.assetId === assetId)
    if (contractAsset == null) throw new Error("canonical image is missing from the measured contract")
    const bytes = await readInside(reportRoot, `assets/${fileName}`, contractAsset.sha256)
    return { assetId, bytes }
  }))

  const resourceResolver: FlowDocBackendLocalPdfRendererResourceResolverV1 = {
    async resolve({ profile, rendererInput }) {
      if (
        profile !== "canonical-full-document"
        || rendererInput.sourceContractFingerprint !== CONTRACT_FINGERPRINT
        || rendererInput.sourceContractContentFingerprint !== expectedContentFingerprint
        || rendererInput.measuredDrawContract.fingerprint !== CONTRACT_FINGERPRINT
      ) return {
        status: "blocked",
        fontResources: null,
        imageResources: null,
        issues: [{
          code: "pdf-export-local-canonical-resource-identity-mismatch",
          path: "rendererInput",
          message: "renderer input is not the exact retained canonical evidence contract",
        }],
      }
      return {
        status: "ready",
        fontResources: fontResources.map((resource) => ({
          ...resource,
          sourceBytes: new Uint8Array(resource.sourceBytes),
          subsetBytes: new Uint8Array(resource.subsetBytes),
        })),
        imageResources: imageResources.map((resource) => ({
          ...resource,
          bytes: new Uint8Array(resource.bytes),
        })),
        issues: [],
      }
    },
  }
  const renderer = createFlowDocBackendLocalPdfRendererV1({
    profile: "canonical-full-document",
    resourceResolver,
    checkpointEveryPaintCommands: 64,
  })
  const qualified = createFlowDocBackendPdfExportRendererQualificationV1({
    qualificationId: "qualification:pdf-export-local-e:canonical-full-document:v1",
    adapterId: renderer.adapterId,
    adapterVersion: renderer.adapterVersion,
    implementationFingerprint: renderer.implementationFingerprint,
    rendererProfileId: measuredDrawContract.rendererProfileId,
    measurementProfileId: measuredDrawContract.measurementProfileId,
    runtime: flowDocBackendPdfExportCurrentRuntimeIdentityV1(),
    maximumPaintCommandsBetweenChecks: 64,
    minimumCheckpointCount: 30,
    suiteFingerprint: `sha256:${FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256}`,
    qualifiedAt: "2026-07-18T00:00:00.000Z",
  })
  if (qualified.status !== "ready") throw new Error("canonical local renderer qualification is invalid")

  const operationIdFactory = options.operationIdFactory ?? (() => randomUUID())
  const admissionResolver: FlowDocBackendPdfExportAdmissionResolverV1 = {
    async resolve(input) {
      if (!sameIdentity(input.identity, options.identity)) return {
        status: "rejected",
        operationId: null,
        request: null,
        currentSource: null,
        measuredDrawContract: null,
        policy: null,
        issues: [issue(
          "pdf-export-local-canonical-identity-rejected",
          "identity",
          "authenticated identity is not the local canonical evidence owner",
        )],
      }
      if (input.documentId !== sourceIdentity.documentId) return {
        status: "not-found",
        operationId: null,
        request: null,
        currentSource: null,
        measuredDrawContract: null,
        policy: null,
        issues: [],
      }
      if (input.documentRevision !== sourceIdentity.documentRevision) return {
        status: "stale",
        operationId: null,
        request: null,
        currentSource: null,
        measuredDrawContract: null,
        policy: null,
        issues: [issue(
          "pdf-export-local-canonical-revision-stale",
          "documentRevision",
          "requested revision is not the retained canonical evidence revision",
        )],
      }
      if (!exactIso(input.acceptedAt)) return {
        status: "unavailable",
        operationId: null,
        request: null,
        currentSource: null,
        measuredDrawContract: null,
        policy: null,
        issues: [issue("pdf-export-local-canonical-clock-invalid", "acceptedAt", "local clock is invalid")],
      }
      try {
        const suffix = operationIdFactory()
        if (typeof suffix !== "string" || suffix.trim().length === 0 || suffix.length > 200) {
          throw new Error("operation identity factory returned an invalid value")
        }
        const operationId = `operation:pdf-local-e:${suffix}`
        const request = requestForOperation({
          operationId,
          acceptedAt: input.acceptedAt,
          exportRequestId: `export:pdf-local-e:${suffix}`,
          artifactId: `artifact:pdf-local-e:${suffix}`,
          sourceIdentity,
          measuredDrawContract,
        })
        return {
          status: "ready",
          operationId,
          request,
          currentSource: structuredClone(sourceIdentity),
          measuredDrawContract: structuredClone(measuredDrawContract),
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
            "pdf-export-local-canonical-admission-unavailable",
            "admissionResolver",
            "trusted canonical admission could not be created",
          )],
        }
      }
    },
  }

  return {
    facts: {
      source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EVIDENCE_V1_SOURCE,
      runtimeProfile: "local-integration",
      lane: "canonical-evidence",
      documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
      documentRevision: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
      bundleIdentityFingerprint: flowDocBackendPdfExportFingerprintV1({
        bundleSha256: BUNDLE_SHA256,
        realExportHandoffSha256: REAL_EXPORT_HANDOFF_SHA256,
        sourceBundleFingerprint: SOURCE_BUNDLE_FINGERPRINT,
      }),
      measuredContractFingerprint: CONTRACT_FINGERPRINT,
      resourceDigestsVerifiedBeforeUse: true,
      fixtureSubstitutionAllowed: false,
      productDocumentEligibility: false,
      expectedPdfByteLength: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH,
      expectedPdfSha256: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256,
      productionBinding: false,
    },
    sourceIdentity: structuredClone(sourceIdentity),
    policy: structuredClone(POLICY),
    renderer,
    qualification: qualified.qualification,
    admissionResolver,
    inspectEligibility(input) {
      if (input.documentId !== sourceIdentity.documentId) return {
        status: "ineligible",
        lane: null,
        reason: "unsupported-document",
      }
      if (input.documentRevision !== sourceIdentity.documentRevision) return {
        status: "stale",
        lane: null,
        reason: "revision-mismatch",
      }
      return { status: "eligible", lane: "canonical-evidence", reason: null }
    },
    createWorkflowInput(execution, repositories) {
      const operation = execution.operation
      const admittedSource = operation.admission.exportIdentity.sourceIdentity
      if (
        !exactSource(admittedSource, sourceIdentity)
        || operation.scope.tenantId !== options.identity.tenantId
        || operation.scope.principalId !== options.identity.principalId
        || operation.admission.exportIdentity.sourceContractFingerprint !== CONTRACT_FINGERPRINT
        || operation.admission.exportIdentity.sourceContractContentFingerprint !== expectedContentFingerprint
        || JSON.stringify(operation.admission.policy) !== JSON.stringify(POLICY)
      ) throw new Error("durable operation is not the exact admitted canonical evidence operation")
      const request = requestForOperation({
        operationId: operation.operationId,
        acceptedAt: operation.acceptedAt,
        exportRequestId: operation.admission.exportIdentity.exportRequestId,
        artifactId: operation.admission.exportIdentity.artifactId,
        sourceIdentity,
        measuredDrawContract,
      })
      if (request.requestFingerprint !== operation.admission.exportIdentity.requestFingerprint) {
        throw new Error("durable canonical request fingerprint could not be reconstructed")
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
        currentSource: structuredClone(sourceIdentity),
        measuredDrawContract: structuredClone(measuredDrawContract),
        qualification: structuredClone(qualified.qualification),
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
          layoutProfileId: "layout:pdf-export-local-canonical-evidence:v1",
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
