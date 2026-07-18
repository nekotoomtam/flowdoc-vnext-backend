import { describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportRendererQualificationV1,
  flowDocBackendPdfExportCurrentRuntimeIdentityV1,
  parseFlowDocBackendPdfExportRendererQualificationV1,
} from "../index.js"
import {
  PDF_EXPORT_RENDERER_IMPLEMENTATION_FINGERPRINT,
  PDF_EXPORT_RENDERER_SUITE_FINGERPRINT,
  createPdfExportRendererFixture,
} from "./helpers/pdfExportRendererFixture.js"

describe("PDF export renderer qualification", () => {
  it("creates deterministic candidate-only runtime and cancellation qualification", () => {
    const first = createPdfExportRendererFixture().qualification
    const second = createPdfExportRendererFixture().qualification
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      status: "qualified-candidate",
      adapter: {
        adapterId: "renderer:candidate",
        adapterVersion: "1.0.0",
        implementationFingerprint: PDF_EXPORT_RENDERER_IMPLEMENTATION_FINGERPRINT,
      },
      runtime: flowDocBackendPdfExportCurrentRuntimeIdentityV1(),
      protocol: {
        cancellationMode: "cooperative-async-checkpoint",
        maximumPaintCommandsBetweenChecks: 2,
        minimumCheckpointCount: 3,
      },
      contracts: {
        runtimeProfileQualified: true,
        cooperativeCancellationQualified: true,
        candidateOnly: true,
        concreteProductionRendererSelected: false,
        deploymentBinding: false,
        productionBinding: false,
      },
    })
    expect(parseFlowDocBackendPdfExportRendererQualificationV1(first)).toMatchObject({
      status: "ready",
      qualification: first,
      issues: [],
    })
  })

  it("rejects unbounded cancellation gaps and incomplete checkpoint evidence", () => {
    const fixture = createPdfExportRendererFixture()
    const result = createFlowDocBackendPdfExportRendererQualificationV1({
      qualificationId: "qualification:invalid",
      adapterId: "renderer:candidate",
      adapterVersion: "1.0.0",
      implementationFingerprint: PDF_EXPORT_RENDERER_IMPLEMENTATION_FINGERPRINT,
      rendererProfileId: fixture.measuredDrawContract.rendererProfileId,
      measurementProfileId: fixture.measuredDrawContract.measurementProfileId,
      runtime: flowDocBackendPdfExportCurrentRuntimeIdentityV1(),
      maximumPaintCommandsBetweenChecks: 10_001,
      minimumCheckpointCount: 1,
      suiteFingerprint: PDF_EXPORT_RENDERER_SUITE_FINGERPRINT,
      qualifiedAt: "2026-07-18T08:00:00.000Z",
    })
    expect(result).toMatchObject({
      status: "blocked",
      qualification: null,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "pdf-export-renderer-cancellation-gap-invalid" }),
        expect.objectContaining({ code: "pdf-export-renderer-checkpoint-count-invalid" }),
      ]),
    })
  })

  it("fails closed on qualification and implementation drift", () => {
    const qualification = structuredClone(createPdfExportRendererFixture().qualification)
    qualification.adapter.implementationFingerprint = `sha256:${"a".repeat(64)}`
    expect(parseFlowDocBackendPdfExportRendererQualificationV1(qualification)).toMatchObject({
      status: "blocked",
      qualification: null,
      issues: [{ code: "pdf-export-renderer-qualification-fingerprint-mismatch" }],
    })
  })
})
