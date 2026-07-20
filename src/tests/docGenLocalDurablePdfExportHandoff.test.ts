import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.6.2 durable lifecycle handoff", () => {
  it("locks exact local recovery while keeping startup discovery and production closed", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_DURABLE_LIFECYCLE.md")

    for (const section of [
      "## Composition",
      "## Restart Sequence",
      "## After-Render Recovery",
      "## 69C Evidence",
      "## Explicit Resume Boundary",
      "## Explicitly Not Changed",
      "## Verification",
      "## Next Phase",
    ]) expect(doc).toContain(section)

    expect(doc).toContain("Status: `PDF-EXPORT-REALDOC-E.6.2` accepted")
    expect(doc).toContain("four independent Node processes")
    expect(doc).toContain("1,417,544 bytes")
    expect(doc).toContain("Automatic startup discovery remains false")
    expect(doc).toContain("`PDF-EXPORT-REALDOC-E.6.3`")
    expect(doc).toContain("Production remains NO-GO")
  })
})
