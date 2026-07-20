import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.5.7 retained Draft Preview evidence", () => {
  it("retains the separate content-free Draft admission and exact artifact facts", () => {
    const evidence = JSON.parse(read("./fixtures/pdf-export-realdoc-e57-evidence.v1.json"))

    expect(evidence).toMatchObject({
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.5.7",
      status: "accepted",
      target: {
        kind: "draft-preview",
        immutableSnapshot: true,
        publishedStructureVersion: false,
        publishedApiParity: false,
      },
      context: { businessValuesIncluded: false },
      admission: {
        separateDraftAdmission: true,
        sharedGenerationValidation: true,
        sharedArtifactLifecycle: true,
        mapping: "executed",
        runtimeValidation: "run-valid",
        diagnosticErrorCount: 0,
        diagnosticWarningCount: 3,
        canonicalBusinessDataExposed: false,
        rawPayloadRetained: false,
      },
      artifact: {
        state: "completed",
        pageCount: 10,
        byteLength: 1_417_544,
        sha256: "1d5af8341ec7a7faf10b0af5d86b217405cdd458df1331277da2115cc95fe372",
        verifiedDownload: true,
      },
      contracts: {
        separateFromPublishedAdmissionRoute: true,
        callerSuppliedPublishedStructureIdentity: false,
        browserMapper: false,
        mappedValuesReturnedToEditor: false,
        publishedApiParity: false,
        defaultApplicationServerMounted: false,
        productionBinding: false,
      },
    })
  })

  it("documents the trusted bridge and the next lifecycle phase", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_DRAFT_PREVIEW.md")
    const server = read("../pdfExport/pdfExportLocalHttpServer.ts")
    const runtime = read("../localPdfExport/pdfExportRealdocE56Runtime.ts")

    for (const section of [
      "## Draft Context",
      "## Separate Draft Admission",
      "## Local Runtime",
      "## Retained Evidence",
      "## Explicitly Not Changed",
      "## Risks",
      "## Next Phase",
    ]) expect(doc).toContain(section)
    expect(server).toContain("draftPreviewOptions")
    expect(runtime).toContain("createVNextDraftStructurePreviewSnapshotV1")
    expect(doc).toContain("arbitrary live Editor draft packages")
    expect(doc).toContain("`PDF-EXPORT-REALDOC-E.5.8`")
    expect(doc).toContain("Production remains NO-GO")
  })
})
