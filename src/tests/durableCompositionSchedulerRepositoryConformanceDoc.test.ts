import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler repository conformance documentation", () => {
  it("records the Phase 392 production gate while keeping concrete storage inactive", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_REPOSITORY_CONFORMANCE.md")
    for (const section of [
      "## Production Adapter Contract",
      "## Atomic Commit Rules",
      "## Failure Matrix",
      "## Batch Read Contract",
      "## Physical Quota Contract",
      "## Cleanup Contract",
      "## Conformance Evidence",
      "## Adapter Exclusions",
      "## PASS",
      "## FAIL / BLOCKER",
      "## RISK",
      "## UNKNOWN",
      "## Files Changed",
      "## Behavior Changed",
      "## Tests Run",
      "## Risks Left",
      "## Intentionally Not Changed",
      "## Next Recommended Direction",
    ]) expect(doc).toContain(section)
    expect(doc).toContain("at least two independent processes and repository handles")
    expect(doc).toContain("Phase 393 should implement a trusted isolated conformance runner")
    expect(read("../../README.md")).toContain("Phase 392 defines the production repository extension")
  })
})
