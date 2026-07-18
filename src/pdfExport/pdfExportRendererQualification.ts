import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  isFlowDocBackendPdfExportRecordV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_QUALIFICATION_V1_SOURCE =
  "flowdoc-backend-pdf-export-renderer-qualification" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_QUALIFICATION_V1_VERSION = 1 as const
export const FLOWDOC_BACKEND_PDF_EXPORT_MAX_CANCELLATION_CHECK_GAP = 10_000

export interface FlowDocBackendPdfExportRendererQualificationV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_QUALIFICATION_V1_SOURCE
  contractVersion: typeof FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_QUALIFICATION_V1_VERSION
  kind: "pdf-export-renderer-qualification"
  status: "qualified-candidate"
  qualificationId: string
  adapter: {
    adapterId: string
    adapterVersion: string
    implementationFingerprint: string
  }
  profiles: {
    rendererProfileId: string
    measurementProfileId: string
  }
  runtime: {
    nodeVersion: string
    platform: string
    architecture: string
  }
  protocol: {
    coreHandoffContractVersion: 1
    coreReceiptContractVersion: 1
    cancellationMode: "cooperative-async-checkpoint"
    maximumPaintCommandsBetweenChecks: number
    minimumCheckpointCount: number
  }
  evidence: {
    suiteFingerprint: string
    deterministicRebuild: true
    exactCoreReceipt: true
    byteIntegrity: true
    cancellationBeforeByteReturn: true
    noRemeasure: true
    noRepaginate: true
    noRelayout: true
    noSemanticRegrouping: true
    qualifiedAt: string
  }
  contracts: {
    runtimeProfileQualified: true
    cooperativeCancellationQualified: true
    exactCoreHandoffRequired: true
    candidateOnly: true
    concreteProductionRendererSelected: false
    deploymentBinding: false
    productionBinding: false
  }
  qualificationFingerprint: string
}

export interface FlowDocBackendPdfExportRendererQualificationCreateInputV1 {
  qualificationId: string
  adapterId: string
  adapterVersion: string
  implementationFingerprint: string
  rendererProfileId: string
  measurementProfileId: string
  runtime: FlowDocBackendPdfExportRendererQualificationV1["runtime"]
  maximumPaintCommandsBetweenChecks: number
  minimumCheckpointCount: number
  suiteFingerprint: string
  qualifiedAt: string
}

export type FlowDocBackendPdfExportRendererQualificationResultV1 =
  | { status: "ready"; qualification: FlowDocBackendPdfExportRendererQualificationV1; issues: [] }
  | { status: "blocked"; qualification: null; issues: FlowDocBackendPdfExportOperationIssueV1[] }

type QualificationFactsV1 = Omit<FlowDocBackendPdfExportRendererQualificationV1, "qualificationFingerprint">

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|")
}

function fingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT.test(value)
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function finalize(facts: QualificationFactsV1): FlowDocBackendPdfExportRendererQualificationV1 {
  const cloned = cloneFlowDocBackendPdfExportJsonV1(facts)
  return { ...cloned, qualificationFingerprint: flowDocBackendPdfExportFingerprintV1(cloned) }
}

