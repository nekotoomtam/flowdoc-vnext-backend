import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler concurrency qualification documentation", () => {
  it("records the Phase 395 evidence and failed SQLite activation decision", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_CONCURRENCY_QUALIFICATION.md")
    for (const section of [
      "## Qualification Workload",
      "## Correctness And Isolation",
      "## Fairness Evidence",
      "## Throughput Evidence",
      "## Busy Timeout Evidence",
      "## Provider Decision",
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
    expect(doc).toContain("1,208 immutable records")
    expect(doc).toContain("about 7.6 to 7.8 baseline multiples")
    expect(doc).toContain("not qualified for production scheduler activation")
    expect(read("../../README.md")).toContain("Phase 395 runs four independent composition processes")
  })
})
