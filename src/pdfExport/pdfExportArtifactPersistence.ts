import { createHash } from "node:crypto"
import {
  advanceVNextArtifactJob,
  createVNextArtifactJobPlan,
  createVNextArtifactManifestPlan,
  type VNextArtifactJobRecord,
  type VNextArtifactManifestRecord,
  type VNextPdfExportProductionRenderCompletionV1,
  type VNextPdfExportReceiptV1,
} from "@flowdoc/vnext-core"
import type {
  FlowDocBackendPdfExportContentAddressedStoreV1,
  FlowDocBackendPdfExportResumableContentAddressedStoreV1,
  FlowDocBackendPdfExportStoredContentV1,
} from "./pdfExportContentAddressedStore.js"
import {
  parseFlowDocBackendPdfExportLifecycleHeadV1,
  type FlowDocBackendPdfExportLifecycleHeadV1,
} from "./pdfExportLifecycle.js"
import type { FlowDocBackendPdfExportLifecycleRepositoryV1 } from "./pdfExportLifecycleRepository.js"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  isFlowDocBackendPdfExportRecordV1,
  parseFlowDocBackendPdfExportOperationV1,
  type FlowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_ATTEMPT_V1_SOURCE,
  type FlowDocBackendPdfExportRendererAttemptResultV1,
} from "./pdfExportRendererAttempt.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE =
  "flowdoc-backend-pdf-export-artifact-persistence" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_REPOSITORY_V1_SOURCE =
  "flowdoc-backend-pdf-export-artifact-persistence-repository" as const

const SHA256 = /^[a-f0-9]{64}$/u
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

export interface FlowDocBackendPdfExportArtifactPersistenceReceiptV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-artifact-persistence-receipt"
  persistenceId: string
  scope: {
    tenantId: string
    principalId: string
  }
  operationId: string
  operationFingerprint: string
  renderAttemptId: string
  renderExecutionFingerprint: string
  core: {
    receipt: VNextPdfExportReceiptV1
    completion: VNextPdfExportProductionRenderCompletionV1
  }
  bytes: {
    storageKey: string
    byteLength: number
    sha256: string
    mediaType: "application/pdf"
    readAfterWriteVerified: true
    verifiedAt: string
  }
  projection: {
    projectionFingerprint: string
    manifestRevision: 0
    jobRevision: 0
    manifest: VNextArtifactManifestRecord
    job: VNextArtifactJobRecord
  }
  committedAt: string
  contracts: {
    contentAddressedBytes: true
    readAfterWriteVerified: true
    manifestBeforeJob: true
    atomicManifestJobCas: true
    terminalReplayRetained: true
    lifecycleCompletionMutation: false
    observabilityWrites: false
    backendRoute: false
    authzExecution: false
    concreteProductionRendererSelected: false
    productionBinding: false
  }
  persistenceReceiptFingerprint: string
}

export interface FlowDocBackendPdfExportArtifactProjectionRequestV1 {
  persistenceId: string
  operation: FlowDocBackendPdfExportOperationV1
  rendererAttempt: Extract<FlowDocBackendPdfExportRendererAttemptResultV1, { status: "ready-for-persistence" }>
  storedContent: FlowDocBackendPdfExportStoredContentV1
  manifest: VNextArtifactManifestRecord
  job: VNextArtifactJobRecord
  expectedManifestRevision: null
  expectedJobRevision: null
  committedAt: string
  projectionFingerprint: string
}

export type FlowDocBackendPdfExportArtifactProjectionCommitResultV1 =
  | {
      status: "committed" | "idempotent-replay"
      receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1
      issues: []
    }
  | {
      status: "conflict" | "invalid" | "storage-unavailable"
      receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportArtifactPersistenceReadResultV1 =
  | {
      status: "found"
      receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1
      issues: []
    }
  | { status: "not-found"; receipt: null; issues: [] }
  | {
      status: "invalid" | "storage-unavailable"
      receipt: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportStorageReferenceResultV1 =
  | { status: "referenced" | "unreferenced"; issues: [] }
  | { status: "invalid" | "storage-unavailable"; issues: FlowDocBackendPdfExportOperationIssueV1[] }

export interface FlowDocBackendPdfExportArtifactPersistenceRepositoryV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_REPOSITORY_V1_SOURCE
  commitProjection(
    request: FlowDocBackendPdfExportArtifactProjectionRequestV1,
  ): Promise<FlowDocBackendPdfExportArtifactProjectionCommitResultV1>
  readByOperationId(input: {
    tenantId: string
    principalId: string
    operationId: string
  }): Promise<FlowDocBackendPdfExportArtifactPersistenceReadResultV1>
  inspectStorageReference(input: {
    storageKey: string
  }): Promise<FlowDocBackendPdfExportStorageReferenceResultV1>
}

export interface FlowDocBackendPdfExportArtifactPersistenceInputV1 {
  persistenceId: string
  jobId: string
  layoutProfileId: string
  persistedAt: string
  claimToken: string
  operation: unknown
  rendererAttempt: unknown
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  contentStore: FlowDocBackendPdfExportContentAddressedStoreV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
}

export type FlowDocBackendPdfExportArtifactPersistenceResultV1 =
  | {
      source: typeof FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE
      status: "persisted" | "idempotent-replay"
      receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1
      orphanCandidateStorageKey: null
      issues: []
      contracts: ReturnType<typeof resultContracts>
    }
  | {
      source: typeof FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE
      status: "blocked"
      receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null
      orphanCandidateStorageKey: string | null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
      contracts: ReturnType<typeof resultContracts>
    }

export interface FlowDocBackendPdfExportOrphanReconciliationResultV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE
  status: "completed" | "blocked"
  scannedCount: number
  candidateCount: number
  referencedCount: number
  deletedStorageKeys: string[]
  retainedStorageKeys: string[]
  truncated: boolean
  issues: FlowDocBackendPdfExportOperationIssueV1[]
  contracts: {
    gracePeriodRequired: true
    boundedScan: true
    boundedDelete: true
    referenceRecheckedBeforeDelete: true
    contentBytesInResult: false
    manifestMutation: false
    jobMutation: false
    backendRoute: false
    productionBinding: false
  }
}

