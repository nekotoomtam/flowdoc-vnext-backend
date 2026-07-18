import {
  flowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256,
} from "./pdfExportLocalCanonicalEvidence.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_READINESS_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-readiness" as const

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_READINESS_LIMITS_V1 = Object.freeze({
  maximumWallTimeMs: 120_000,
  maximumCpuTimeMs: 120_000,
  maximumPeakRssBytes: 1_610_612_736,
  maximumRssGrowthBytes: 536_870_912,
  maximumDatabaseRowCount: 64,
  maximumDatabaseRelationBytes: 33_554_432,
  expectedObjectStoreObjectCount: 1,
  expectedObjectStoreBytes: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH,
  maximumHttpRequestCount: 16,
})

export interface FlowDocBackendPdfExportLocalReadinessMetricsV1 {
  wallTimeMs: number
  cpuTimeMs: number
  peakRssBytes: number
  rssGrowthBytes: number
  databaseRowCount: number
  databaseRelationBytes: number
  objectStoreObjectCount: number
  objectStoreBytes: number
  httpRequestCount: number
}

export interface FlowDocBackendPdfExportLocalReadinessInputV1 {
  runtime: {
    runtimeProfile: "local-integration"
    listenerScope: "loopback-only"
    remoteProviderCallsAllowed: false
    defaultApplicationServerMounted: false
    productionBinding: false
    committedCredential: false
  }
  execution: {
    processCount: 2
    processRestartCount: 1
    rendererExecutionCount: 1
    persistenceExecutionCount: 1
    terminalReplayWithoutRender: true
  }
  artifact: {
    pageCount: 13
    byteLength: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH
    sha256: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256
  }
  metrics: FlowDocBackendPdfExportLocalReadinessMetricsV1
}

export interface FlowDocBackendPdfExportLocalReadinessResultV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_READINESS_V1_SOURCE
  status: "accepted" | "blocked"
  limits: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_READINESS_LIMITS_V1
  metrics: FlowDocBackendPdfExportLocalReadinessMetricsV1
  issues: FlowDocBackendPdfExportOperationIssueV1[]
  contracts: {
    phase: "PDF-EXPORT-LOCAL-G"
    canonicalWorkloadOnly: true
    processRestartRequired: true
    boundedResourceEvidenceRequired: true
    credentialIncluded: false
    productionBinding: false
  }
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function boundedMetric(
  issues: FlowDocBackendPdfExportOperationIssueV1[],
  path: keyof FlowDocBackendPdfExportLocalReadinessMetricsV1,
  value: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    issues.push(issue("pdf-export-local-readiness-metric-invalid", `metrics.${path}`, "readiness metrics must be non-negative safe integers"))
  } else if (value > maximum) {
    issues.push(issue("pdf-export-local-readiness-limit-exceeded", `metrics.${path}`, "measured local workload exceeded its accepted bound"))
  }
}

export function qualifyFlowDocBackendPdfExportLocalReadinessV1(
  input: FlowDocBackendPdfExportLocalReadinessInputV1,
): FlowDocBackendPdfExportLocalReadinessResultV1 {
  const issues: FlowDocBackendPdfExportOperationIssueV1[] = []
  if (
    input.runtime.runtimeProfile !== "local-integration"
    || input.runtime.listenerScope !== "loopback-only"
    || input.runtime.remoteProviderCallsAllowed !== false
    || input.runtime.defaultApplicationServerMounted !== false
    || input.runtime.productionBinding !== false
    || input.runtime.committedCredential !== false
  ) issues.push(issue(
    "pdf-export-local-readiness-runtime-open",
    "runtime",
    "LOCAL-G accepts only the loopback local-integration runtime with every production binding closed",
  ))
  if (
    input.execution.processCount !== 2
    || input.execution.processRestartCount !== 1
    || input.execution.rendererExecutionCount !== 1
    || input.execution.persistenceExecutionCount !== 1
    || input.execution.terminalReplayWithoutRender !== true
  ) issues.push(issue(
    "pdf-export-local-readiness-restart-evidence-invalid",
    "execution",
    "LOCAL-G requires one canonical execution and an exact no-work replay in a second process",
  ))
  if (
    input.artifact.pageCount !== 13
    || input.artifact.byteLength !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH
    || input.artifact.sha256 !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256
  ) issues.push(issue(
    "pdf-export-local-readiness-artifact-drift",
    "artifact",
    "LOCAL-G artifact evidence must retain the exact canonical page count, byte length, and SHA-256",
  ))

  const limits = FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_READINESS_LIMITS_V1
  boundedMetric(issues, "wallTimeMs", input.metrics.wallTimeMs, limits.maximumWallTimeMs)
  boundedMetric(issues, "cpuTimeMs", input.metrics.cpuTimeMs, limits.maximumCpuTimeMs)
  boundedMetric(issues, "peakRssBytes", input.metrics.peakRssBytes, limits.maximumPeakRssBytes)
  boundedMetric(issues, "rssGrowthBytes", input.metrics.rssGrowthBytes, limits.maximumRssGrowthBytes)
  boundedMetric(issues, "databaseRowCount", input.metrics.databaseRowCount, limits.maximumDatabaseRowCount)
  boundedMetric(
    issues,
    "databaseRelationBytes",
    input.metrics.databaseRelationBytes,
    limits.maximumDatabaseRelationBytes,
  )
  boundedMetric(issues, "httpRequestCount", input.metrics.httpRequestCount, limits.maximumHttpRequestCount)
  if (
    !Number.isSafeInteger(input.metrics.objectStoreObjectCount)
    || input.metrics.objectStoreObjectCount !== limits.expectedObjectStoreObjectCount
  ) issues.push(issue(
    "pdf-export-local-readiness-object-count-invalid",
    "metrics.objectStoreObjectCount",
    "the accepted canonical execution must retain exactly one content-addressed object",
  ))
  if (
    !Number.isSafeInteger(input.metrics.objectStoreBytes)
    || input.metrics.objectStoreBytes !== limits.expectedObjectStoreBytes
  ) issues.push(issue(
    "pdf-export-local-readiness-object-bytes-invalid",
    "metrics.objectStoreBytes",
    "retained object-store bytes must match the exact canonical artifact",
  ))

  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_READINESS_V1_SOURCE,
    status: issues.length === 0 ? "accepted" : "blocked",
    limits,
    metrics: { ...input.metrics },
    issues,
    contracts: {
      phase: "PDF-EXPORT-LOCAL-G",
      canonicalWorkloadOnly: true,
      processRestartRequired: true,
      boundedResourceEvidenceRequired: true,
      credentialIncluded: false,
      productionBinding: false,
    },
  }
}
