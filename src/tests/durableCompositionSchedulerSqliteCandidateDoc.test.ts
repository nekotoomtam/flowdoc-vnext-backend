import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler SQLite candidate documentation", () => {
  it("records Phase 393 evidence and keeps production activation closed", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_SQLITE_CANDIDATE.md")
    for (const section of [
      "## Candidate Decision",
      "## SQLite Configuration",
      "## Transaction Boundary",
      "## Repository Parity",
      "## Production Operations",
      "## Trusted Runner",
      "## Scale Evidence",
      "## Performance Finding",
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
    expect(doc).toContain("every Phase 392 scenario exactly once")
    expect(doc).toContain("1,202 immutable records totaling 3,224,446 canonical JSON bytes")
    expect(doc).toContain("Phase 394 should add a bounded atomic admitted immutable batch")
    expect(read("../../README.md")).toContain("Phase 393 implements a dynamically gated Node SQLite")
  })
})
