import { describe, expect, it } from "vitest"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS,
  FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS,
  FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1,
  FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_V1_SOURCE,
  assessFlowDocBackendCompositionRepositoryReadinessV1,
  compositionFingerprint,
  createFlowDocFileJsonStorageAdapterPlan,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  finalizeFlowDocBackendCompositionRepositoryConformanceReportV1,
  parseFlowDocBackendCompositionRepositoryConformanceReportV1,
  type FlowDocBackendCompositionRepositoryConformanceReportInputV1,
} from "../index.js"

function reportInput(): FlowDocBackendCompositionRepositoryConformanceReportInputV1 {
  return {
    source: FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_V1_SOURCE,
    schemaVersion: 1,
    kind: "composition-repository-conformance-report",
    adapterId: "postgres-composition-repository",
    adapterVersion: "1.0.0",
    storageTechnology: "postgresql",
    runnerId: "composition-repository-conformance-runner-v1",
    runId: "conformance-run-1",
    startedAt: "2026-07-14T04:00:00.000Z",
    completedAt: "2026-07-14T04:10:00.000Z",
    independentProcessCount: 2,
    independentRepositoryHandleCount: 2,
    restartCount: 2,
    batchReadRecordCount: 12,
    physicalQuotaLimitByteCount: 1_000_000,
    physicalQuotaRejectedWriteCount: 1,
    orphanCandidateCount: 3,
    orphanDeletedCount: 2,
    scenarios: FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_CONFORMANCE_SCENARIOS_V1.map((scenarioId) => ({
      scenarioId,
      status: "passed",
      assertionCount: 3,
      evidenceFingerprint: compositionFingerprint({ scenarioId, runId: "conformance-run-1" }),
    })),
  }
}

function finalizedReport(input = reportInput()) {
  const result = finalizeFlowDocBackendCompositionRepositoryConformanceReportV1(input)
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.report
}

describe("composition scheduler production repository conformance", () => {
  it("accepts one fingerprinted report only when every mandatory production scenario passed", () => {
    const report = finalizedReport()

    expect(parseFlowDocBackendCompositionRepositoryConformanceReportV1(report)).toMatchObject({
      status: "ready",
      report: { adapterId: "postgres-composition-repository" },
    })
    expect(assessFlowDocBackendCompositionRepositoryReadinessV1(report)).toMatchObject({
      status: "ready",
      report: {
        independentProcessCount: 2,
        restartCount: 2,
        scenarios: expect.arrayContaining([
          expect.objectContaining({ scenarioId: "atomic-transition-request-commit", status: "passed" }),
          expect.objectContaining({ scenarioId: "unreachable-record-cleanup", status: "passed" }),
        ]),
      },
    })
  })

  it("separates structural report validity from readiness failures", () => {
    const input = reportInput()
    input.scenarios = input.scenarios
      .filter((scenario) => scenario.scenarioId !== "process-restart-recovery")
      .map((scenario) => scenario.scenarioId === "physical-quota-admission"
        ? { ...scenario, status: "failed" }
        : scenario)
    const report = finalizedReport(input)

    expect(parseFlowDocBackendCompositionRepositoryConformanceReportV1(report)).toMatchObject({ status: "ready" })
    expect(assessFlowDocBackendCompositionRepositoryReadinessV1(report)).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "composition-repository-conformance-scenario-cardinality-invalid" }),
        expect.objectContaining({ code: "composition-repository-conformance-scenario-failed" }),
      ]),
    })
  })

  it("blocks single-process evidence and missing restart, batch, quota, or cleanup exercise", () => {
    const input = reportInput()
    Object.assign(input, {
      independentProcessCount: 1,
      independentRepositoryHandleCount: 1,
      restartCount: 0,
      batchReadRecordCount: 1,
      physicalQuotaLimitByteCount: 0,
      physicalQuotaRejectedWriteCount: 0,
      orphanCandidateCount: 0,
      orphanDeletedCount: 0,
    })

    expect(assessFlowDocBackendCompositionRepositoryReadinessV1(finalizedReport(input))).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "composition-repository-conformance-independence-insufficient" }),
        expect.objectContaining({ code: "composition-repository-conformance-restart-missing" }),
        expect.objectContaining({ code: "composition-repository-conformance-batch-read-insufficient" }),
        expect.objectContaining({ code: "composition-repository-conformance-physical-quota-missing" }),
        expect.objectContaining({ code: "composition-repository-conformance-cleanup-missing" }),
      ]),
    })
  })

  it("blocks impossible cleanup accounting and an inverted run interval", () => {
    const input = reportInput()
    input.startedAt = "2026-07-14T04:10:00.000Z"
    input.completedAt = "2026-07-14T04:00:00.000Z"
    input.orphanCandidateCount = 1
    input.orphanDeletedCount = 2

    expect(assessFlowDocBackendCompositionRepositoryReadinessV1(finalizedReport(input))).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "composition-repository-conformance-time-invalid" }),
        expect.objectContaining({ code: "composition-repository-conformance-cleanup-count-invalid" }),
      ]),
    })
  })

  it("rejects edited or unbounded reports before readiness assessment", () => {
    const report = finalizedReport()
    const edited = structuredClone(report)
    edited.scenarios[0]!.assertionCount += 1
    expect(parseFlowDocBackendCompositionRepositoryConformanceReportV1(edited)).toMatchObject({
      status: "blocked",
      issues: [expect.objectContaining({ code: "composition-repository-conformance-fingerprint-mismatch" })],
    })

    expect(finalizeFlowDocBackendCompositionRepositoryConformanceReportV1({
      ...reportInput(),
      batchReadRecordCount: FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS + 1,
      orphanCandidateCount: FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS + 1,
    })).toMatchObject({ status: "blocked" })
    expect(finalizeFlowDocBackendCompositionRepositoryConformanceReportV1({
      ...reportInput(),
      unexpectedCapability: true,
    })).toMatchObject({
      status: "blocked",
      issues: [expect.objectContaining({ code: "composition-record-property-unknown" })],
    })
    expect(finalizeFlowDocBackendCompositionRepositoryConformanceReportV1({
      ...reportInput(),
      scenarios: [
        ...reportInput().scenarios,
        reportInput().scenarios[0],
      ],
    })).toMatchObject({
      status: "blocked",
      issues: [expect.objectContaining({ code: "composition-repository-conformance-scenarios-invalid" })],
    })
  })

  it("does not accept existing in-memory or file JSON adapters as production evidence", () => {
    expect(assessFlowDocBackendCompositionRepositoryReadinessV1(
      createInMemoryFlowDocBackendCompositionRepositoryV1(),
    )).toMatchObject({ status: "blocked" })
    expect(assessFlowDocBackendCompositionRepositoryReadinessV1(
      createFlowDocFileJsonStorageAdapterPlan("tmp/backend-storage"),
    )).toMatchObject({ status: "blocked" })
  })
})
