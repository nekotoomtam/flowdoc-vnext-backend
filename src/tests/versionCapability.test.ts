import { describe, expect, it } from "vitest"
import {
  BACKEND_VERSION_CAPABILITY_CONTRACT_VERSION,
  createBackendVersionCapabilityEnvelope,
} from "../contracts/versionCapability.js"

describe("backend version capability contract", () => {
  it("separates active service support from core migration-target recognition", () => {
    const envelope = createBackendVersionCapabilityEnvelope()

    expect(BACKEND_VERSION_CAPABILITY_CONTRACT_VERSION).toBe(3)
    expect(envelope).toMatchObject({
      contractVersion: 3,
      service: "flowdoc-vnext-backend",
      status: "ready",
      core: {
        active: { packageVersion: 2, documentVersion: 3 },
        migrationTarget: { packageVersion: 3, documentVersion: 4 },
        support: {
          migrationTarget: {
            canCreateRuntimeSession: false,
            canMutate: true,
            canParse: true,
            supportedOperationKinds: ["node.delete", "node.reorder"],
          },
        },
      },
      backend: {
        documentRead: {
          pairs: [
            { packageVersion: 2, documentVersion: 3 },
            { packageVersion: 3, documentVersion: 4 },
          ],
          status: "available",
        },
        mutation: {
          pairs: [
            { packageVersion: 2, documentVersion: 3 },
            { packageVersion: 3, documentVersion: 4 },
          ],
          operations: [
            {
              pair: { packageVersion: 2, documentVersion: 3 },
              operationKinds: ["node.delete", "node.duplicate", "node.reorder"],
            },
            {
              pair: { packageVersion: 3, documentVersion: 4 },
              operationKinds: ["node.delete", "node.reorder"],
            },
          ],
          status: "available",
        },
        migrationPlan: {
          source: { packageVersion: 2, documentVersion: 3 },
          status: "core-available",
          target: { packageVersion: 3, documentVersion: 4 },
        },
        migrationPersistence: {
          baseRevisionRequired: true,
          sourceSnapshotRetention: true,
          status: "available",
        },
      },
    })
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope)
  })

  it("returns independent envelopes instead of a mutable shared singleton", () => {
    const first = createBackendVersionCapabilityEnvelope()
    const second = createBackendVersionCapabilityEnvelope()

    first.backend.documentRead.pairs[0].packageVersion = 99
    expect(second.backend.documentRead.pairs[0]).toEqual({
      packageVersion: 2,
      documentVersion: 3,
    })
    expect(second.backend.documentRead.pairs[1]).toEqual({
      packageVersion: 3,
      documentVersion: 4,
    })
  })
})
