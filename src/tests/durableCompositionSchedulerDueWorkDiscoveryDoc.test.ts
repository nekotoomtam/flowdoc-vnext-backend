import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

describe("durable composition scheduler due-work documentation", () => {
  it("records Phase 400 discovery, observability, and activation boundaries", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_DUE_WORK_DISCOVERY.md")
    expect(doc).toContain("Status: Phase 400 bounded due-work discovery and runner observability pass")
    expect(doc).toContain("pending entry: the Phase 397 state `notBefore` time")
    expect(doc).toContain("claimed entry: active claim `expiresAt`")
    expect(doc).toContain("Listing never claims or changes a journal revision")
    expect(doc).toContain("(discoverable, due_at, attempt_id)")
    expect(doc).toContain("No process loop follows the cursor")
    expect(doc).toContain("Phase 401 should qualify multiple independent due-batch consumers")
    expect(read("../../README.md")).toContain("Phase 400 adds bounded due-work discovery")
  })
})
