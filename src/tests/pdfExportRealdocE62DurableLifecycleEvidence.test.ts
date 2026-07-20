import evidence from "./fixtures/pdf-export-realdoc-e62-durable-lifecycle-evidence.v1.json" with { type: "json" }
import { describe, expect, it } from "vitest"

describe("PDF-EXPORT-REALDOC-E.6.2 durable lifecycle evidence", () => {
  it("retains content-free 69C restart, recovery, metadata, and download facts", () => {
    expect(evidence).toMatchObject({
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.6.2",
      status: "accepted",
      source: {
        requirementCount: 10,
        screenshotCount: 7,
        adaptedPayloadByteLength: 749_929,
      },
      admission: {
        lane: "adapted",
        durablePersistence: true,
        initialMapCount: 1,
        restartReplayMapCount: 0,
        rawPayloadRetained: false,
        canonicalBusinessDataExposed: false,
      },
      restart: {
        repositoryOpenCount: 4,
        pendingReopen: true,
        afterRenderFaultObserved: true,
        afterRenderCheckpoint: "before-persist",
        beforeRecoveryPersistence: "not-found",
        recoveryStatus: "completed",
        terminalReopen: true,
        verifyMaterializationCount: 0,
      },
      artifact: {
        state: "completed",
        pageCount: 10,
        byteLength: 1_417_544,
        metadataByteLength: 1_417_544,
        metadataMatchesDownload: true,
        terminalEventCount: 6,
        verifiedDownload: true,
        idempotentReplay: true,
      },
      scale: {
        fullDocumentPagesTested: false,
        fullDocumentTargetPages: 200,
        fullDocumentPhase: "PDF-EXPORT-REALDOC-G",
      },
      contracts: {
        protectedAdmissionPersistence: "sqlite",
        operationPersistence: "sqlite",
        lifecyclePersistence: "sqlite",
        artifactMetadataPersistence: "sqlite",
        observabilityPersistence: "sqlite",
        artifactBytePersistence: "filesystem-content-addressed",
        defaultApplicationServerMounted: false,
        automaticStartupDiscovery: false,
        productionBinding: false,
      },
    })
    expect(evidence.artifact.metadataSha256).toBe(evidence.artifact.sha256)
    expect(JSON.stringify(evidence)).not.toContain("Ward Registry")
    expect(JSON.stringify(evidence)).not.toContain("C:\\Users")
  })
})