export interface FlowDocBackendPdfExportResumableOrphanReconciliationResultV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE
  status: "completed" | "blocked"
  inputCursor: string | null
  nextCursor: string | null
  scannedCount: number
  candidateCount: number
  referencedCount: number
  deletedStorageKeys: string[]
  retainedStorageKeys: string[]
  truncated: boolean
  issues: FlowDocBackendPdfExportOperationIssueV1[]
  contracts: {
    gracePeriodRequired: true
    boundedScan: true
    boundedDelete: true
    resumableScanCursor: true
    laterPrefixesCanAdvance: true
    referenceRecheckedBeforeDelete: true
    contentBytesInResult: false
    manifestMutation: false
    jobMutation: false
    backendRoute: false
    productionBinding: false
  }
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function resultContracts() {
  return {
    acceptsValidatedRendererAttemptOnly: true as const,
    contentAddressedByteWrites: true as const,
    readAfterWriteVerification: true as const,
    manifestJobCas: true as const,
    terminalReplay: true as const,
    orphanRecovery: true as const,
    lifecycleCompletionMutation: false as const,
    observabilityWrites: false as const,
    backendRoute: false as const,
    authzExecution: false as const,
    concreteProductionRendererSelected: false as const,
    productionBinding: false as const,
  }
}

function coreFingerprintMatches(value: unknown, key: "receiptFingerprint" | "completionFingerprint"): boolean {
  if (!isFlowDocBackendPdfExportRecordV1(value) || !FINGERPRINT.test(String(value[key]))) return false
  const facts = Object.fromEntries(Object.entries(value).filter(([field]) => field !== key))
  return flowDocBackendPdfExportFingerprintV1(facts) === value[key]
}

function rendererExecutionFingerprint(
  attempt: Extract<FlowDocBackendPdfExportRendererAttemptResultV1, { status: "ready-for-persistence" }>,
): string {
  return flowDocBackendPdfExportFingerprintV1({
    renderAttemptId: attempt.renderAttemptId,
    operationId: attempt.operationId,
    status: attempt.status,
    qualificationFingerprint: attempt.qualificationFingerprint,
    handoffFingerprint: attempt.handoffFingerprint,
    lifecycleFingerprint: attempt.lifecycleHead!.lifecycleFingerprint,
    renderer: attempt.renderer,
    receiptFingerprint: attempt.receipt.receiptFingerprint,
    completionFingerprint: attempt.completion.completionFingerprint,
    issueCodes: [],
  })
}

