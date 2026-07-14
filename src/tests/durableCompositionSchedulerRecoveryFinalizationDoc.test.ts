import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler recovery and finalization documentation", () => {
  it("records Phase 390 boundaries and selects scale readiness", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_RECOVERY_FINALIZATION.md")
    for (const section of [
      "## Recovery And Retry",
      "## Cancellation Expiry And Progress",
      "## Reachable Chain Verification",
      "## Finalization Protocol",
      "## Core Contract Repair",
      "## Verification",
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
    expect(doc).toContain("Transition-zero pages emitted during initialization")
    expect(doc).toContain("Phase 391 should exercise the whole scheduler")
    expect(read("../../README.md")).toContain("Phase 390 adds explicit expired-lease recovery")
  })
})
