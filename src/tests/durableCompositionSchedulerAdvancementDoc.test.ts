import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler advancement documentation", () => {
  it("records Phase 389 and selects recovery plus finalization", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_ADVANCEMENT.md")
    for (const section of ["## Exact Request", "## Atomic Protocol", "## Chunk And Receipt Chain", "## Replay And Concurrency", "## Rejection And Failure Isolation", "## Verification", "## PASS", "## FAIL / BLOCKER", "## RISK", "## UNKNOWN", "## Files Changed", "## Behavior Changed", "## Tests Run", "## Risks Left", "## Intentionally Not Changed", "## Next Recommended Direction"]) expect(doc).toContain(section)
    expect(doc).toContain("`ready-to-advance` requires both demand and window to be null")
    expect(doc).toContain("Implement Phase 390 recovery, expiry, cancellation, finalization, and progress")
    expect(read("../../README.md")).toContain("Phase 389 adds exact-window durable composition advancement")
  })
})