function inspectRendererAttempt(input: {
  operation: FlowDocBackendPdfExportOperationV1
  value: unknown
}): {
  attempt: Extract<FlowDocBackendPdfExportRendererAttemptResultV1, { status: "ready-for-persistence" }> | null
  issues: FlowDocBackendPdfExportOperationIssueV1[]
} {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (!isFlowDocBackendPdfExportRecordV1(input.value)) return {
    attempt: null,
    issues: [issue("pdf-export-persistence-renderer-attempt-invalid", "rendererAttempt", "renderer attempt must be an object")],
  }
  const value = input.value as unknown as Extract<FlowDocBackendPdfExportRendererAttemptResultV1, { status: "ready-for-persistence" }>
  if (
    value.source !== FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_ATTEMPT_V1_SOURCE
    || value.contractVersion !== 1
    || value.kind !== "pdf-export-renderer-attempt"
    || value.status !== "ready-for-persistence"
  ) issues.push(issue("pdf-export-persistence-renderer-attempt-status-invalid", "rendererAttempt.status", "V-E requires an exact V-D ready-for-persistence result"))
  if (value.operationId !== input.operation.operationId) issues.push(issue("pdf-export-persistence-operation-mismatch", "rendererAttempt.operationId", "renderer attempt must belong to the exact operation"))
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength <= 0) issues.push(issue("pdf-export-persistence-bytes-invalid", "rendererAttempt.bytes", "ready renderer attempt must carry non-empty bytes"))
  if (!isFlowDocBackendPdfExportRecordV1(value.receipt) || !coreFingerprintMatches(value.receipt, "receiptFingerprint")) {
    issues.push(issue("pdf-export-persistence-core-receipt-invalid", "rendererAttempt.receipt", "Core render receipt fingerprint must be exact"))
  }
  if (!isFlowDocBackendPdfExportRecordV1(value.completion) || !coreFingerprintMatches(value.completion, "completionFingerprint")) {
    issues.push(issue("pdf-export-persistence-core-completion-invalid", "rendererAttempt.completion", "Core render completion fingerprint must be exact"))
  }
  const parsedHead = parseFlowDocBackendPdfExportLifecycleHeadV1(value.lifecycleHead)
  if (parsedHead.status === "blocked") issues.push(...parsedHead.issues)
  else if (
    parsedHead.head.status !== "claimed"
    || parsedHead.head.checkpoint !== "before-persist"
    || parsedHead.head.checkpointCheck == null
  ) issues.push(issue("pdf-export-persistence-lifecycle-not-ready", "rendererAttempt.lifecycleHead", "V-E requires a claimed before-persist head with a retained checkpoint check"))

  if (issues.length > 0 || !(value.bytes instanceof Uint8Array)) return { attempt: null, issues }
  const digest = sha256(value.bytes)
  const admission = input.operation.admission
  const receipt = value.receipt
  const completion = value.completion
  const artifactMatches = receipt.artifact.artifactId === admission.exportIdentity.artifactId
    && completion.artifact.artifactId === receipt.artifact.artifactId
    && receipt.artifact.format === "pdf"
    && receipt.artifact.mediaType === "application/pdf"
    && receipt.artifact.byteLength === value.bytes.byteLength
    && completion.artifact.byteLength === value.bytes.byteLength
    && receipt.artifact.sha256 === digest
    && completion.artifact.sha256 === digest
    && value.renderer.byteLength === value.bytes.byteLength
    && value.renderer.sha256 === digest
  if (!artifactMatches) issues.push(issue("pdf-export-persistence-byte-evidence-mismatch", "rendererAttempt", "bytes, renderer, receipt, completion, and admission must share one artifact identity"))
  if (
    receipt.exportRequestId !== admission.exportIdentity.exportRequestId
    || receipt.requestFingerprint !== admission.exportIdentity.requestFingerprint
    || receipt.handoffFingerprint !== admission.exportIdentity.handoffFingerprint
    || receipt.receiptFingerprint !== completion.exportIdentity.receiptFingerprint
    || completion.admissionFingerprint !== admission.admissionFingerprint
    || completion.idempotencyPayloadFingerprint !== input.operation.idempotency.payloadFingerprint
    || completion.exportIdentity.rendererProfileId !== admission.exportIdentity.rendererProfileId
    || completion.exportIdentity.measurementProfileId !== admission.exportIdentity.measurementProfileId
  ) issues.push(issue("pdf-export-persistence-core-binding-mismatch", "rendererAttempt", "Core receipt and completion must retain the exact admitted export binding"))
  if (
    value.contracts.exactCoreReceipt !== true
    || value.contracts.exactCoreRenderCompletion !== true
    || value.contracts.storageWrites !== false
    || value.contracts.artifactProjection !== false
    || value.contracts.productionBinding !== false
  ) issues.push(issue("pdf-export-persistence-v-d-contract-invalid", "rendererAttempt.contracts", "renderer attempt must retain the exact non-persisting V-D contracts"))
  if (rendererExecutionFingerprint(value) !== value.executionFingerprint) issues.push(issue("pdf-export-persistence-renderer-fingerprint-invalid", "rendererAttempt.executionFingerprint", "renderer attempt execution fingerprint must be exact"))
  return issues.length === 0 ? { attempt: value, issues: [] } : { attempt: null, issues }
}

function advanceJob(
  job: VNextArtifactJobRecord,
  command: Parameters<typeof advanceVNextArtifactJob>[1],
): VNextArtifactJobRecord | FlowDocBackendPdfExportOperationIssueV1[] {
  const advanced = advanceVNextArtifactJob(job, command)
  return advanced.status === "advanced"
    ? advanced.job
    : advanced.issues.map((entry) => issue(entry.code, `artifactJob.${entry.path}`, entry.message))
}

function createProjectionRecords(input: {
  jobId: string
  layoutProfileId: string
  persistedAt: string
  attempt: Extract<FlowDocBackendPdfExportRendererAttemptResultV1, { status: "ready-for-persistence" }>
  content: FlowDocBackendPdfExportStoredContentV1
}): { manifest: VNextArtifactManifestRecord; job: VNextArtifactJobRecord } | FlowDocBackendPdfExportOperationIssueV1[] {
  const receipt = input.attempt.receipt
  const manifestPlan = createVNextArtifactManifestPlan({
    artifactId: receipt.artifact.artifactId,
    sourcePackageId: receipt.sourceIdentity.sourcePackageId,
    sessionId: receipt.sourceIdentity.sessionId,
    jobId: input.jobId,
    rendererProfileId: receipt.rendererProfileId,
    measurementProfileId: receipt.measurementProfileId,
    format: "pdf",
    mediaType: "application/pdf",
    byteLength: input.content.byteLength,
    sha256: input.content.sha256,
    storageKey: input.content.storageKey,
    createdAt: input.persistedAt,
    status: "rendered",
    error: null,
  })
  if (manifestPlan.status !== "ready" || manifestPlan.record == null) return manifestPlan.issues.map((entry) => issue(
    entry.code, `artifactManifest.${entry.path}`, entry.message,
  ))
  const jobPlan = createVNextArtifactJobPlan({
    jobId: input.jobId,
    artifactId: receipt.artifact.artifactId,
    sourcePackageId: receipt.sourceIdentity.sourcePackageId,
    sessionId: receipt.sourceIdentity.sessionId,
    layoutProfileId: input.layoutProfileId,
    measurementProfileId: receipt.measurementProfileId,
    rendererProfileId: receipt.rendererProfileId,
    format: "pdf",
    mediaType: "application/pdf",
    createdAt: input.persistedAt,
  })
  if (jobPlan.status !== "ready" || jobPlan.job == null) return jobPlan.issues.map((entry) => issue(
    entry.code, `artifactJob.${entry.path}`, entry.message,
  ))
  let job: VNextArtifactJobRecord | FlowDocBackendPdfExportOperationIssueV1[] = jobPlan.job
  for (const command of [
    { action: "start-layout", updatedAt: input.persistedAt },
    { action: "complete-layout", updatedAt: input.persistedAt },
    { action: "start-rendering", updatedAt: input.persistedAt },
    { action: "complete-render", updatedAt: input.persistedAt, artifactManifest: manifestPlan.record },
  ] as const) {
    if (Array.isArray(job)) return job
    job = advanceJob(job, command)
  }
  return Array.isArray(job) ? job : { manifest: manifestPlan.record, job }
}

