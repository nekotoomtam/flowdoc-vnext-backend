import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
  createFlowDocBackendRealdocE56LocalRuntimeV1,
} from "./pdfExportRealdocE56Runtime.js"

const EVIDENCE_BEARER_TOKEN = "realdoc-e56-local-evidence-token-00000001"

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

export async function verifyFlowDocBackendRealdocE56V1(input: {
  semanticDirectory: string
  coreRoot?: string
  outputPath?: string | null
  payloadOutputPath?: string | null
}) {
  const runtime = createFlowDocBackendRealdocE56LocalRuntimeV1({
    semanticDirectory: input.semanticDirectory,
    bearerToken: EVIDENCE_BEARER_TOKEN,
    port: 0,
    coreRoot: input.coreRoot,
  })
  const authorization = { authorization: `Bearer ${EVIDENCE_BEARER_TOKEN}` }
  try {
    await runtime.start()
    const origin = runtime.origin()
    if (origin == null) throw new Error("REALDOC-E.5.6 local runtime did not start")
    const contextResponse = await fetch(
      `${origin}/docgen-local/published-preview-context?${new URLSearchParams({
        documentId: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
        documentRevision: String(FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION),
      })}`,
      { headers: authorization },
    )
    if (contextResponse.status !== 200) throw new Error("Published Preview context route failed")
    const contextBody = await json(contextResponse)
    const context = contextBody.context
    const selectedProfile = context.mappingProfiles[0].profile
    const admissionResponse = await fetch(`${origin}/docgen-local/admissions`, {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "docgen:realdoc-e56:adapted-preview",
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
          payloadText: runtime.prepared.adaptedPayloadText,
        },
      }),
    })
    if (admissionResponse.status !== 202) {
      throw new Error(`Published Preview admission failed: ${JSON.stringify(await json(admissionResponse))}`)
    }
    const admissionBody = await json(admissionResponse)
    const receipt = admissionBody.admission
    if (
      receipt.lane !== "adapted"
      || receipt.execution.mapping !== "executed"
      || receipt.execution.runtimeValidation !== "run-valid"
      || receipt.contracts.canonicalBusinessDataExposed !== false
    ) throw new Error("Published Preview admission receipt drifted")
    if (JSON.stringify(admissionBody).includes(runtime.prepared.adaptedPayloadText.slice(0, 64))) {
      throw new Error("Published Preview receipt leaked raw payload")
    }

    const exportResponse = await fetch(`${origin}/pdf-exports`, {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "pdf-export:realdoc-e56:adapted-preview",
      },
      body: JSON.stringify({
        documentId: receipt.instance.instanceId,
        documentRevision: receipt.instance.revision,
      }),
    })
    if (exportResponse.status !== 202) throw new Error("Published Preview PDF operation was rejected")
    let statusBody = await json(exportResponse)
    const operationId = statusBody.export.operationId as string
    const deadline = Date.now() + 300_000
    while (statusBody.export.state !== "completed") {
      if (Date.now() >= deadline) throw new Error("Published Preview PDF operation timed out")
      if (["cancelled", "deadline-exceeded", "resource-rejected", "failed"].includes(statusBody.export.state)) {
        throw new Error(`Published Preview PDF operation stopped: ${statusBody.export.state}`)
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      const statusResponse = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}`, {
        headers: authorization,
      })
      if (statusResponse.status !== 200) throw new Error("Published Preview status route failed")
      statusBody = await json(statusResponse)
    }
    const download = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}/download`, {
      headers: authorization,
    })
    if (download.status !== 200 || download.headers.get("content-type") !== "application/pdf") {
      throw new Error("Published Preview verified download failed")
    }
    const pdfBytes = new Uint8Array(await download.arrayBuffer())
    const evidence = {
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.5.6",
      status: "accepted",
      context: {
        authoring: context.authoring,
        contextFingerprint: context.contextFingerprint,
        projectionFingerprint: context.projection.projectionFingerprint,
        mappingProfileFingerprint: selectedProfile.profileFingerprint,
        businessValuesIncluded: context.contracts.businessValuesIncluded,
      },
      admission: {
        lane: receipt.lane,
        mapping: receipt.execution.mapping,
        runtimeValidation: receipt.execution.runtimeValidation,
        canonicalInputFingerprint: receipt.canonicalInputFingerprint,
        profileFingerprint: receipt.mappingProfile.profileFingerprint,
        diagnosticErrorCount: receipt.diagnostics.summary.errorCount,
        diagnosticWarningCount: receipt.diagnostics.summary.warningCount,
        canonicalBusinessDataExposed: receipt.contracts.canonicalBusinessDataExposed,
        rawPayloadRetained: receipt.contracts.rawPayloadRetained,
      },
      artifact: {
        state: statusBody.export.state,
        pageCount: statusBody.export.pageCount,
        byteLength: pdfBytes.byteLength,
        sha256: sha256(pdfBytes),
        verifiedDownload: true,
      },
      scale: {
        acceptedSlicePages: statusBody.export.pageCount,
        fullDocumentPagesTested: false,
        fullDocumentTargetPages: 200,
        fullDocumentPhase: "PDF-EXPORT-REALDOC-G",
      },
      contracts: {
        sameBackendAdmissionAsApiCaller: true,
        sameArtifactLifecycleAsApiCaller: true,
        browserMapper: false,
        mappedValuesReturnedToEditor: false,
        defaultApplicationServerMounted: false,
        productionBinding: false,
      },
    }
    if (JSON.stringify(evidence).includes("Ward Registry")) {
      throw new Error("retained E.5.6 evidence contains business text")
    }
    if (input.outputPath) {
      const outputPath = resolve(input.outputPath)
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, pdfBytes)
    }
    if (input.payloadOutputPath) {
      const payloadPath = resolve(input.payloadOutputPath)
      mkdirSync(dirname(payloadPath), { recursive: true })
      writeFileSync(payloadPath, runtime.prepared.adaptedPayloadText, "utf8")
    }
    return { evidence, pdfBytes }
  } finally {
    await runtime.close()
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  const semanticDirectory = option("--semantic-dir")
  if (!semanticDirectory) throw new Error("--semantic-dir is required")
  const result = await verifyFlowDocBackendRealdocE56V1({
    semanticDirectory,
    coreRoot: option("--core-root") ?? undefined,
    outputPath: option("--output"),
    payloadOutputPath: option("--payload-output"),
  })
  const fixturePath = resolve(
    process.cwd(),
    "src/tests/fixtures/pdf-export-realdoc-e56-evidence.v1.json",
  )
  if (process.argv.includes("--update-fixture")) {
    writeFileSync(fixturePath, `${JSON.stringify(result.evidence, null, 2)}\n`, "utf8")
  } else {
    const retained = JSON.parse(readFileSync(fixturePath, "utf8"))
    if (JSON.stringify(retained) !== JSON.stringify(result.evidence)) {
      throw new Error("retained REALDOC-E.5.6 evidence drifted")
    }
  }
  process.stdout.write(`${JSON.stringify(result.evidence, null, 2)}\n`)
}
