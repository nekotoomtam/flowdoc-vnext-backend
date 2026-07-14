import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler transient availability documentation", () => {
  it("records Phase 396 reconciliation, retry, and activation boundaries", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_TRANSIENT_AVAILABILITY.md")
    for (const section of [
      "## Availability Contract",
      "## Reconciliation Matrix",
      "## Retry And Exhaustion",
      "## Lifecycle Integration",
      "## SQLite Evidence",
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
    expect(doc).toContain("bounded to three total")
    expect(doc).toContain("does not issue a compensating lease release")
    expect(doc).toContain("Production provider and worker activation remain blocked")
    expect(read("../../README.md")).toContain("Phase 396 adds provider-neutral typed head availability")
  })
})