export function calculateFlowDocBackendPdfExportArtifactProjectionFingerprintV1(input: {
  operation: FlowDocBackendPdfExportOperationV1
  attempt: Extract<FlowDocBackendPdfExportRendererAttemptResultV1, { status: "ready-for-persistence" }>
  content: FlowDocBackendPdfExportStoredContentV1
  manifest: VNextArtifactManifestRecord
  job: VNextArtifactJobRecord
  committedAt: string
}): string {
  return flowDocBackendPdfExportFingerprintV1({
    operationFingerprint: input.operation.operationFingerprint,
    renderExecutionFingerprint: input.attempt.executionFingerprint,
    receiptFingerprint: input.attempt.receipt.receiptFingerprint,
    completionFingerprint: input.attempt.completion.completionFingerprint,
    storageKey: input.content.storageKey,
    byteLength: input.content.byteLength,
    sha256: input.content.sha256,
    manifest: input.manifest,
    job: input.job,
    committedAt: input.committedAt,
  })
}

export function createFlowDocBackendPdfExportArtifactPersistenceReceiptV1(
  request: FlowDocBackendPdfExportArtifactProjectionRequestV1,
): FlowDocBackendPdfExportArtifactPersistenceReceiptV1 {
  const facts = {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    contractVersion: 1 as const,
    kind: "pdf-export-artifact-persistence-receipt" as const,
    persistenceId: request.persistenceId,
    scope: cloneFlowDocBackendPdfExportJsonV1(request.operation.scope),
    operationId: request.operation.operationId,
    operationFingerprint: request.operation.operationFingerprint,
    renderAttemptId: request.rendererAttempt.renderAttemptId,
    renderExecutionFingerprint: request.rendererAttempt.executionFingerprint,
    core: {
      receipt: cloneFlowDocBackendPdfExportJsonV1(request.rendererAttempt.receipt),
      completion: cloneFlowDocBackendPdfExportJsonV1(request.rendererAttempt.completion),
    },
    bytes: {
      storageKey: request.storedContent.storageKey,
      byteLength: request.storedContent.byteLength,
      sha256: request.storedContent.sha256,
      mediaType: "application/pdf" as const,
      readAfterWriteVerified: true as const,
      verifiedAt: request.committedAt,
    },
    projection: {
      projectionFingerprint: request.projectionFingerprint,
      manifestRevision: 0 as const,
      jobRevision: 0 as const,
      manifest: cloneFlowDocBackendPdfExportJsonV1(request.manifest),
      job: cloneFlowDocBackendPdfExportJsonV1(request.job),
    },
    committedAt: request.committedAt,
    contracts: {
      contentAddressedBytes: true as const,
      readAfterWriteVerified: true as const,
      manifestBeforeJob: true as const,
      atomicManifestJobCas: true as const,
      terminalReplayRetained: true as const,
      lifecycleCompletionMutation: false as const,
      observabilityWrites: false as const,
      backendRoute: false as const,
      authzExecution: false as const,
      concreteProductionRendererSelected: false as const,
      productionBinding: false as const,
    },
  }
  return {
    ...facts,
    persistenceReceiptFingerprint: flowDocBackendPdfExportFingerprintV1(facts),
  }
}

