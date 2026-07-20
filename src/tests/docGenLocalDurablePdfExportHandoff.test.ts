import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.6.3 durable lifecycle handoff", () => {
  it("locks exact local recovery and explicit reconnect while keeping discovery and production closed", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_DURABLE_LIFECYCLE.md")

    for (const section of [
      "## Durable Composition",
      "## Local Runtime",
      "## Recovery Rules",
      "## Cancellation Reconciliation",
      "## 69C Evidence",
      "## Explicitly Not Changed",
      "## Verification",
      "## Next Decision",
    ]) expect(doc).toContain(section)

    expect(doc).toContain("Status: `PDF-EXPORT-REALDOC-E.6.3` accepted")
    expect(doc).toContain("same durable root four times")
    expect(doc).toContain("1,417,544 bytes")
    expect(doc).toContain("`automaticStartupDiscovery: false`")
    expect(doc).toContain("same cancel key")
    expect(doc).toContain("Production remains NO-GO")
  })
})
