import { describe, expect, it } from "vitest"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_REQUIRED_EVENT_NAMES_V1,
  createFlowDocBackendPdfExportObservabilityEventV1,
  flowDocBackendPdfExportScopeFingerprintV1,
  parseFlowDocBackendPdfExportObservabilityEventV1,
  type FlowDocBackendPdfExportObservabilityEventNameV1,
} from "../index.js"
import { createPdfExportOperationFixture } from "./helpers/pdfExportOperationFixture.js"

function event(eventName: FlowDocBackendPdfExportObservabilityEventNameV1) {
  const operation = createPdfExportOperationFixture({
    operationId: `operation:observability:${eventName}`,
    callerIdempotencyKey: `caller-key:observability:${eventName}`,
  })
  return createFlowDocBackendPdfExportObservabilityEventV1({
    eventId: `event:${eventName}`,
    operationId: operation.operationId,
    sequence: 0,
    previousEventFingerprint: null,
    eventName,
    outcome: eventName === "pdf-export.persist-completed" ? "succeeded" : "progress",
    occurredAt: "2026-07-18T09:00:07.000Z",
    scopeFingerprint: flowDocBackendPdfExportScopeFingerprintV1(operation.scope),
    dimensions: {
      exportRequestId: operation.admission.exportIdentity.exportRequestId,
      artifactId: operation.admission.exportIdentity.artifactId,
      documentId: operation.admission.exportIdentity.sourceIdentity.documentId,
      documentRevision: operation.admission.exportIdentity.sourceIdentity.documentRevision,
      requestFingerprint: operation.admission.exportIdentity.requestFingerprint,
      sourceContractFingerprint: operation.admission.exportIdentity.sourceContractFingerprint,
      rendererProfileId: operation.admission.exportIdentity.rendererProfileId,
      measurementProfileId: operation.admission.exportIdentity.measurementProfileId,
      attempt: 1,
      stopReason: eventName === "pdf-export.persist-completed" ? "completed" : null,
      pageCount: 1,
      byteLength: 128,
      durationMs: 6_000,
    },
    failureCode: null,
  })
}

describe("PDF export privacy-safe observability contract", () => {
  it("accepts every Core-required event name with all thirteen dimensions", () => {
    expect(FLOWDOC_BACKEND_PDF_EXPORT_REQUIRED_EVENT_NAMES_V1).toHaveLength(10)
    FLOWDOC_BACKEND_PDF_EXPORT_REQUIRED_EVENT_NAMES_V1.forEach((eventName) => {
      const created = event(eventName)
      expect(created).toMatchObject({
        status: "ready",
        event: {
          eventName,
          privacy: {
            sourceTextIncluded: false,
            pdfBytesIncluded: false,
            freeformMessageIncluded: false,
            rawPrincipalIncluded: false,
            rawTenantIncluded: false,
          },
          contracts: { backendRoute: false, authzExecution: false, productionBinding: false },
        },
      })
      if (created.status !== "ready") throw new Error(JSON.stringify(created.issues))
      expect(Object.keys(created.event.dimensions)).toHaveLength(13)
      expect(JSON.stringify(created.event)).not.toContain("principal:operator")
      expect(JSON.stringify(created.event)).not.toContain("tenant:flowdoc")
    })
  })

  it.each(["sourceText", "pdfBytes", "message", "payload", "rawTenant"])(
    "rejects forbidden or free-form %s fields",
    (field) => {
      const created = event("pdf-export.failed")
      if (created.status !== "ready") throw new Error("event fixture failed")
      const unsafe = { ...created.event, [field]: field === "pdfBytes" ? [37, 80, 68, 70] : "secret content" }
      expect(parseFlowDocBackendPdfExportObservabilityEventV1(unsafe)).toMatchObject({
        status: "blocked",
        issues: [{ code: "pdf-export-observability-event-schema-open" }],
      })
    },
  )

  it("rejects unknown nested dimensions even with a recomputed-looking event", () => {
    const created = event("pdf-export.failed")
    if (created.status !== "ready") throw new Error("event fixture failed")
    const unsafe = structuredClone(created.event) as typeof created.event & { dimensions: { sourceText?: string } }
    unsafe.dimensions.sourceText = "private source text"
    expect(parseFlowDocBackendPdfExportObservabilityEventV1(unsafe)).toMatchObject({
      status: "blocked",
      issues: [{ code: "pdf-export-observability-event-nested-schema-invalid" }],
    })
  })
})