export function createFlowDocBackendPdfExportRendererQualificationV1(
  input: FlowDocBackendPdfExportRendererQualificationCreateInputV1,
): FlowDocBackendPdfExportRendererQualificationResultV1 {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  const ids: Array<[string, unknown]> = [
    ["qualificationId", input.qualificationId],
    ["adapterId", input.adapterId],
    ["adapterVersion", input.adapterVersion],
    ["rendererProfileId", input.rendererProfileId],
    ["measurementProfileId", input.measurementProfileId],
    ["runtime.nodeVersion", input.runtime.nodeVersion],
    ["runtime.platform", input.runtime.platform],
    ["runtime.architecture", input.runtime.architecture],
  ]
  ids.forEach(([path, value]) => {
    if (!isFlowDocBackendPdfExportBoundedStringV1(value)) issues.push(issue(
      "pdf-export-renderer-qualification-identity-invalid",
      path,
      `${path} must be a bounded non-empty string`,
    ))
  })
  if (!fingerprint(input.implementationFingerprint)) issues.push(issue(
    "pdf-export-renderer-implementation-fingerprint-invalid",
    "implementationFingerprint",
    "renderer implementation fingerprint must be a compact SHA-256 identity",
  ))
  if (!fingerprint(input.suiteFingerprint)) issues.push(issue(
    "pdf-export-renderer-suite-fingerprint-invalid",
    "suiteFingerprint",
    "qualification suite fingerprint must be a compact SHA-256 identity",
  ))
  if (
    !Number.isInteger(input.maximumPaintCommandsBetweenChecks)
    || input.maximumPaintCommandsBetweenChecks < 1
    || input.maximumPaintCommandsBetweenChecks > FLOWDOC_BACKEND_PDF_EXPORT_MAX_CANCELLATION_CHECK_GAP
  ) issues.push(issue(
    "pdf-export-renderer-cancellation-gap-invalid",
    "maximumPaintCommandsBetweenChecks",
    `cancellation check gap must be between 1 and ${FLOWDOC_BACKEND_PDF_EXPORT_MAX_CANCELLATION_CHECK_GAP}`,
  ))
  if (!Number.isInteger(input.minimumCheckpointCount) || input.minimumCheckpointCount < 2) issues.push(issue(
    "pdf-export-renderer-checkpoint-count-invalid",
    "minimumCheckpointCount",
    "qualified renderer must require at least the initial and terminal checkpoints",
  ))
  if (!exactIso(input.qualifiedAt)) issues.push(issue(
    "pdf-export-renderer-qualified-time-invalid",
    "qualifiedAt",
    "qualification time must be an exact ISO date-time",
  ))
  if (issues.length > 0) return { status: "blocked", qualification: null, issues }

  const facts: QualificationFactsV1 = {
    source: FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_QUALIFICATION_V1_SOURCE,
    contractVersion: FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_QUALIFICATION_V1_VERSION,
    kind: "pdf-export-renderer-qualification",
    status: "qualified-candidate",
    qualificationId: input.qualificationId,
    adapter: {
      adapterId: input.adapterId,
      adapterVersion: input.adapterVersion,
      implementationFingerprint: input.implementationFingerprint,
    },
    profiles: {
      rendererProfileId: input.rendererProfileId,
      measurementProfileId: input.measurementProfileId,
    },
    runtime: cloneFlowDocBackendPdfExportJsonV1(input.runtime),
    protocol: {
      coreHandoffContractVersion: 1,
      coreReceiptContractVersion: 1,
      cancellationMode: "cooperative-async-checkpoint",
      maximumPaintCommandsBetweenChecks: input.maximumPaintCommandsBetweenChecks,
      minimumCheckpointCount: input.minimumCheckpointCount,
    },
    evidence: {
      suiteFingerprint: input.suiteFingerprint,
      deterministicRebuild: true,
      exactCoreReceipt: true,
      byteIntegrity: true,
      cancellationBeforeByteReturn: true,
      noRemeasure: true,
      noRepaginate: true,
      noRelayout: true,
      noSemanticRegrouping: true,
      qualifiedAt: input.qualifiedAt,
    },
    contracts: {
      runtimeProfileQualified: true,
      cooperativeCancellationQualified: true,
      exactCoreHandoffRequired: true,
      candidateOnly: true,
      concreteProductionRendererSelected: false,
      deploymentBinding: false,
      productionBinding: false,
    },
  }
  return { status: "ready", qualification: finalize(facts), issues: [] }
}

