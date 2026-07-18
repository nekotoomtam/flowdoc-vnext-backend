import {
  createVNextPdfExportRequestV1,
  createVNextPdfMeasuredDrawContractV1,
  type VNextPdfExportProductionPolicyV1,
  type VNextPdfExportSourceIdentityV1,
  type VNextPdfMeasuredDrawContractRequestV1,
} from "@flowdoc/vnext-core"
import thaiOnePageRequest from "@flowdoc/vnext-core/fixtures/pdf-pilot-thai-one-page-request.v1.json" with { type: "json" }
import {
  createFlowDocBackendPdfExportOperationV1,
  type FlowDocBackendPdfExportOperationCreateInputV1,
  type FlowDocBackendPdfExportOperationV1,
} from "../../pdfExport/pdfExportOperation.js"

export function pdfExportOperationPolicy(
  overrides: Partial<VNextPdfExportProductionPolicyV1> = {},
): VNextPdfExportProductionPolicyV1 {
  return {
    policyId: "pdf-export-v-b-policy-v1",
    maxAttempts: 2,
    executionDeadlineMs: 120_000,
    resources: {
      maxPageCount: 100,
      maxPaintCommandCount: 100_000,
      maxGlyphCount: 1_000_000,
      maxFontAssetCount: 16,
      maxImageAssetCount: 50,
      maxSingleImagePixelCount: 25_000_000,
      maxTotalImagePixelCount: 250_000_000,
      maxOutputByteLength: 100_000_000,
    },
    ...overrides,
  }
}

export function pdfExportOperationSource(revision = 7): VNextPdfExportSourceIdentityV1 {
  return {
    documentId: "document:pdf-export-v-b",
    documentRevision: revision,
    documentFingerprint: `sha256:${revision.toString(16).padStart(64, "0")}`,
    sourcePackageId: "package:pdf-export-v-b",
    sessionId: null,
  }
}

export interface PdfExportOperationFixtureOptions {
  operationId?: string
  tenantId?: string
  principalId?: string
  callerIdempotencyKey?: string
  acceptedAt?: string
  revision?: number
  requestId?: string
  artifactId?: string
  currentSourceRevision?: number
  policy?: VNextPdfExportProductionPolicyV1
}

export function createPdfExportOperationFixture(
  options: PdfExportOperationFixtureOptions = {},
): FlowDocBackendPdfExportOperationV1 {
  const revision = options.revision ?? 7
  const measuredDrawContract = createVNextPdfMeasuredDrawContractV1(
    structuredClone(thaiOnePageRequest) as VNextPdfMeasuredDrawContractRequestV1,
  )
  const request = createVNextPdfExportRequestV1({
    exportRequestId: options.requestId ?? `export:pdf-export-v-b:${revision}`,
    artifactId: options.artifactId ?? `artifact:pdf-export-v-b:${revision}`,
    requestedAt: "2026-07-18T09:00:00.000Z",
    source: pdfExportOperationSource(revision),
    measuredDrawContract,
  })
  if (request.status !== "ready") throw new Error(JSON.stringify(request.issues))
  const input: FlowDocBackendPdfExportOperationCreateInputV1 = {
    operationId: options.operationId ?? `operation:pdf-export-v-b:${revision}`,
    tenantId: options.tenantId ?? "tenant:flowdoc",
    principalId: options.principalId ?? "principal:operator",
    callerIdempotencyKey: options.callerIdempotencyKey ?? "caller-key:pdf-export-v-b",
    acceptedAt: options.acceptedAt ?? "2026-07-18T09:00:01.000Z",
    request: request.request,
    currentSource: pdfExportOperationSource(options.currentSourceRevision ?? revision),
    measuredDrawContract,
    policy: options.policy ?? pdfExportOperationPolicy(),
  }
  const operation = createFlowDocBackendPdfExportOperationV1(input)
  if (operation.status !== "ready") throw new Error(JSON.stringify(operation.issues))
  return operation.operation
}