export function parseFlowDocBackendPdfExportArtifactPersistenceReceiptV1(
  value: unknown,
): { status: "ready"; receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1; issues: [] }
  | { status: "blocked"; receipt: null; issues: FlowDocBackendPdfExportOperationIssueV1[] } {
  if (!isFlowDocBackendPdfExportRecordV1(value)) return {
    status: "blocked",
    receipt: null,
    issues: [issue("pdf-export-persistence-receipt-invalid", "receipt", "persistence receipt must be an object")],
  }
  const receipt = value as unknown as FlowDocBackendPdfExportArtifactPersistenceReceiptV1
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (
    receipt.source !== FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE
    || receipt.contractVersion !== 1
    || receipt.kind !== "pdf-export-artifact-persistence-receipt"
    || !isFlowDocBackendPdfExportBoundedStringV1(receipt.persistenceId)
    || !isFlowDocBackendPdfExportBoundedStringV1(receipt.operationId)
    || !isFlowDocBackendPdfExportBoundedStringV1(receipt.renderAttemptId)
    || !FINGERPRINT.test(receipt.operationFingerprint)
    || !FINGERPRINT.test(receipt.renderExecutionFingerprint)
    || !exactIso(receipt.committedAt)
  ) issues.push(issue("pdf-export-persistence-receipt-shape-invalid", "receipt", "persistence receipt identity and time fields must be exact"))
  if (
    !isFlowDocBackendPdfExportRecordV1(receipt.scope)
    || !isFlowDocBackendPdfExportBoundedStringV1(receipt.scope.tenantId)
    || !isFlowDocBackendPdfExportBoundedStringV1(receipt.scope.principalId)
  ) issues.push(issue("pdf-export-persistence-receipt-scope-invalid", "scope", "persistence receipt scope must retain bounded tenant and principal identities"))
  if (
    !coreFingerprintMatches(receipt.core?.receipt, "receiptFingerprint")
    || !coreFingerprintMatches(receipt.core?.completion, "completionFingerprint")
  ) issues.push(issue("pdf-export-persistence-receipt-core-invalid", "core", "retained Core receipt and completion fingerprints must be exact"))
  if (receipt.projection?.manifestRevision !== 0 || receipt.projection?.jobRevision !== 0) issues.push(issue(
    "pdf-export-persistence-receipt-revision-invalid",
    "projection",
    "V-E terminal projection must retain revision-zero manifest and job CAS facts",
  ))
  const manifestPlan = createVNextArtifactManifestPlan(receipt.projection?.manifest)
  if (manifestPlan.status !== "ready" || manifestPlan.record == null) issues.push(issue("pdf-export-persistence-manifest-invalid", "projection.manifest", "retained rendered manifest must satisfy the Core contract"))
  if (
    receipt.projection?.job?.status !== "rendered"
    || receipt.projection.job.artifactManifest == null
    || JSON.stringify(receipt.projection.job.artifactManifest) !== JSON.stringify(receipt.projection.manifest)
  ) issues.push(issue("pdf-export-persistence-job-invalid", "projection.job", "retained job must be rendered and own the exact manifest"))
  if (
    receipt.bytes?.storageKey !== receipt.projection?.manifest?.storageKey
    || receipt.bytes?.byteLength !== receipt.projection?.manifest?.byteLength
    || receipt.bytes?.sha256 !== receipt.projection?.manifest?.sha256
    || receipt.bytes?.readAfterWriteVerified !== true
    || !SHA256.test(receipt.bytes?.sha256 ?? "")
  ) issues.push(issue("pdf-export-persistence-byte-projection-mismatch", "bytes", "retained bytes and manifest must share exact verified evidence"))
  const { persistenceReceiptFingerprint: _fingerprint, ...facts } = receipt
  if (flowDocBackendPdfExportFingerprintV1(facts) !== receipt.persistenceReceiptFingerprint) issues.push(issue(
    "pdf-export-persistence-receipt-fingerprint-invalid",
    "persistenceReceiptFingerprint",
    "persistence receipt fingerprint must match its exact retained facts",
  ))
  return issues.length === 0
    ? { status: "ready", receipt: cloneFlowDocBackendPdfExportJsonV1(receipt), issues: [] }
    : { status: "blocked", receipt: null, issues }
}

function commitConflict(message: string, receipt: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null = null): FlowDocBackendPdfExportArtifactProjectionCommitResultV1 {
  return {
    status: "conflict",
    receipt: receipt == null ? null : cloneFlowDocBackendPdfExportJsonV1(receipt),
    issues: [issue("pdf-export-persistence-cas-conflict", "projection", message)],
  }
}

export function createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1():
FlowDocBackendPdfExportArtifactPersistenceRepositoryV1 {
  const receiptByOperationId = new Map<string, FlowDocBackendPdfExportArtifactPersistenceReceiptV1>()
  const operationIdByPersistenceId = new Map<string, string>()
  const operationIdByArtifactId = new Map<string, string>()
  const operationIdByJobId = new Map<string, string>()

  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_REPOSITORY_V1_SOURCE,

    async commitProjection(request) {
      if (request.expectedManifestRevision !== null || request.expectedJobRevision !== null) return {
        status: "invalid",
        receipt: null,
        issues: [issue("pdf-export-persistence-cas-revision-invalid", "expectedRevision", "V-E creates manifest and job from an absent CAS revision")],
      }
      const expectedProjection = calculateFlowDocBackendPdfExportArtifactProjectionFingerprintV1({
        operation: request.operation,
        attempt: request.rendererAttempt,
        content: request.storedContent,
        manifest: request.manifest,
        job: request.job,
        committedAt: request.committedAt,
      })
      if (expectedProjection !== request.projectionFingerprint) return {
        status: "invalid",
        receipt: null,
        issues: [issue("pdf-export-persistence-projection-fingerprint-invalid", "projectionFingerprint", "projection fingerprint must bind exact bytes, manifest, and job")],
      }
      const persistenceOwner = operationIdByPersistenceId.get(request.persistenceId)
      if (persistenceOwner != null && persistenceOwner !== request.operation.operationId) return commitConflict("persistence id is already owned by another operation")
      const existing = receiptByOperationId.get(request.operation.operationId)
      if (existing != null) {
        if (existing.projection.projectionFingerprint === request.projectionFingerprint) return {
          status: "idempotent-replay",
          receipt: cloneFlowDocBackendPdfExportJsonV1(existing),
          issues: [],
        }
        return commitConflict("operation already owns a different terminal artifact projection", existing)
      }
      if (operationIdByArtifactId.has(request.manifest.artifactId)) return commitConflict("artifact id is already owned by another operation")
      if (operationIdByJobId.has(request.job.jobId)) return commitConflict("job id is already owned by another operation")
      const receipt = createFlowDocBackendPdfExportArtifactPersistenceReceiptV1(request)
      receiptByOperationId.set(request.operation.operationId, cloneFlowDocBackendPdfExportJsonV1(receipt))
      operationIdByPersistenceId.set(request.persistenceId, request.operation.operationId)
      operationIdByArtifactId.set(request.manifest.artifactId, request.operation.operationId)
      operationIdByJobId.set(request.job.jobId, request.operation.operationId)
      return { status: "committed", receipt, issues: [] }
    },

    async readByOperationId(input) {
      if (
        !isFlowDocBackendPdfExportBoundedStringV1(input.tenantId)
        || !isFlowDocBackendPdfExportBoundedStringV1(input.principalId)
        || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)
      ) return {
        status: "invalid",
        receipt: null,
        issues: [issue("pdf-export-persistence-read-invalid", "operationId", "persistence read scope must be bounded")],
      }
      const receipt = receiptByOperationId.get(input.operationId)
      if (receipt == null || receipt.scope.tenantId !== input.tenantId || receipt.scope.principalId !== input.principalId) {
        return { status: "not-found", receipt: null, issues: [] }
      }
      return { status: "found", receipt: cloneFlowDocBackendPdfExportJsonV1(receipt), issues: [] }
    },

    async inspectStorageReference(input) {
      if (typeof input.storageKey !== "string" || input.storageKey.trim().length === 0) return {
        status: "invalid",
        issues: [issue("pdf-export-persistence-storage-key-invalid", "storageKey", "storage reference lookup requires a non-empty key")],
      }
      const referenced = [...receiptByOperationId.values()].some((receipt) => receipt.bytes.storageKey === input.storageKey)
      return { status: referenced ? "referenced" : "unreferenced", issues: [] }
    },
  }
}

