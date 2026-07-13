import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler contracts documentation", () => {
  it("records strict Phase 386 scope and selects repository conformance next", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_CONTRACTS.md")
    for (const section of [
      "## Implemented Contracts", "## Source Pin", "## Job Head",
      "## State Invariants", "## Immutable Page Chunk", "## Transition Receipt",
      "## Progress Projection", "## Verification", "## PASS", "## FAIL / BLOCKER",
      "## RISK", "## UNKNOWN", "## Files Changed", "## Behavior Changed",
      "## Tests Run", "## Risks Left", "## Intentionally Not Changed",
      "## Next Recommended Direction",
    ]) expect(doc).toContain(section)
    expect(doc).toContain("`closedPageChunkTipFingerprint` locates")
    expect(doc).toContain("`closedPagePrefixFingerprint` must equal")
    expect(doc).toContain("Implement Phase 387 repository boundary")
    expect(read("../../README.md")).toContain("Phase 386 adds strict durable composition records")
  })
})
