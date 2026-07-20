import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string): string => readFileSync(new URL(relativePath, import.meta.url), "utf8")

describe("PDF-EXPORT-REALDOC-E.6.1 durable admission handoff", () => {
  it("locks durable protected replay and points to accepted later lifecycle work", () => {
    const doc = read("../../docs/PDF_EXPORT_REALDOC_DURABLE_ADMISSION.md")

    for (const section of [
      "## Boundary",
      "## Stored Record",
      "## Integrity",
      "## Transaction And Replay",
      "## Accepted Evidence",
      "## Subsequent E.6 (Accepted)",
      "## Explicitly Not Changed",
      "## Verification",
      "## Current Status",
    ]) expect(doc).toContain(section)

    expect(doc).toContain("Status: `PDF-EXPORT-REALDOC-E.6.1` accepted")
    expect(doc).toContain("Node `24.15.0` or newer")
    expect(doc).toContain("process B replays with zero mapper calls")
    expect(doc).toContain("does not retain adapted `payloadText`")
    expect(doc).toContain("`PDF-EXPORT-REALDOC-E.6.2`")
    expect(doc).toContain("Production remains NO-GO")
  })
})
