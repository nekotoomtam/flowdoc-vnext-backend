import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler initialization documentation", () => {
  it("records Phase 388 and selects exact-window advancement", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_INITIALIZATION.md")
    for (const section of ["## Revision Gate", "## Core Initialization", "## Initial Page Chunks", "## Atomic Boundary", "## Verification", "## PASS", "## FAIL / BLOCKER", "## RISK", "## UNKNOWN", "## Files Changed", "## Behavior Changed", "## Tests Run", "## Risks Left", "## Intentionally Not Changed", "## Next Recommended Direction"]) expect(doc).toContain(section)
    expect(doc).toContain("`transitionNumber: 0` and `windowRef: null`")
    expect(doc).toContain("Implement Phase 389 exact-window advancement")
    expect(read("../../README.md")).toContain("Phase 388 adds revision-gated durable composition initialization")
  })
})
