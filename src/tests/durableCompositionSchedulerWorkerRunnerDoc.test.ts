import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

describe("durable composition scheduler worker runner documentation", () => {
  it("records Phase 399 one-step execution, recovery, and activation boundaries", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_WORKER_RUNNER.md")
    expect(doc).toContain("Status: Phase 399 one-step durable worker runner passes")
    expect(doc).toContain("durably mark execution start")
    expect(doc).toContain("does not invoke that write again")
    expect(doc).toContain("One invocation performs no more than one reconcile read or one head write")
    expect(doc).toContain("No due-work list, scan, notification, polling loop")
    expect(doc).toContain("Phase 400 should define bounded due-work discovery and runner observability")
    expect(read("../../README.md")).toContain("Phase 399 adds a one-step durable worker runner")
  })
})
