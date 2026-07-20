import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.5.9 retained Form/API parity evidence", () => {
  it("documents the shared admission and distinct identity boundary", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_FORM_API_PARITY.md")

    for (const section of [
      "## Admission Lanes",
      "## Identity Contract",
      "## Retained Evidence",
      "## Privacy Boundary",
      "## HTTP Composition",
      "## Explicitly Not Changed",
      "## Current Status",
    ]) expect(doc).toContain(section)

    expect(doc).toContain("`canonicalContentFingerprint`")
    expect(doc).toContain("`canonicalInputFingerprint` remains instance-bound")
    expect(doc).toContain("`publishedApiParity: false`")
    expect(doc).toContain("does not assert cross-instance PDF byte parity")
    expect(doc).toContain("Production remains NO-GO")
  })

  it("retains same canonical content with intentionally distinct instance identities", () => {
    const evidence = JSON.parse(read("./fixtures/pdf-export-realdoc-e59-form-api-parity-evidence.v1.json"))

    expect(evidence).toMatchObject({
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.5.9",
      status: "accepted",
      source: {
        adaptedPayloadByteLength: 749_929,
        requirementCount: 10,
        screenshotCount: 7,
      },
      directForm: {
        lane: "direct",
        mapping: "not-required",
        runtimeValidation: "run-valid",
        diagnosticErrorCount: 0,
        diagnosticWarningCount: 0,
      },
      adaptedApi: {
        lane: "adapted",
        mapping: "executed",
        runtimeValidation: "run-valid",
        diagnosticErrorCount: 0,
        diagnosticWarningCount: 3,
      },
      parity: {
        canonicalContentFingerprint: "sha256:f21638952df9a5405196b2b797c882858fad79c8ee1e8d9d2179ef8bc868e1ad",
        sameCanonicalContent: true,
        distinctInstanceIdentity: true,
        distinctCanonicalInputIdentity: true,
      },
      artifacts: {
        direct: { pageCount: 10, byteLength: 1_417_544 },
        adapted: { pageCount: 10, byteLength: 1_417_544 },
        sameBytes: false,
      },
      contracts: {
        formUsesDirectCanonicalAdmission: true,
        apiUsesTrustedMapping: true,
        backendValidationShared: true,
        browserMapper: false,
        mappedValuesReturnedToEditor: false,
        authoredStructureMutated: false,
        productionBinding: false,
      },
    })
    expect(evidence.directForm.canonicalInputFingerprint).not.toBe(
      evidence.adaptedApi.canonicalInputFingerprint,
    )
    expect(evidence.artifacts.direct.sha256).not.toBe(evidence.artifacts.adapted.sha256)
  })

  it("keeps the retained evidence free of source business text", () => {
    const fixture = read("./fixtures/pdf-export-realdoc-e59-form-api-parity-evidence.v1.json")

    expect(fixture).not.toContain("REQ0137")
    expect(fixture).not.toContain("Ward Registry")
    expect(fixture).not.toContain("ทะเบียนข้อมูลหอผู้ป่วย")
  })
})
