import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.5.6 retained Published Preview evidence", () => {
  it("retains exact content-free 69C admission and artifact facts", () => {
    const evidence = JSON.parse(read("./fixtures/pdf-export-realdoc-e56-evidence.v1.json"))

    expect(evidence).toMatchObject({
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.5.6",
      status: "accepted",
      context: { businessValuesIncluded: false },
      admission: {
        lane: "adapted",
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
        sha256: "d8b3b45c4364639a8eb71fd13510fd1cbb8661d4a57ecc97d76aa23fb1688b61",
        verifiedDownload: true,
      },
      scale: {
        fullDocumentPagesTested: false,
        fullDocumentTargetPages: 200,
        fullDocumentPhase: "PDF-EXPORT-REALDOC-G",
      },
      contracts: {
        sameBackendAdmissionAsApiCaller: true,
        sameArtifactLifecycleAsApiCaller: true,
        browserMapper: false,
        mappedValuesReturnedToEditor: false,
        defaultApplicationServerMounted: false,
        productionBinding: false,
      },
    })
  })

  it("documents optional mounting and the next Draft Preview boundary", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_PUBLISHED_PREVIEW.md")
    const runtime = read("../localPdfExport/pdfExportRealdocE56Runtime.ts")
    const command = read("../localPdfExport/pdfExportRealdocE56HttpCommand.ts")

    for (const section of [
      "## Published Context",
      "## Same Admission And Artifact Path",
      "## Local Runtime",
      "## Retained Evidence",
      "## Explicitly Not Changed",
      "## Next Phase",
    ]) expect(doc).toContain(section)
    expect(runtime).toContain("publishedPreviewContextOptions")
    expect(runtime).toContain("docGenAdmissionOptions")
    expect(command).toContain("FLOWDOC_REALDOC_E56_SEMANTIC_DIR")
    expect(command).toContain("productionBinding")
    expect(doc).toContain("`PDF-EXPORT-REALDOC-E.5.7`")
    expect(doc).toContain("Production remains NO-GO")
  })
})
