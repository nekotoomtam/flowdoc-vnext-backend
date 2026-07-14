import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler scale readiness documentation", () => {
  it("records Phase 391 evidence and keeps production activation closed", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_SCALE_READINESS.md")
    for (const section of [
      "## Retention Contract",
      "## Chain Accounting",
      "## Scale Evidence",
      "## Validation Cost Repair",
      "## Failure And Restart Evidence",
      "## Cleanup Ownership",
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
    expect(doc).toContain("1,202 committed immutable records totaling 3,224,446 JSON bytes")
    expect(doc).toContain("Phase 392 should define the production durable repository conformance gate")
    expect(read("../../README.md")).toContain("Phase 391 proves a 240-page mixed-family scheduler run")
  })
})
