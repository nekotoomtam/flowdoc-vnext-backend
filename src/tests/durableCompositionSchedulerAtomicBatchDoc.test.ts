import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler atomic batch documentation", () => {
  it("records Phase 394 evidence and keeps production activation closed", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_ATOMIC_BATCH.md")
    for (const section of [
      "## Batch Contract",
      "## Lifecycle Wiring",
      "## Compatibility Boundary",
      "## Atomicity Evidence",
      "## Scale Evidence",
      "## Performance Decision",
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
    expect(doc).toContain("1,202 immutable records and 3,224,446 canonical JSON bytes")
    expect(doc).toContain("481 admitted immutable batch transactions")
    expect(doc).toContain("Production activation remains closed")
    expect(read("../../README.md")).toContain("Phase 394 adds bounded atomic admitted staging")
  })
})
