import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8")

describe("durable composition scheduler due-batch qualification documentation", () => {
  it("records Phase 401 ownership, duplicate observation, restart, and activation boundaries", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_DUE_BATCH_QUALIFICATION.md")
    expect(doc).toContain("Status: Phase 401 independent-process SQLite candidate qualification")
    expect(doc).toContain("exactly 48 list observations")
    expect(doc).toContain("exactly 12 runner outcomes own completion")
    expect(doc).toContain("one `committed` and 11 `conflict` outcomes")
    expect(doc).toContain("Normal attempts finish at journal revision 6")
    expect(doc).toContain("expired-claim attempt finishes at\nrevision 7")
    expect(doc).toContain("No production runtime behavior changes")
    expect(doc).toContain("Phase 402 should lock the worker lifecycle and wake-up boundary")
  })
})