export function parseFlowDocBackendPdfExportRendererQualificationV1(
  value: unknown,
): FlowDocBackendPdfExportRendererQualificationResultV1 {
  if (!isFlowDocBackendPdfExportRecordV1(value) || !exactKeys(value, [
    "source", "contractVersion", "kind", "status", "qualificationId", "adapter",
    "profiles", "runtime", "protocol", "evidence", "contracts", "qualificationFingerprint",
  ])) return {
    status: "blocked",
    qualification: null,
    issues: [issue("pdf-export-renderer-qualification-shape-invalid", "qualification", "qualification must contain only V1 fields")],
  }
  const adapter = isFlowDocBackendPdfExportRecordV1(value.adapter) && exactKeys(value.adapter, [
    "adapterId", "adapterVersion", "implementationFingerprint",
  ]) ? value.adapter : null
  const profiles = isFlowDocBackendPdfExportRecordV1(value.profiles) && exactKeys(value.profiles, [
    "rendererProfileId", "measurementProfileId",
  ]) ? value.profiles : null
  const runtime = isFlowDocBackendPdfExportRecordV1(value.runtime) && exactKeys(value.runtime, [
    "nodeVersion", "platform", "architecture",
  ]) ? value.runtime : null
  const protocol = isFlowDocBackendPdfExportRecordV1(value.protocol) && exactKeys(value.protocol, [
    "coreHandoffContractVersion", "coreReceiptContractVersion", "cancellationMode",
    "maximumPaintCommandsBetweenChecks", "minimumCheckpointCount",
  ]) ? value.protocol : null
  const evidence = isFlowDocBackendPdfExportRecordV1(value.evidence) && exactKeys(value.evidence, [
    "suiteFingerprint", "deterministicRebuild", "exactCoreReceipt", "byteIntegrity",
    "cancellationBeforeByteReturn", "noRemeasure", "noRepaginate", "noRelayout",
    "noSemanticRegrouping", "qualifiedAt",
  ]) ? value.evidence : null
  const contracts = isFlowDocBackendPdfExportRecordV1(value.contracts) && exactKeys(value.contracts, [
    "runtimeProfileQualified", "cooperativeCancellationQualified", "exactCoreHandoffRequired",
    "candidateOnly", "concreteProductionRendererSelected", "deploymentBinding", "productionBinding",
  ]) ? value.contracts : null
  const reconstructed = createFlowDocBackendPdfExportRendererQualificationV1({
    qualificationId: value.qualificationId as string,
    adapterId: adapter?.adapterId as string,
    adapterVersion: adapter?.adapterVersion as string,
    implementationFingerprint: adapter?.implementationFingerprint as string,
    rendererProfileId: profiles?.rendererProfileId as string,
    measurementProfileId: profiles?.measurementProfileId as string,
    runtime: {
      nodeVersion: runtime?.nodeVersion as string,
      platform: runtime?.platform as string,
      architecture: runtime?.architecture as string,
    },
    maximumPaintCommandsBetweenChecks: protocol?.maximumPaintCommandsBetweenChecks as number,
    minimumCheckpointCount: protocol?.minimumCheckpointCount as number,
    suiteFingerprint: evidence?.suiteFingerprint as string,
    qualifiedAt: evidence?.qualifiedAt as string,
  })
  if (reconstructed.status === "blocked") return reconstructed
  const exactLiterals = value.source === FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_QUALIFICATION_V1_SOURCE
    && value.contractVersion === FLOWDOC_BACKEND_PDF_EXPORT_RENDERER_QUALIFICATION_V1_VERSION
    && value.kind === "pdf-export-renderer-qualification"
    && value.status === "qualified-candidate"
    && protocol?.coreHandoffContractVersion === 1
    && protocol.coreReceiptContractVersion === 1
    && protocol.cancellationMode === "cooperative-async-checkpoint"
    && evidence?.deterministicRebuild === true
    && evidence.exactCoreReceipt === true
    && evidence.byteIntegrity === true
    && evidence.cancellationBeforeByteReturn === true
    && evidence.noRemeasure === true
    && evidence.noRepaginate === true
    && evidence.noRelayout === true
    && evidence.noSemanticRegrouping === true
    && contracts?.runtimeProfileQualified === true
    && contracts.cooperativeCancellationQualified === true
    && contracts.exactCoreHandoffRequired === true
    && contracts.candidateOnly === true
    && contracts.concreteProductionRendererSelected === false
    && contracts.deploymentBinding === false
    && contracts.productionBinding === false
    && fingerprint(value.qualificationFingerprint)
  if (!exactLiterals || reconstructed.qualification.qualificationFingerprint !== value.qualificationFingerprint) return {
    status: "blocked",
    qualification: null,
    issues: [issue(
      "pdf-export-renderer-qualification-fingerprint-mismatch",
      "qualificationFingerprint",
      "qualification literals and fingerprint must match the exact reconstructed candidate facts",
    )],
  }
  return {
    status: "ready",
    qualification: cloneFlowDocBackendPdfExportJsonV1(value as unknown as FlowDocBackendPdfExportRendererQualificationV1),
    issues: [],
  }
}

export function flowDocBackendPdfExportCurrentRuntimeIdentityV1():
FlowDocBackendPdfExportRendererQualificationV1["runtime"] {
  return {
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
  }
}
