import { describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportOperationV1,
  parseFlowDocBackendPdfExportOperationV1,
} from "../index.js"
import {
  createPdfExportOperationFixture,
  pdfExportOperationPolicy,
  pdfExportOperationSource,
} from "./helpers/pdfExportOperationFixture.js"
import {
  createVNextPdfExportRequestV1,
  createVNextPdfMeasuredDrawContractV1,
  type VNextPdfMeasuredDrawContractRequestV1,
} from "@flowdoc/vnext-core"
import thaiOnePageRequest from "@flowdoc/vnext-core/fixtures/pdf-pilot-thai-one-page-request.v1.json" with { type: "json" }

function creationInput(overrides: Record<string, unknown> = {}) {
  const measuredDrawContract = createVNextPdfMeasuredDrawContractV1(
    structuredClone(thaiOnePageRequest) as VNextPdfMeasuredDrawContractRequestV1,
  )
  const request = createVNextPdfExportRequestV1({
    exportRequestId: "export:pdf-export-operation-contract",
    artifactId: "artifact:pdf-export-operation-contract",
    requestedAt: "2026-07-18T09:00:00.000Z",
    source: pdfExportOperationSource(),
    measuredDrawContract,
  })
  if (request.status !== "ready") throw new Error(JSON.stringify(request.issues))
  return {
    operationId: "operation:pdf-export-operation-contract",
    tenantId: "tenant:flowdoc",
    principalId: "principal:operator",
    callerIdempotencyKey: "caller-key:contract",
    acceptedAt: "2026-07-18T09:00:01.000Z",
    request: request.request,
    currentSource: pdfExportOperationSource(),
    measuredDrawContract,
    policy: pdfExportOperationPolicy(),
    ...overrides,
  }
}

describe("PDF export operation contract", () => {
  it("wraps exact Core admission in a deterministic non-executing backend record", () => {
    const first = createFlowDocBackendPdfExportOperationV1(creationInput())
    const second = createFlowDocBackendPdfExportOperationV1(creationInput())

    expect(first).toMatchObject({
      status: "ready",
      operation: {
        source: "flowdoc-backend-pdf-export-operation",
        contractVersion: 1,
        kind: "pdf-export-operation",
        status: "accepted",
        operationId: "operation:pdf-export-operation-contract",
        scope: {
          tenantId: "tenant:flowdoc",
          principalId: "principal:operator",
        },
        idempotency: {
          callerKey: "caller-key:contract",
        },
        admission: {
          source: "vnext-pdf-export-production-admission",
          admissionId: "operation:pdf-export-operation-contract",
        },
        contracts: {
          backendOwned: true,
          importsCoreAsPublicPackage: true,
          usesCoreProductionAdmission: true,
          immutableAdmission: true,
          callerKeyBoundToPayload: true,
          tenantAndPrincipalScoped: true,
          lifecycleHead: false,
          workerExecution: false,
          rendererExecution: false,
          storageWrites: false,
          backendRoute: false,
          authzExecution: false,
          productionBinding: false,
        },
      },
      issues: [],
    })
    if (first.status !== "ready" || second.status !== "ready") throw new Error("operation must pass")
    expect(first.operation.idempotency.payloadFingerprint).toBe(
      first.operation.admission.idempotency.payloadFingerprint,
    )
    expect(first.operation.operationFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(second.operation).toEqual(first.operation)
    expect(parseFlowDocBackendPdfExportOperationV1(first.operation)).toEqual(first)
  })

  it("fails closed on stale Core source and invalid backend identity or timing", () => {
    const stale = createFlowDocBackendPdfExportOperationV1(creationInput({
      currentSource: pdfExportOperationSource(8),
    }))
    expect(stale).toMatchObject({ status: "blocked", operation: null })
    expect(stale.issues.map((item) => item.message).join(" ")).toContain("source-revision-drift")

    const invalid = createFlowDocBackendPdfExportOperationV1(creationInput({
      tenantId: " ",
      principalId: "",
      callerIdempotencyKey: " ",
      acceptedAt: "2026-07-18T08:59:59.000Z",
    }))
    expect(invalid).toMatchObject({ status: "blocked", operation: null })
    expect(invalid.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "pdf-export-operation-string-invalid",
      "pdf-export-operation-accepted-before-request",
    ]))
  })

  it("detects operation and retained Core admission drift", () => {
    const operationDrift = createPdfExportOperationFixture()
    operationDrift.scope.tenantId = "tenant:changed"
    const parsedOperation = parseFlowDocBackendPdfExportOperationV1(operationDrift)
    expect(parsedOperation).toMatchObject({ status: "blocked", operation: null })
    expect(parsedOperation.issues.map((item) => item.code)).toContain(
      "pdf-export-operation-fingerprint-mismatch",
    )

    const admissionDrift = createPdfExportOperationFixture()
    admissionDrift.admission.lifecycle.maxAttempts += 1
    const parsedAdmission = parseFlowDocBackendPdfExportOperationV1(admissionDrift)
    expect(parsedAdmission).toMatchObject({ status: "blocked", operation: null })
    expect(parsedAdmission.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "pdf-export-operation-admission-fingerprint-mismatch",
      "pdf-export-operation-fingerprint-mismatch",
    ]))
  })

  it("keeps caller scope out of Core payload identity while retaining it in backend operation identity", () => {
    const first = createPdfExportOperationFixture({
      operationId: "operation:scope:first",
      tenantId: "tenant:first",
      principalId: "principal:first",
    })
    const second = createPdfExportOperationFixture({
      operationId: "operation:scope:second",
      tenantId: "tenant:second",
      principalId: "principal:second",
    })

    expect(second.idempotency.payloadFingerprint).toBe(first.idempotency.payloadFingerprint)
    expect(second.operationFingerprint).not.toBe(first.operationFingerprint)
    expect(second.admission.admissionFingerprint).not.toBe(first.admission.admissionFingerprint)
  })
})
