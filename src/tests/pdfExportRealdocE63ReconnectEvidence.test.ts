import evidence from "./fixtures/pdf-export-realdoc-e63-reconnect-evidence.v1.json" with { type: "json" }
import { describe, expect, it } from "vitest"

describe("PDF-EXPORT-REALDOC-E.6.3 reconnect evidence", () => {
  it("retains content-free restart, reconnect, cancellation, and download facts", () => {
    expect(evidence).toMatchObject({
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.6.3",
      status: "accepted",
      source: {
        requirementCount: 10,
        screenshotCount: 7,
        adaptedPayloadByteLength: 749_929,
      },
      admission: {
        lane: "adapted",
        durablePersistence: true,
        canonicalBusinessDataExposed: false,
        rawPayloadRetained: false,
        diagnosticErrorCount: 0,
        diagnosticWarningCount: 3,
      },
      reconnect: {
        repositoryOpenCount: 4,
        initialPendingClosed: true,
        explicitRequestReplay: true,
        statusRecovered: true,
        uncertainCancelReconciled: true,
        cancelKeyIdempotentReplay: true,
        scopedOtherPrincipalConcealed: true,
      },
      editor: {
        sessionStorageOnly: true,
        inputContentFingerprintOnly: true,
        formValuesStored: false,
        rawJsonPayloadStored: false,
        canonicalBusinessDataStored: false,
        staleResultRejected: true,
        diagnosticsRestoredFromSanitizedReceipt: true,
      },
      artifact: {
        state: "completed",
        pageCount: 10,
        byteLength: 1_417_544,
        verifiedDownload: true,
      },
      scale: {
        fullDocumentPagesTested: false,
        fullDocumentTargetPages: 200,
        fullDocumentPhase: "PDF-EXPORT-REALDOC-G",
      },
      contracts: {
        durableComposition: true,
        explicitRequestReplayResume: true,
        automaticStartupDiscovery: false,
        defaultApplicationServerMounted: false,
        productionBinding: false,
      },
    })
    expect(evidence.reconnect.dispatchEvidence).toHaveLength(4)
    expect(evidence.reconnect.dispatchEvidence.every((entry) => entry.failedCount === 0)).toBe(true)
    expect(evidence.artifact.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(evidence)).not.toContain("Ward Registry")
    expect(JSON.stringify(evidence)).not.toContain("C:\\Users")
  })
})