function blockedResult(input: {
  issues: FlowDocBackendPdfExportOperationIssueV1[]
  receipt?: FlowDocBackendPdfExportArtifactPersistenceReceiptV1 | null
  orphanCandidateStorageKey?: string | null
}): FlowDocBackendPdfExportArtifactPersistenceResultV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    status: "blocked",
    receipt: input.receipt ?? null,
    orphanCandidateStorageKey: input.orphanCandidateStorageKey ?? null,
    issues: input.issues,
    contracts: resultContracts(),
  }
}

export async function persistFlowDocBackendPdfExportArtifactV1(
  input: FlowDocBackendPdfExportArtifactPersistenceInputV1,
): Promise<FlowDocBackendPdfExportArtifactPersistenceResultV1> {
  const inputIssues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.persistenceId)) inputIssues.push(issue("pdf-export-persistence-id-invalid", "persistenceId", "persistence id must be bounded"))
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.jobId)) inputIssues.push(issue("pdf-export-persistence-job-id-invalid", "jobId", "job id must be bounded"))
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.layoutProfileId)) inputIssues.push(issue("pdf-export-persistence-layout-profile-invalid", "layoutProfileId", "layout profile id must be bounded"))
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.claimToken)) inputIssues.push(issue("pdf-export-persistence-claim-token-invalid", "claimToken", "claim token must be bounded"))
  if (!exactIso(input.persistedAt)) inputIssues.push(issue("pdf-export-persistence-time-invalid", "persistedAt", "persistence time must be exact ISO"))
  const parsedOperation = parseFlowDocBackendPdfExportOperationV1(input.operation)
  if (parsedOperation.status === "blocked") inputIssues.push(...parsedOperation.issues)
  if (inputIssues.length > 0 || parsedOperation.status === "blocked") return blockedResult({ issues: inputIssues })
  const operation = parsedOperation.operation
  const inspectedAttempt = inspectRendererAttempt({ operation, value: input.rendererAttempt })
  if (inspectedAttempt.attempt == null) return blockedResult({ issues: inspectedAttempt.issues })
  const attempt = inspectedAttempt.attempt

  const existing = await input.persistenceRepository.readByOperationId({ ...operation.scope, operationId: operation.operationId })
  if (existing.status === "found") {
    if (
      existing.receipt.operationFingerprint === operation.operationFingerprint
      && existing.receipt.renderExecutionFingerprint === attempt.executionFingerprint
      && existing.receipt.core.completion.completionFingerprint === attempt.completion.completionFingerprint
    ) {
      const retained = await input.contentStore.read({ storageKey: existing.receipt.bytes.storageKey })
      if (
        retained.status !== "found"
        || retained.content.byteLength !== existing.receipt.bytes.byteLength
        || retained.content.sha256 !== existing.receipt.bytes.sha256
        || sha256(retained.bytes) !== existing.receipt.bytes.sha256
      ) return blockedResult({
        receipt: existing.receipt,
        issues: retained.status === "found"
          ? [issue("pdf-export-persistence-replay-readback-mismatch", "contentStore", "terminal replay requires exact retained physical bytes")]
          : retained.issues.length > 0 ? retained.issues : [issue("pdf-export-persistence-replay-bytes-missing", "contentStore", "terminal replay requires retained physical bytes")],
      })
      return {
        source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
        status: "idempotent-replay",
        receipt: existing.receipt,
        orphanCandidateStorageKey: null,
        issues: [],
        contracts: resultContracts(),
      }
    }
    return blockedResult({
      receipt: existing.receipt,
      issues: [issue("pdf-export-persistence-operation-terminal-conflict", "operationId", "operation already owns a different terminal persistence receipt")],
    })
  }
  if (existing.status !== "not-found") return blockedResult({ issues: existing.issues })

  const lifecycle = await input.lifecycleRepository.readLifecycle({ ...operation.scope, operationId: operation.operationId })
  if (lifecycle.status !== "found") return blockedResult({
    issues: lifecycle.status === "not-found"
      ? [issue("pdf-export-persistence-lifecycle-missing", "lifecycle", "durable lifecycle head is required before persistence")]
      : lifecycle.issues,
  })
  const head = lifecycle.head
  if (
    head.lifecycleFingerprint !== attempt.lifecycleHead!.lifecycleFingerprint
    || head.status !== "claimed"
    || head.checkpoint !== "before-persist"
    || head.checkpointCheck == null
    || head.claim?.claimToken !== input.claimToken
    || head.cancellation != null
  ) return blockedResult({
    issues: [issue("pdf-export-persistence-lifecycle-drift", "lifecycle", "live lifecycle must still match the exact checked V-D before-persist head")],
  })
  if (Date.parse(input.persistedAt) >= Date.parse(head.deadlineAt) || Date.parse(input.persistedAt) >= Date.parse(head.claim.expiresAt)) return blockedResult({
    issues: [issue("pdf-export-persistence-lifecycle-expired", "persistedAt", "deadline and worker claim must remain live when persistence starts")],
  })

  const expectedSha256 = attempt.completion.artifact.sha256
  const expectedByteLength = attempt.completion.artifact.byteLength
  const written = await input.contentStore.write({
    bytes: attempt.bytes,
    expectedSha256,
    expectedByteLength,
  })
  if (written.content == null) return blockedResult({ issues: written.issues })
  const readback = await input.contentStore.read({ storageKey: written.content.storageKey })
  if (
    readback.status !== "found"
    || readback.content.byteLength !== expectedByteLength
    || readback.content.sha256 !== expectedSha256
    || readback.bytes.byteLength !== expectedByteLength
    || sha256(readback.bytes) !== expectedSha256
  ) return blockedResult({
    orphanCandidateStorageKey: written.content.storageKey,
    issues: readback.status === "found"
      ? [issue("pdf-export-persistence-readback-mismatch", "contentStore", "read-after-write bytes must match exact length and SHA-256")]
      : readback.issues.length > 0 ? readback.issues : [issue("pdf-export-persistence-readback-missing", "contentStore", "written bytes must be readable before metadata projection")],
  })

  const records = createProjectionRecords({
    jobId: input.jobId,
    layoutProfileId: input.layoutProfileId,
    persistedAt: input.persistedAt,
    attempt,
    content: readback.content,
  })
  if (Array.isArray(records)) return blockedResult({
    orphanCandidateStorageKey: readback.content.storageKey,
    issues: records,
  })
  const fingerprint = calculateFlowDocBackendPdfExportArtifactProjectionFingerprintV1({
    operation,
    attempt,
    content: readback.content,
    manifest: records.manifest,
    job: records.job,
    committedAt: input.persistedAt,
  })
  const committed = await input.persistenceRepository.commitProjection({
    persistenceId: input.persistenceId,
    operation,
    rendererAttempt: attempt,
    storedContent: readback.content,
    manifest: records.manifest,
    job: records.job,
    expectedManifestRevision: null,
    expectedJobRevision: null,
    committedAt: input.persistedAt,
    projectionFingerprint: fingerprint,
  })
  if (committed.status !== "committed" && committed.status !== "idempotent-replay") return blockedResult({
    receipt: committed.receipt,
    orphanCandidateStorageKey: readback.content.storageKey,
    issues: committed.issues,
  })
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    status: committed.status === "committed" ? "persisted" : "idempotent-replay",
    receipt: committed.receipt,
    orphanCandidateStorageKey: null,
    issues: [],
    contracts: resultContracts(),
  }
}

