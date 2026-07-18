import { describe, expect, it } from "vitest"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_READINESS_LIMITS_V1,
  qualifyFlowDocBackendPdfExportLocalReadinessV1,
  type FlowDocBackendPdfExportLocalReadinessInputV1,
} from "../index.js"

function readinessInput(): FlowDocBackendPdfExportLocalReadinessInputV1 {
  return {
    runtime: {
      runtimeProfile: "local-integration",
      listenerScope: "loopback-only",
      remoteProviderCallsAllowed: false,
      defaultApplicationServerMounted: false,
      productionBinding: false,
      committedCredential: false,
    },
    execution: {
      processCount: 2,
      processRestartCount: 1,
      rendererExecutionCount: 1,
      persistenceExecutionCount: 1,
      terminalReplayWithoutRender: true,
    },
    artifact: {
      pageCount: 13,
      byteLength: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH,
      sha256: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_SHA256,
    },
    metrics: {
      wallTimeMs: 30_000,
      cpuTimeMs: 20_000,
      peakRssBytes: 512_000_000,
      rssGrowthBytes: 128_000_000,
      databaseRowCount: 20,
      databaseRelationBytes: 2_000_000,
      objectStoreObjectCount: 1,
      objectStoreBytes: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_EXPECTED_PDF_BYTE_LENGTH,
      httpRequestCount: 7,
    },
  }
}

describe("PDF export LOCAL-G readiness", () => {
  it("accepts the exact restarted canonical workload inside every local bound", () => {
    expect(qualifyFlowDocBackendPdfExportLocalReadinessV1(readinessInput())).toMatchObject({
      status: "accepted",
      issues: [],
      contracts: {
        phase: "PDF-EXPORT-LOCAL-G",
        processRestartRequired: true,
        productionBinding: false,
      },
    })
  })

  it("blocks any measured resource that exceeds the locked envelope", () => {
    const input = readinessInput()
    input.metrics.wallTimeMs = FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_READINESS_LIMITS_V1.maximumWallTimeMs + 1
    expect(qualifyFlowDocBackendPdfExportLocalReadinessV1(input)).toMatchObject({
      status: "blocked",
      issues: [{
        code: "pdf-export-local-readiness-limit-exceeded",
        path: "metrics.wallTimeMs",
      }],
    })
  })

  it("blocks production drift, replay work, and artifact drift independently of load", () => {
    const input = structuredClone(readinessInput()) as unknown as {
      runtime: { productionBinding: boolean }
      execution: { rendererExecutionCount: number }
      artifact: { sha256: string }
    }
    input.runtime.productionBinding = true
    input.execution.rendererExecutionCount = 2
    input.artifact.sha256 = "0".repeat(64)
    expect(qualifyFlowDocBackendPdfExportLocalReadinessV1(
      input as unknown as FlowDocBackendPdfExportLocalReadinessInputV1,
    )).toMatchObject({
      status: "blocked",
      issues: [
        { code: "pdf-export-local-readiness-runtime-open" },
        { code: "pdf-export-local-readiness-restart-evidence-invalid" },
        { code: "pdf-export-local-readiness-artifact-drift" },
      ],
    })
  })
})
