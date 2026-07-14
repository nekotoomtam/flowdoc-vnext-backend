import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

describe("durable composition scheduler worker journal documentation", () => {
  it("records Phase 398 ownership, restart, and activation boundaries", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_WORKER_JOURNAL.md")
    expect(doc).toContain("Status: Phase 398 durable worker-attempt journal and atomic ownership pass")
    expect(doc).toContain("one stable attempt id and idempotent creation request identity")
    expect(doc).toContain("A claim lasts at most five minutes")
    expect(doc).toContain("an expired claim may be reclaimed")
    expect(doc).toContain("before/after-commit claim failure retains pending or claimed respectively")
    expect(doc).toContain("No runner turns a claimed entry into reconcile/retry execution yet")
    expect(doc).toContain("Phase 399 should add a backend-owned runner function")
    expect(read("../../README.md")).toContain("Phase 398 adds a durable worker-attempt journal")
  })
})
