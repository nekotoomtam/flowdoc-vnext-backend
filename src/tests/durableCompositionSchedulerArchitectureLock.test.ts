import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler architecture lock", () => {
  const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_ARCHITECTURE_LOCK.md")

  it("locks the durable state, commit, recovery, and ownership boundaries", () => {
    for (const section of [
      "## Existing Evidence", "## Responsibility Boundary", "## Source Pin",
      "## Identity Model", "## Durable Job Head", "## Immutable Records",
      "## State Machine", "## Atomic Transition Protocol",
      "## Idempotency And Concurrency", "## Family Window Scheduling",
      "## Failure And Recovery", "## Finalization Protocol",
      "## Progress Envelope", "## Limits And Retention",
      "## Implementation Phases", "## PASS", "## FAIL / BLOCKER", "## RISK",
      "## UNKNOWN", "## Files Changed", "## Behavior Changed", "## Tests Run",
      "## Risks Left", "## Intentionally Not Changed",
      "## Next Recommended Direction",
    ]) expect(doc).toContain(section)

    expect(doc).toContain("Step 7 is the logical commit point")
    expect(doc).toContain("multiRecordTransactions: false")
    expect(doc).toContain("job continues against its pinned source")
    expect(doc).toContain("written by a losing attempt are unreachable staging records")
  })

  it("keeps runtime and consumer activation closed while selecting contracts next", () => {
    expect(doc).toContain("No composition job can be created, advanced, resumed, or finalized yet")
    expect(doc).toContain("Editor and renderer consumers remain inactive")
    expect(doc).toContain("Implement Phase 386 strict backend scheduler contracts")
    expect(read("../../README.md")).toContain("Phase 385 locks the durable composition scheduler architecture")
  })
})
