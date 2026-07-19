import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.0 Backend DocGen handoff", () => {
  it("separates Published Structure admission from caller-owned data", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_DOCGEN_HANDOFF.md")

    for (const section of [
      "## Direction",
      "## Backend Ownership",
      "## Input Families",
      "## Existing Local Lane",
      "## Phase Order",
      "## Explicitly Not Changed",
      "## RISK",
      "## UNKNOWN",
      "## Next Phase",
    ]) expect(doc).toContain(section)

    expect(doc).toMatch(/exact Published Structure Version plus caller-owned data/)
    expect(doc).toMatch(/direct canonical Data Snapshot values/)
    expect(doc).toMatch(/adapted payload values/)
    expect(doc).toMatch(/Editor pre-test and external API route must converge/)
  })

  it("keeps the accepted local composition canonical-only", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_DOCGEN_HANDOFF.md")
    const localCompositionDoc = read("../../docs/PDF_EXPORT_LOCAL_HTTP_COMPOSITION.md")
    const composition = read("../pdfExport/pdfExportLocalComposition.ts")

    expect(doc).toContain("`canonicalEvidenceOnly: true`")
    expect(doc).toMatch(/does not widen that handler/)
    expect(composition).toContain("canonicalEvidenceOnly: true")
    expect(composition).toContain("productionBinding: false")
    expect(localCompositionDoc).not.toContain("eligible Editor lifecycle")
  })
})
