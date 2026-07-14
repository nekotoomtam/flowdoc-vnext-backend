import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

describe("durable composition scheduler worker reconciliation documentation", () => {
  it("records Phase 397 state, evidence, safety, and activation boundaries", () => {
    const doc = read("../../docs/DURABLE_COMPOSITION_SCHEDULER_WORKER_RECONCILIATION.md")
    expect(doc).toContain("Status: Phase 397 worker storage-attempt reconciliation passes")
    expect(doc).toContain("`reconcile` requires exact retained evidence")
    expect(doc).toContain("`retry-ready` records the exact next write attempt")
    expect(doc).toContain("fingerprint over the complete state itself")
    expect(doc).toContain("`readHeadCreation(jobId)`")
    expect(doc).toContain("accidental fourth")
    expect(doc).toContain("All four lanes inject faults at both transaction boundaries")
    expect(doc).toContain("Expired lease-acquisition retries are blocked")
    expect(doc).toContain("No durable worker-state store or queue message envelope is selected")
    expect(doc).toContain("Phase 398 should define a backend-owned durable worker-attempt journal")
    expect(read("../../README.md")).toContain("Phase 397 adds a fingerprinted worker storage-attempt state machine")
  })
})
