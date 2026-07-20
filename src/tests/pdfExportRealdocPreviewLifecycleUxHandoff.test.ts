import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { REALDOC_LOCAL_OPERATION_DISPATCH_DELAY_MS } from "../localPdfExport/pdfExportRealdocE56Runtime.js"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.5.8 Backend lifecycle UX handoff", () => {
  it("documents existing route reuse and the bounded local dispatch window", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_PREVIEW_LIFECYCLE_UX.md")

    for (const section of [
      "## Existing Lifecycle Reuse",
      "## Local Dispatch Window",
      "## Accepted Evidence",
      "## Explicitly Not Changed",
      "## Risks",
      "## Next Phase",
    ]) expect(doc).toContain(section)

    expect(REALDOC_LOCAL_OPERATION_DISPATCH_DELAY_MS).toBe(10_000)
    expect(doc).toContain("pending operation cancellation to `cancelled`")
    expect(doc).toContain("default local composition")
    expect(doc).toContain("no SQLite scheduler change")
    expect(doc).toContain("`PDF-EXPORT-REALDOC-E.5.9`")
    expect(doc).toContain("Production remains NO-GO")
  })
})
