import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.0-E.5.6 Backend DocGen handoff", () => {
  it("separates Published Structure admission from caller-owned data", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_DOCGEN_HANDOFF.md")

    for (const section of [
      "## Direction",
      "## Backend Ownership",
      "## Input Families",
      "## E.1 Accepted Core Input",
      "## E.2 Accepted Core Runtime",
      "## E.3 Accepted Local Admission",
      "## E.4 Accepted Artifact Binding",
      "## E.5.0 Product Contract Handoff",
      "## E.5.1 Local Library Handoff",
      "## E.5.2 Workspace Tabs Handoff",
      "## E.5.3 Test-Input Projection Handoff",
      "## E.5.4 Temporary Form Handoff",
      "## E.5.5 Temporary JSON And Mapping Handoff",
      "## E.5.6 Published Preview Handoff",
      "## Existing Local Lane",
      "## Phase Order",
      "## Explicitly Not Changed",
      "## PASS",
      "## RISK",
      "## UNKNOWN",
      "## Next Phase",
    ]) expect(doc).toContain(section)

    expect(doc).toMatch(/exact Published Structure Version plus caller-owned data/)
    expect(doc).toMatch(/direct canonical Data Snapshot values/)
    expect(doc).toMatch(/adapted payload values/)
    expect(doc).toMatch(/Editor pre-test and external API route must converge/)
    expect(doc).toContain("`runtime-validation-required`")
    expect(doc).toContain("`mapping-required`")
    expect(doc).toMatch(/Core receives their\s+id, media type, byte length, and SHA-256 descriptor, not the raw JSON/)
    expect(doc).toMatch(/E\.1 adds no request parser, route, repository, worker, provider/)
    expect(doc).toMatch(/exact UTF-8 payload byte length and SHA-256 are verified/)
    expect(doc).toMatch(/mapped and direct snapshots use the same fail-closed validator/)
    expect(doc).toMatch(/browser or caller cannot provide executable\s+mapper code/i)
    expect(doc).toMatch(/E\.2 adds no Backend parser, route, mapper registry/)
    expect(doc).toContain("`POST /docgen-local/admissions`")
    expect(doc).toMatch(/HTTP envelope is capped at 2 MiB/)
    expect(doc).toMatch(/adapted JSON text is\s+separately capped at 1 MiB/)
    expect(doc).toMatch(/Raw adapted JSON is not retained/)
    expect(doc).toContain("E.4 adds `createFlowDocBackendDocGenLocalArtifactBindingV1(...)`")
    expect(doc).toContain("local `GET /documents` list boundary")
    expect(doc).toMatch(/cannot claim secure per-user scoping/)
    expect(doc).toContain("`PDF-EXPORT-REALDOC-E.5.7` now accepts a separate immutable Draft Preview")
    expect(doc).toContain("E.5.8 next")
    expect(doc).toMatch(/No Backend contract or implementation changes in E\.5\.3/)
    expect(doc).toMatch(/No Backend contract or implementation changes in E\.5\.4/)
    expect(doc).toMatch(/No Backend contract or implementation changes in E\.5\.5/)
    expect(doc).toContain("`ready-for-admission`")
    expect(doc).toContain("`GET /docgen-local/published-preview-context`")
    expect(doc).toMatch(/returns no raw\s+payload, business values, or executable mapper/)
  })

  it("keeps the accepted local composition canonical-only", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_DOCGEN_HANDOFF.md")
    const localCompositionDoc = read("../../docs/PDF_EXPORT_LOCAL_HTTP_COMPOSITION.md")
    const composition = read("../pdfExport/pdfExportLocalComposition.ts")
    const localServer = read("../pdfExport/pdfExportLocalHttpServer.ts")

    expect(doc).toContain("`canonicalEvidenceOnly: true`")
    expect(doc).toMatch(/does not widen that handler/)
    expect(composition).toContain("canonicalEvidenceOnly: true")
    expect(composition).toContain("productionBinding: false")
    expect(localCompositionDoc).not.toContain("eligible Editor lifecycle")
    expect(composition).not.toContain("mappingProfile")
    expect(composition).not.toContain("payloadText")
    expect(composition).not.toContain("docGenAdmissionOptions")
    expect(localServer).toContain("docGenAdmissionOptions?")
  })
})
