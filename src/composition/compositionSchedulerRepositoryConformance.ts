import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_BYTES,
  FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_RECORDS,
  FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
  blockedCompositionResult,
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  readCompositionEnum,
  readCompositionFingerprint,
  readCompositionInteger,
  readCompositionIsoDate,
  readCompositionLiteral,
  readCompositionRecord,
  readCompositionString,
  readyCompositionResult,
  type FlowDocBackendCompositionContractIssue,
  type FlowDocBackendCompositionContractResult,
} from "./compositionSchedulerContractSupport.js"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS,
  FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS,
} from "./compositionSchedulerProductionRepository.js"

export const FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_V1_SOURCE =
  "flowdoc-backend-composition-repository-conformance"

export const FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1 = [
  "atomic-head-create",
  "head-creation-identity-read",
  "atomic-transition-request-commit",
  "atomic-finalization-request-commit",
  "immutable-record-id-uniqueness",
  "immutable-fingerprint-uniqueness",
  "ordered-batch-read-integrity",
  "independent-handle-cas",
  "crash-before-commit-recovery",
  "crash-after-commit-replay",
  "process-restart-recovery",
  "physical-quota-admission",
  "unreachable-record-cleanup",
] as const

export type FlowDocBackendCompositionRepositoryConformanceScenarioIdV1 =
  typeof FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1[number]

export interface FlowDocBackendCompositionRepositoryConformanceScenarioV1 {
  scenarioId: FlowDocBackendCompositionRepositoryConformanceScenarioIdV1
  status: "passed" | "failed"
  assertionCount: number
  evidenceFingerprint: string
}

export interface FlowDocBackendCompositionRepositoryConformanceReportInputV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_V1_SOURCE
  schemaVersion: typeof FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION
  kind: "composition-repository-conformance-report"
  adapterId: string
  adapterVersion: string
  storageTechnology: string
  runnerId: string
  runId: string
  startedAt: string
  completedAt: string
  independentProcessCount: number
  independentRepositoryHandleCount: number
  restartCount: number
  batchReadRecordCount: number
  physicalQuotaLimitByteCount: number
  physicalQuotaRejectedWriteCount: number
  orphanCandidateCount: number
  orphanDeletedCount: number
  scenarios: FlowDocBackendCompositionRepositoryConformanceScenarioV1[]
}

export type FlowDocBackendCompositionRepositoryConformanceReportV1 =
  FlowDocBackendCompositionRepositoryConformanceReportInputV1 & { fingerprint: string }

export type FlowDocBackendCompositionRepositoryConformanceReportResultV1 =
  FlowDocBackendCompositionContractResult<
    FlowDocBackendCompositionRepositoryConformanceReportV1,
    "report"
  >