export async function reconcileFlowDocBackendPdfExportOrphanContentV1(input: {
  now: string
  gracePeriodMs: number
  maxScanCount: number
  maxDeleteCount: number
  contentStore: FlowDocBackendPdfExportContentAddressedStoreV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
}): Promise<FlowDocBackendPdfExportOrphanReconciliationResultV1> {
  const contracts = {
    gracePeriodRequired: true as const,
    boundedScan: true as const,
    boundedDelete: true as const,
    referenceRecheckedBeforeDelete: true as const,
    contentBytesInResult: false as const,
    manifestMutation: false as const,
    jobMutation: false as const,
    backendRoute: false as const,
    productionBinding: false as const,
  }
  if (
    !exactIso(input.now)
    || !Number.isInteger(input.gracePeriodMs)
    || input.gracePeriodMs < 60_000
    || !Number.isInteger(input.maxScanCount)
    || input.maxScanCount <= 0
    || input.maxScanCount > 10_000
    || !Number.isInteger(input.maxDeleteCount)
    || input.maxDeleteCount <= 0
    || input.maxDeleteCount > input.maxScanCount
  ) return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    status: "blocked",
    scannedCount: 0,
    candidateCount: 0,
    referencedCount: 0,
    deletedStorageKeys: [],
    retainedStorageKeys: [],
    truncated: false,
    issues: [issue("pdf-export-orphan-policy-invalid", "policy", "orphan policy requires at least one minute grace and bounded scan/delete counts")],
    contracts,
  }
  const modifiedBefore = new Date(Date.parse(input.now) - input.gracePeriodMs).toISOString()
  const scan = await input.contentStore.scan({ modifiedBefore, maxScanCount: input.maxScanCount })
  if (scan.status !== "ready") return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    status: "blocked",
    scannedCount: scan.scannedCount,
    candidateCount: 0,
    referencedCount: 0,
    deletedStorageKeys: [],
    retainedStorageKeys: [],
    truncated: false,
    issues: scan.issues,
    contracts,
  }
  const deletedStorageKeys: string[] = []
  const retainedStorageKeys: string[] = []
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  let referencedCount = 0
  for (const candidate of scan.candidates) {
    const reference = await input.persistenceRepository.inspectStorageReference({ storageKey: candidate.storageKey })
    if (reference.status === "referenced") {
      referencedCount += 1
      retainedStorageKeys.push(candidate.storageKey)
      continue
    }
    if (reference.status !== "unreferenced") {
      retainedStorageKeys.push(candidate.storageKey)
      issues.push(...reference.issues)
      continue
    }
    if (deletedStorageKeys.length >= input.maxDeleteCount) {
      retainedStorageKeys.push(candidate.storageKey)
      continue
    }
    const rechecked = await input.persistenceRepository.inspectStorageReference({ storageKey: candidate.storageKey })
    if (rechecked.status !== "unreferenced") {
      retainedStorageKeys.push(candidate.storageKey)
      if (rechecked.status === "referenced") referencedCount += 1
      else issues.push(...rechecked.issues)
      continue
    }
    const deleted = await input.contentStore.delete({ storageKey: candidate.storageKey })
    if (deleted.status === "deleted" || deleted.status === "not-found") deletedStorageKeys.push(candidate.storageKey)
    else {
      retainedStorageKeys.push(candidate.storageKey)
      issues.push(...deleted.issues)
    }
  }
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    status: issues.length === 0 ? "completed" : "blocked",
    scannedCount: scan.scannedCount,
    candidateCount: scan.candidates.length,
    referencedCount,
    deletedStorageKeys,
    retainedStorageKeys,
    truncated: scan.truncated || scan.candidates.length - deletedStorageKeys.length - referencedCount > 0,
    issues,
    contracts,
  }
}

