import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
  createFlowDocBackendRealdocE56LocalRuntimeV1,
} from "./pdfExportRealdocE56Runtime.js"

const EVIDENCE_BEARER_TOKEN = "realdoc-e57-local-evidence-token-00000001"

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

export async function verifyFlowDocBackendRealdocE57V1(input: {
  semanticDirectory: string
  coreRoot?: string
  outputPath?: string | null
}) {
  const runtime = createFlowDocBackendRealdocE56LocalRuntimeV1({
    semanticDirectory: input.semanticDirectory,
    bearerToken: EVIDENCE_BEARER_TOKEN,
    port: 0,
    coreRoot: input.coreRoot,
  })
  const authorization = { authorization: `Bearer ${EVIDENCE_BEARER_TOKEN}` }
  try {
    const composition = await runtime.start()
    const origin = runtime.origin()
    if (origin == null || composition.draftPreviewMounted !== true) {
      throw new Error("REALDOC-E.5.7 local Draft Preview runtime did not start")
    }
    const contextResponse = await fetch(
      `${origin}/docgen-local/draft-preview-context?${new URLSearchParams({
        documentId: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
        documentRevision: String(FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION),
      })}`,
      { headers: authorization },
    )
    if (contextResponse.status !== 200) throw new Error("Draft Preview context route failed")
    const contextBody = await json(contextResponse)
    const context = contextBody.context
    const selectedProfile = context.mappingProfiles[0].profile
    if (
      context.target.kind !== "draft-preview"
      || context.target.snapshot.contracts.publishedStructureVersion !== false
      || context.contracts.separateDraftAdmission !== true
      || context.contracts.publishedApiParity !== false
    ) throw new Error("Draft Preview context identity drifted")

    const admissionResponse = await fetch(`${origin}/docgen-local/draft-preview-admissions`, {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "docgen:realdoc-e57:draft-preview",
      },
      body: JSON.stringify({
        contractVersion: 1,
        kind: "docgen-local-draft-preview-admission-request",
        snapshot: {
          snapshotId: context.admission.snapshotId,
          snapshotFingerprint: context.admission.snapshotFingerprint,
        },
        input: {
          kind: "adapted-json",
          mappingProfile: {
            mappingProfileId: selectedProfile.mappingProfileId,
            mappingProfileVersion: selectedProfile.mappingProfileVersion,
            profileFingerprint: selectedProfile.profileFingerprint,
          },
          payloadText: runtime.prepared.adaptedPayloadText,
        },
      }),
    })
    if (admissionResponse.status !== 202) {
      throw new Error(`Draft Preview admission failed: ${JSON.stringify(await json(admissionResponse))}`)
    }
    const admissionBody = await json(admissionResponse)
    const draftReceipt = admissionBody.admission
    const receipt = draftReceipt.generation
    if (
      draftReceipt.contracts.exactDraftSnapshot !== true
      || draftReceipt.contracts.separateDraftAdmission !== true
      || draftReceipt.contracts.publishedApiParity !== false
      || receipt.lane !== "adapted"
      || receipt.execution.mapping !== "executed"
      || receipt.execution.runtimeValidation !== "run-valid"
      || receipt.contracts.canonicalBusinessDataExposed !== false
    ) throw new Error("Draft Preview admission receipt drifted")
    if (JSON.stringify(admissionBody).includes(runtime.prepared.adaptedPayloadText.slice(0, 64))) {
      throw new Error("Draft Preview receipt leaked raw payload")
    }

    const exportResponse = await fetch(`${origin}/pdf-exports`, {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "pdf-export:realdoc-e57:draft-preview",
      },
      body: JSON.stringify({
        documentId: receipt.instance.instanceId,
        documentRevision: receipt.instance.revision,
      }),
    })
    if (exportResponse.status !== 202) throw new Error("Draft Preview PDF operation was rejected")
    let statusBody = await json(exportResponse)
    const operationId = statusBody.export.operationId as string
    const deadline = Date.now() + 300_000
    while (statusBody.export.state !== "completed") {
      if (Date.now() >= deadline) throw new Error("Draft Preview PDF operation timed out")
      if (["cancelled", "deadline-exceeded", "resource-rejected", "failed"].includes(statusBody.export.state)) {
        throw new Error(`Draft Preview PDF operation stopped: ${statusBody.export.state}`)
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      const statusResponse = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}`, {
        headers: authorization,
      })
      if (statusResponse.status !== 200) throw new Error("Draft Preview status route failed")
      statusBody = await json(statusResponse)
    }
    const download = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}/download`, {
      headers: authorization,
    })
    if (download.status !== 200 || download.headers.get("content-type") !== "application/pdf") {
      throw new Error("Draft Preview verified download failed")
    }
    const pdfBytes = new Uint8Array(await download.arrayBuffer())
    const evidence = {
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.5.7",
      status: "accepted",
      target: {
        kind: context.target.kind,
        draft: context.target.snapshot.draft,
        snapshotId: context.target.snapshot.snapshotId,
        snapshotFingerprint: context.target.snapshot.snapshotFingerprint,
        sourcePackageFingerprint: context.target.snapshot.sourcePackage.packageFingerprint,
        immutableSnapshot: context.target.snapshot.contracts.immutableSnapshot,
        publishedStructureVersion: context.target.snapshot.contracts.publishedStructureVersion,
        publishedApiParity: context.target.snapshot.contracts.publishedApiParity,
      },
      context: {
        authoring: context.authoring,
        contextFingerprint: context.contextFingerprint,
        projectionFingerprint: context.projection.projectionFingerprint,
        mappingProfileFingerprint: selectedProfile.profileFingerprint,
        businessValuesIncluded: context.contracts.businessValuesIncluded,
      },
      admission: {
        separateDraftAdmission: draftReceipt.contracts.separateDraftAdmission,
        sharedGenerationValidation: draftReceipt.contracts.sharedGenerationValidation,
        sharedArtifactLifecycle: draftReceipt.contracts.sharedArtifactLifecycle,
        lane: receipt.lane,
        mapping: receipt.execution.mapping,
        runtimeValidation: receipt.execution.runtimeValidation,
        canonicalInputFingerprint: receipt.canonicalInputFingerprint,
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
        separateFromPublishedAdmissionRoute: true,
        callerSuppliedPublishedStructureIdentity: false,
        browserMapper: false,
        mappedValuesReturnedToEditor: false,
        publishedApiParity: false,
        defaultApplicationServerMounted: false,
        productionBinding: false,
      },
    }
    if (JSON.stringify(evidence).includes("Ward Registry")) {
      throw new Error("retained E.5.7 evidence contains business text")
    }
    if (input.outputPath) {
      const outputPath = resolve(input.outputPath)
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, pdfBytes)
    }
    return { evidence, pdfBytes }
  } finally {
    await runtime.close()
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  const semanticDirectory = option("--semantic-dir")
  if (!semanticDirectory) throw new Error("--semantic-dir is required")
  const result = await verifyFlowDocBackendRealdocE57V1({
    semanticDirectory,
    coreRoot: option("--core-root") ?? undefined,
    outputPath: option("--output"),
  })
  const fixturePath = resolve(
    process.cwd(),
    "src/tests/fixtures/pdf-export-realdoc-e57-evidence.v1.json",
  )
  if (process.argv.includes("--update-fixture")) {
    writeFileSync(fixturePath, `${JSON.stringify(result.evidence, null, 2)}\n`, "utf8")
  } else {
    const retained = JSON.parse(readFileSync(fixturePath, "utf8"))
    if (JSON.stringify(retained) !== JSON.stringify(result.evidence)) {
      throw new Error("retained REALDOC-E.5.7 evidence drifted")
    }
  }
  process.stdout.write(`${JSON.stringify(result.evidence, null, 2)}\n`)
}
