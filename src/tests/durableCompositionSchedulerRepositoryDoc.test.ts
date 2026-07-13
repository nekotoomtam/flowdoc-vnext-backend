import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler repository documentation", () => {
  it("records Phase 387 conformance and keeps production execution closed", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_REPOSITORY.md")
    for (const section of [
      "## Immutable Records", "## Head Creation", "## Compare And Swap",
      "## Idempotency", "## Failure Isolation", "## Adapter Boundary",
      "## Verification", "## PASS", "## FAIL / BLOCKER", "## RISK",
      "## UNKNOWN", "## Files Changed", "## Behavior Changed", "## Tests Run",
      "## Risks Left", "## Intentionally Not Changed", "## Next Recommended Direction",
    ]) expect(doc).toContain(section)
    expect(doc).toContain("one commit and one stale result")
    expect(doc).toContain("Implement Phase 388 source-pinned initialization")
    expect(read("../../README.md")).toContain("Phase 387 adds the durable composition repository boundary")
  })
})
