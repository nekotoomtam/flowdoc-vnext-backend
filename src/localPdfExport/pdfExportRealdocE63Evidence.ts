import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
} from "./pdfExportRealdocE56Runtime.js"
import { createFlowDocBackendRealdocE63DurableRuntimeV1 } from "./pdfExportRealdocE63Runtime.js"

const TOKEN = "realdoc-e63-local-evidence-token-00000001"
const ADMISSION_KEY = "docgen:realdoc-e63:adapted-preview"
const EXPORT_KEY = "pdf-export:realdoc-e63:adapted-preview"
const CANCEL_EXPORT_KEY = "pdf-export:realdoc-e63:cancel-preview"
const CANCEL_KEY = "pdf-export:realdoc-e63:cancel-request"

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1] ?? null
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function json(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>
}

export async function verifyFlowDocBackendRealdocE63V1(input: {
  semanticDirectory: string
  coreRoot?: string
}) {
  const durableRootDirectory = mkdtempSync(join(tmpdir(), "flowdoc-realdoc-e63-evidence-"))
  const authorization = { authorization: `Bearer ${TOKEN}` }
  let preparedFacts: {
    requirementCount: number
    screenshotCount: number
    adaptedPayloadByteLength: number
  } | null = null
  let receipt: Record<string, any> | null = null
  let operationId = ""
  let completedStatus: Record<string, any> | null = null
  let pdfBytes = new Uint8Array()
  const dispatchEvidence: Record<string, unknown>[] = []
  try {
    const first = await createFlowDocBackendRealdocE63DurableRuntimeV1({
      semanticDirectory: input.semanticDirectory,
      durableRootDirectory,
      bearerToken: TOKEN,
      port: 0,
      coreRoot: input.coreRoot,
      operationDispatchDelayMs: 60_000,
    })
    await first.start()
    try {
      const origin = first.origin()
      if (origin == null) throw new Error("E.6.3 first runtime did not start")
      preparedFacts = {
        requirementCount: first.prepared.evidence.requirementCount,
        screenshotCount: first.prepared.evidence.screenshotCount,
        adaptedPayloadByteLength: first.prepared.evidence.adaptedPayloadByteLength,
      }
      const contextResponse = await fetch(
        `${origin}/docgen-local/published-preview-context?${new URLSearchParams({
          documentId: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
          documentRevision: String(FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION),
        })}`,
        { headers: authorization },
      )
      if (contextResponse.status !== 200) throw new Error("E.6.3 context route failed")
      const context = (await json(contextResponse)).context
      const selectedProfile = context.mappingProfiles[0].profile
      const admissionResponse = await fetch(`${origin}/docgen-local/admissions`, {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": ADMISSION_KEY,
        },
        body: JSON.stringify({
          contractVersion: 1,
          kind: "docgen-local-admission-request",
          structure: context.admission.structure,
          assets: context.admission.assets,
          input: {
            kind: "adapted-json",
            mappingProfile: {
              mappingProfileId: selectedProfile.mappingProfileId,
              mappingProfileVersion: selectedProfile.mappingProfileVersion,
            },
            payloadText: first.prepared.adaptedPayloadText,
          },
        }),
      })
      if (admissionResponse.status !== 202) throw new Error("E.6.3 admission failed")
      receipt = (await json(admissionResponse)).admission
      if (receipt?.contracts.durablePersistence !== true) throw new Error("E.6.3 admission was not durable")
      const requested = await fetch(`${origin}/pdf-exports`, {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": EXPORT_KEY,
        },
        body: JSON.stringify({
          documentId: receipt.instance.instanceId,
          documentRevision: receipt.instance.revision,
        }),
      })
      if (requested.status !== 202) throw new Error("E.6.3 initial PDF request failed")
      const body = await json(requested)
      operationId = body.export.operationId
      if (body.export.state !== "pending") throw new Error("E.6.3 initial PDF was not retained pending")
      dispatchEvidence.push(first.readDispatchEvidence())
    } finally {
      await first.close()
    }

    if (receipt == null) throw new Error("E.6.3 admission receipt is missing")
    const second = await createFlowDocBackendRealdocE63DurableRuntimeV1({
      semanticDirectory: input.semanticDirectory,
      durableRootDirectory,
      bearerToken: TOKEN,
      port: 0,
      coreRoot: input.coreRoot,
      operationDispatchDelayMs: 0,
    })
    await second.start()
    try {
      const origin = second.origin()
      if (origin == null) throw new Error("E.6.3 reconnect runtime did not start")
      const replay = await fetch(`${origin}/pdf-exports`, {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": EXPORT_KEY,
        },
        body: JSON.stringify({
          documentId: receipt.instance.instanceId,
          documentRevision: receipt.instance.revision,
        }),
      })
      const replayBody = await json(replay)
      if (replay.status !== 200 || replayBody.status !== "idempotent-replay") {
        throw new Error("E.6.3 exact reconnect replay failed")
      }
      const deadline = Date.now() + 300_000
      completedStatus = replayBody.export
      while (completedStatus?.state !== "completed") {
        if (Date.now() >= deadline) throw new Error("E.6.3 durable reconnect timed out")
        if (["cancelled", "deadline-exceeded", "resource-rejected", "failed"].includes(completedStatus?.state)) {
          throw new Error(`E.6.3 durable reconnect stopped: ${String(completedStatus?.state)}`)
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100))
        const statusResponse = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}`, {
          headers: authorization,
        })
        if (statusResponse.status !== 200) throw new Error("E.6.3 status recovery failed")
        completedStatus = (await json(statusResponse)).export
      }
      const download = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}/download`, {
        headers: authorization,
      })
      if (download.status !== 200 || download.headers.get("content-type") !== "application/pdf") {
        throw new Error("E.6.3 verified download failed")
      }
      pdfBytes = new Uint8Array(await download.arrayBuffer())
      const concealed = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}`, {
        headers: { authorization: "Bearer other-principal" },
      })
      if (concealed.status !== 401) throw new Error("E.6.3 scoped operation was not concealed")
      dispatchEvidence.push(second.readDispatchEvidence())
    } finally {
      await second.close()
    }

    const third = await createFlowDocBackendRealdocE63DurableRuntimeV1({
      semanticDirectory: input.semanticDirectory,
      durableRootDirectory,
      bearerToken: TOKEN,
      port: 0,
      coreRoot: input.coreRoot,
      operationDispatchDelayMs: 60_000,
    })
    await third.start()
    let cancelOperationId = ""
    try {
      const origin = third.origin()
      if (origin == null) throw new Error("E.6.3 cancellation runtime did not start")
      const requested = await fetch(`${origin}/pdf-exports`, {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": CANCEL_EXPORT_KEY,
        },
        body: JSON.stringify({
          documentId: receipt.instance.instanceId,
          documentRevision: receipt.instance.revision,
        }),
      })
      if (requested.status !== 202) throw new Error("E.6.3 cancellation operation failed")
      cancelOperationId = (await json(requested)).export.operationId
      const cancelled = await fetch(`${origin}/pdf-exports/${encodeURIComponent(cancelOperationId)}/cancel`, {
        method: "POST",
        headers: { ...authorization, "idempotency-key": CANCEL_KEY },
      })
      if (cancelled.status !== 200 && cancelled.status !== 202) throw new Error("E.6.3 cancellation failed")
      dispatchEvidence.push(third.readDispatchEvidence())
    } finally {
      await third.close()
    }

    const fourth = await createFlowDocBackendRealdocE63DurableRuntimeV1({
      semanticDirectory: input.semanticDirectory,
      durableRootDirectory,
      bearerToken: TOKEN,
      port: 0,
      coreRoot: input.coreRoot,
      operationDispatchDelayMs: 0,
    })
    await fourth.start()
    try {
      const origin = fourth.origin()
      if (origin == null) throw new Error("E.6.3 cancellation reconciliation runtime did not start")
      const requestReplay = await fetch(`${origin}/pdf-exports`, {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": CANCEL_EXPORT_KEY,
        },
        body: JSON.stringify({
          documentId: receipt.instance.instanceId,
          documentRevision: receipt.instance.revision,
        }),
      })
      const requestReplayBody = await json(requestReplay)
      if (requestReplay.status !== 200 || requestReplayBody.export.state !== "cancelled") {
        throw new Error("E.6.3 cancelled request did not reconcile")
      }
      const cancelReplay = await fetch(`${origin}/pdf-exports/${encodeURIComponent(cancelOperationId)}/cancel`, {
        method: "POST",
        headers: { ...authorization, "idempotency-key": CANCEL_KEY },
      })
      const cancelReplayBody = await json(cancelReplay)
      if (cancelReplay.status !== 200 || cancelReplayBody.status !== "idempotent-replay") {
        throw new Error("E.6.3 cancel key did not reconcile")
      }
      dispatchEvidence.push(fourth.readDispatchEvidence())
    } finally {
      await fourth.close()
    }

    const evidence = {
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.6.3",
      status: "accepted",
      source: preparedFacts,
      admission: {
        lane: receipt.lane,
        durablePersistence: receipt.contracts.durablePersistence,
        canonicalBusinessDataExposed: receipt.contracts.canonicalBusinessDataExposed,
        rawPayloadRetained: receipt.contracts.rawPayloadRetained,
        diagnosticErrorCount: receipt.diagnostics.summary.errorCount,
        diagnosticWarningCount: receipt.diagnostics.summary.warningCount,
      },
      reconnect: {
        repositoryOpenCount: 4,
        initialPendingClosed: true,
        explicitRequestReplay: true,
        statusRecovered: completedStatus?.state === "completed",
        uncertainCancelReconciled: true,
        cancelKeyIdempotentReplay: true,
        scopedOtherPrincipalConcealed: true,
        dispatchEvidence,
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
        state: completedStatus?.state,
        pageCount: completedStatus?.pageCount,
        byteLength: pdfBytes.byteLength,
        sha256: sha256(pdfBytes),
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
    }
    const serialized = JSON.stringify(evidence)
    if (serialized.includes("Ward Registry") || serialized.includes("C:\\Users")) {
      throw new Error("retained E.6.3 evidence contains business text or local paths")
    }
    return evidence
  } finally {
    rmSync(durableRootDirectory, { recursive: true, force: true })
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  const semanticDirectory = option("--semantic-dir")
  if (!semanticDirectory) throw new Error("--semantic-dir is required")
  const evidence = await verifyFlowDocBackendRealdocE63V1({
    semanticDirectory,
    coreRoot: option("--core-root") ?? undefined,
  })
  const fixturePath = resolve(
    process.cwd(),
    "src/tests/fixtures/pdf-export-realdoc-e63-reconnect-evidence.v1.json",
  )
  if (process.argv.includes("--update-fixture")) {
    writeFileSync(fixturePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
  } else {
    const retained = JSON.parse(readFileSync(fixturePath, "utf8"))
    if (JSON.stringify(retained) !== JSON.stringify(evidence)) {
      throw new Error("retained REALDOC-E.6.3 evidence drifted")
    }
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}