export async function reconcileFlowDocBackendPdfExportResumableOrphanContentV1(input: {
  now: string
  gracePeriodMs: number
  maxScanCount: number
  maxDeleteCount: number
  cursor: string | null
  contentStore: FlowDocBackendPdfExportResumableContentAddressedStoreV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
}): Promise<FlowDocBackendPdfExportResumableOrphanReconciliationResultV1> {
  const contracts = {
    gracePeriodRequired: true as const,
    boundedScan: true as const,
    boundedDelete: true as const,
    resumableScanCursor: true as const,
    laterPrefixesCanAdvance: true as const,
    referenceRecheckedBeforeDelete: true as const,
    contentBytesInResult: false as const,
    manifestMutation: false as const,
    jobMutation: false as const,
    backendRoute: false as const,
    productionBinding: false as const,
  }
  if (
    !exactIso(input.now)
    || !Number.isInteger(input.gracePeriodMs)
    || input.gracePeriodMs < 60_000
    || !Number.isInteger(input.maxScanCount)
    || input.maxScanCount <= 0
    || input.maxScanCount > 10_000
    || !Number.isInteger(input.maxDeleteCount)
    || input.maxDeleteCount <= 0
    || input.maxDeleteCount > input.maxScanCount
    || (input.cursor != null && (typeof input.cursor !== "string" || input.cursor.length <= 0 || input.cursor.length > 4096))
  ) return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    status: "blocked",
    inputCursor: input.cursor,
    nextCursor: null,
    scannedCount: 0,
    candidateCount: 0,
    referencedCount: 0,
    deletedStorageKeys: [],
    retainedStorageKeys: [],
    truncated: false,
    issues: [issue(
      "pdf-export-resumable-orphan-policy-invalid",
      "policy",
      "resumable orphan policy requires grace, bounded scan/delete counts, and a bounded cursor",
    )],
    contracts,
  }
  const modifiedBefore = new Date(Date.parse(input.now) - input.gracePeriodMs).toISOString()
  const scan = await input.contentStore.scanPage({
    modifiedBefore,
    maxScanCount: input.maxScanCount,
    cursor: input.cursor,
  })
  if (scan.status !== "ready") return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    status: "blocked",
    inputCursor: input.cursor,
    nextCursor: null,
    scannedCount: scan.scannedCount,
    candidateCount: 0,
    referencedCount: 0,
    deletedStorageKeys: [],
    retainedStorageKeys: [],
    truncated: false,
    issues: scan.issues,
    contracts,
  }
  const deletedStorageKeys: string[] = []
  const retainedStorageKeys: string[] = []
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  let referencedCount = 0
  for (const candidate of scan.candidates) {
    const reference = await input.persistenceRepository.inspectStorageReference({
      storageKey: candidate.storageKey,
    })
    if (reference.status === "referenced") {
      referencedCount += 1
      retainedStorageKeys.push(candidate.storageKey)
      continue
    }
    if (reference.status !== "unreferenced") {
      retainedStorageKeys.push(candidate.storageKey)
      issues.push(...reference.issues)
      continue
    }
    if (deletedStorageKeys.length >= input.maxDeleteCount) {
      retainedStorageKeys.push(candidate.storageKey)
      continue
    }
    const rechecked = await input.persistenceRepository.inspectStorageReference({
      storageKey: candidate.storageKey,
    })
    if (rechecked.status !== "unreferenced") {
      retainedStorageKeys.push(candidate.storageKey)
      if (rechecked.status === "referenced") referencedCount += 1
      else issues.push(...rechecked.issues)
      continue
    }
    const deleted = await input.contentStore.delete({ storageKey: candidate.storageKey })
    if (deleted.status === "deleted" || deleted.status === "not-found") {
      deletedStorageKeys.push(candidate.storageKey)
    } else {
      retainedStorageKeys.push(candidate.storageKey)
      issues.push(...deleted.issues)
    }
  }
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_PERSISTENCE_V1_SOURCE,
    status: issues.length === 0 ? "completed" : "blocked",
    inputCursor: input.cursor,
    nextCursor: scan.nextCursor,
    scannedCount: scan.scannedCount,
    candidateCount: scan.candidates.length,
    referencedCount,
    deletedStorageKeys,
    retainedStorageKeys,
    truncated: scan.nextCursor != null
      || scan.candidates.length - deletedStorageKeys.length - referencedCount > 0,
    issues,
    contracts,
  }
}