function readScenario(
  value: unknown,
  index: number,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionRepositoryConformanceScenarioV1 | null {
  const path = `scenarios[${index}]`
  const record = readCompositionRecord(value, path, [
    "scenarioId",
    "status",
    "assertionCount",
    "evidenceFingerprint",
  ], issues)
  if (record == null) return null
  const scenarioId = readCompositionEnum(
    record,
    "scenarioId",
    `${path}.scenarioId`,
    FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1,
    issues,
  )
  const status = readCompositionEnum(record, "status", `${path}.status`, ["passed", "failed"] as const, issues)
  const assertionCount = readCompositionInteger(record, "assertionCount", `${path}.assertionCount`, 1, 1_000_000, issues)
  const evidenceFingerprint = readCompositionFingerprint(
    record,
    "evidenceFingerprint",
    `${path}.evidenceFingerprint`,
    issues,
  )
  if (scenarioId == null || status == null || assertionCount == null || evidenceFingerprint == null) return null
  return { scenarioId, status, assertionCount, evidenceFingerprint }
}

function parseReportInput(
  value: unknown,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionRepositoryConformanceReportInputV1 | null {
  const record = readCompositionRecord(value, "", [
    "source",
    "schemaVersion",
    "kind",
    "adapterId",
    "adapterVersion",
    "storageTechnology",
    "runnerId",
    "runId",
    "startedAt",
    "completedAt",
    "independentProcessCount",
    "independentRepositoryHandleCount",
    "restartCount",
    "batchReadRecordCount",
    "physicalQuotaLimitByteCount",
    "physicalQuotaRejectedWriteCount",
    "orphanCandidateCount",
    "orphanDeletedCount",
    "scenarios",
  ], issues)
  if (record == null) return null
  const source = readCompositionLiteral(
    record,
    "source",
    "source",
    FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_V1_SOURCE,
    issues,
  )
  const schemaVersion = readCompositionLiteral(
    record,
    "schemaVersion",
    "schemaVersion",
    FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
    issues,
  )
  const kind = readCompositionLiteral(
    record,
    "kind",
    "kind",
    "composition-repository-conformance-report",
    issues,
  )
  const adapterId = readCompositionString(record, "adapterId", "adapterId", issues)
  const adapterVersion = readCompositionString(record, "adapterVersion", "adapterVersion", issues)
  const storageTechnology = readCompositionString(record, "storageTechnology", "storageTechnology", issues)
  const runnerId = readCompositionString(record, "runnerId", "runnerId", issues)
  const runId = readCompositionString(record, "runId", "runId", issues)
  const startedAt = readCompositionIsoDate(record, "startedAt", "startedAt", issues)
  const completedAt = readCompositionIsoDate(record, "completedAt", "completedAt", issues)
  const independentProcessCount = readCompositionInteger(
    record,
    "independentProcessCount",
    "independentProcessCount",
    1,
    10_000,
    issues,
  )
  const independentRepositoryHandleCount = readCompositionInteger(
    record,
    "independentRepositoryHandleCount",
    "independentRepositoryHandleCount",
    1,
    10_000,
    issues,
  )
  const restartCount = readCompositionInteger(record, "restartCount", "restartCount", 0, 10_000, issues)
  const batchReadRecordCount = readCompositionInteger(
    record,
    "batchReadRecordCount",
    "batchReadRecordCount",
    0,
    FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS,
    issues,
  )
  const physicalQuotaLimitByteCount = readCompositionInteger(
    record,
    "physicalQuotaLimitByteCount",
    "physicalQuotaLimitByteCount",
    0,
    FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_BYTES,
    issues,
  )
  const physicalQuotaRejectedWriteCount = readCompositionInteger(
    record,
    "physicalQuotaRejectedWriteCount",
    "physicalQuotaRejectedWriteCount",
    0,
    FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_RECORDS,
    issues,
  )
  const orphanCandidateCount = readCompositionInteger(
    record,
    "orphanCandidateCount",
    "orphanCandidateCount",
    0,
    FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS,
    issues,
  )
  const orphanDeletedCount = readCompositionInteger(
    record,
    "orphanDeletedCount",
    "orphanDeletedCount",
    0,
    FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS,
    issues,
  )
  const scenarios = Array.isArray(record.scenarios)
    && record.scenarios.length <= FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1.length
    ? record.scenarios.map((item, index) => readScenario(item, index, issues)).filter(
      (item): item is FlowDocBackendCompositionRepositoryConformanceScenarioV1 => item != null,
    )
    : null
  if (scenarios == null) issues.push(compositionIssue(
    "composition-repository-conformance-scenarios-invalid",
    "scenarios",
    "scenarios must be an array no longer than the mandatory scenario inventory",
  ))
  if (
    source == null || schemaVersion == null || kind == null || adapterId == null || adapterVersion == null
    || storageTechnology == null || runnerId == null || runId == null || startedAt == null || completedAt == null
    || independentProcessCount == null || independentRepositoryHandleCount == null || restartCount == null
    || batchReadRecordCount == null || physicalQuotaLimitByteCount == null
    || physicalQuotaRejectedWriteCount == null || orphanCandidateCount == null || orphanDeletedCount == null
    || scenarios == null
  ) return null
  return {
    source,
    schemaVersion,
    kind,
    adapterId,
    adapterVersion,
    storageTechnology,
    runnerId,
    runId,
    startedAt,
    completedAt,
    independentProcessCount,
    independentRepositoryHandleCount,
    restartCount,
    batchReadRecordCount,
    physicalQuotaLimitByteCount,
    physicalQuotaRejectedWriteCount,
    orphanCandidateCount,
    orphanDeletedCount,
    scenarios,
  }
}

export function finalizeFlowDocBackendCompositionRepositoryConformanceReportV1(
  value: unknown,
): FlowDocBackendCompositionRepositoryConformanceReportResultV1 {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const input = parseReportInput(value, issues)
  if (input == null || issues.length > 0) return blockedCompositionResult("report", issues)
  const report = { ...cloneCompositionJson(input), fingerprint: compositionFingerprint(input) }
  return readyCompositionResult("report", report)
}

export function parseFlowDocBackendCompositionRepositoryConformanceReportV1(
  value: unknown,
): FlowDocBackendCompositionRepositoryConformanceReportResultV1 {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const record = readCompositionRecord(value, "", [
    "source",
    "schemaVersion",
    "kind",
    "adapterId",
    "adapterVersion",
    "storageTechnology",
    "runnerId",
    "runId",
    "startedAt",
    "completedAt",
    "independentProcessCount",
    "independentRepositoryHandleCount",
    "restartCount",
    "batchReadRecordCount",
    "physicalQuotaLimitByteCount",
    "physicalQuotaRejectedWriteCount",
    "orphanCandidateCount",
    "orphanDeletedCount",
    "scenarios",
    "fingerprint",
  ], issues)
  if (record == null) return blockedCompositionResult("report", issues)
  const fingerprint = readCompositionFingerprint(record, "fingerprint", "fingerprint", issues)
  const { fingerprint: _fingerprint, ...input } = record
  const finalized = finalizeFlowDocBackendCompositionRepositoryConformanceReportV1(input)
  if (finalized.status === "blocked") return finalized
  if (fingerprint !== finalized.report.fingerprint) issues.push(compositionIssue(
    "composition-repository-conformance-fingerprint-mismatch",
    "fingerprint",
    "conformance report fingerprint must match its exact canonical facts",
  ))
  return issues.length > 0
    ? blockedCompositionResult("report", issues)
    : readyCompositionResult("report", finalized.report)
}

export function assessFlowDocBackendCompositionRepositoryReadinessV1(
  value: unknown,
): FlowDocBackendCompositionRepositoryConformanceReportResultV1 {
  const parsed = parseFlowDocBackendCompositionRepositoryConformanceReportV1(value)
  if (parsed.status === "blocked") return parsed
  const report = parsed.report
  const issues: FlowDocBackendCompositionContractIssue[] = []
  if (Date.parse(report.completedAt) < Date.parse(report.startedAt)) issues.push(compositionIssue(
    "composition-repository-conformance-time-invalid",
    "completedAt",
    "conformance completion must not precede its start",
  ))
  if (report.independentProcessCount < 2 || report.independentRepositoryHandleCount < 2) issues.push(compositionIssue(
    "composition-repository-conformance-independence-insufficient",
    "independentProcessCount",
    "production evidence requires at least two independent processes and repository handles",
  ))
  if (report.restartCount < 1) issues.push(compositionIssue(
    "composition-repository-conformance-restart-missing",
    "restartCount",
    "production evidence requires at least one storage-backed process restart",
  ))
  if (report.batchReadRecordCount < 2) issues.push(compositionIssue(
    "composition-repository-conformance-batch-read-insufficient",
    "batchReadRecordCount",
    "batch-read evidence must verify at least two ordered immutable records",
  ))
  if (report.physicalQuotaLimitByteCount < 1 || report.physicalQuotaRejectedWriteCount < 1) issues.push(compositionIssue(
    "composition-repository-conformance-physical-quota-missing",
    "physicalQuotaRejectedWriteCount",
    "physical quota evidence must reject at least one over-limit first write",
  ))
  if (report.orphanCandidateCount < 1 || report.orphanDeletedCount < 1) issues.push(compositionIssue(
    "composition-repository-conformance-cleanup-missing",
    "orphanDeletedCount",
    "cleanup evidence must delete at least one unreachable record while preserving reachable records",
  ))
  else if (report.orphanDeletedCount > report.orphanCandidateCount) issues.push(compositionIssue(
    "composition-repository-conformance-cleanup-count-invalid",
    "orphanDeletedCount",
    "cleanup cannot delete more records than the conformance run identified as candidates",
  ))
  FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1.forEach((scenarioId) => {
    const matching = report.scenarios.filter((scenario) => scenario.scenarioId === scenarioId)
    if (matching.length !== 1) issues.push(compositionIssue(
      "composition-repository-conformance-scenario-cardinality-invalid",
      "scenarios",
      `scenario ${scenarioId} must appear exactly once`,
    ))
    else if (matching[0]?.status !== "passed") issues.push(compositionIssue(
      "composition-repository-conformance-scenario-failed",
      `scenarios.${scenarioId}`,
      `scenario ${scenarioId} did not pass`,
    ))
  })
  return issues.length > 0
    ? blockedCompositionResult("report", issues)
    : readyCompositionResult("report", cloneCompositionJson(report))
}
