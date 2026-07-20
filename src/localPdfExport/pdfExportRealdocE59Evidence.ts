import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
  FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
  createFlowDocBackendRealdocE56LocalRuntimeV1,
} from "./pdfExportRealdocE56Runtime.js"

const EVIDENCE_BEARER_TOKEN = "realdoc-e59-local-evidence-token-00000001"

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

async function waitForArtifact(
  origin: string,
  authorization: Record<string, string>,
  operationId: string,
): Promise<Record<string, any>> {
  const deadline = Date.now() + 300_000
  while (true) {
    if (Date.now() >= deadline) throw new Error("REALDOC-E.5.9 PDF operation timed out")
    const response = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}`, {
      headers: authorization,
    })
    if (response.status !== 200) throw new Error("REALDOC-E.5.9 status route failed")
    const body = await json(response)
    if (body.export.state === "completed") return body.export
    if (["cancelled", "deadline-exceeded", "resource-rejected", "failed"].includes(body.export.state)) {
      throw new Error(`REALDOC-E.5.9 PDF operation stopped: ${body.export.state}`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
}

async function downloadArtifact(
  origin: string,
  authorization: Record<string, string>,
  operationId: string,
): Promise<Uint8Array> {
  const response = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}/download`, {
    headers: authorization,
  })
  if (response.status !== 200 || response.headers.get("content-type") !== "application/pdf") {
    throw new Error("REALDOC-E.5.9 verified download failed")
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function verifyFlowDocBackendRealdocE59V1(input: {
  semanticDirectory: string
  coreRoot?: string
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
    if (
      origin == null
      || composition.docGenAdmissionMounted !== true
      || composition.publishedPreviewContextMounted !== true
    ) {
      throw new Error("REALDOC-E.5.9 local parity runtime did not start")
    }
    const contextResponse = await fetch(
      `${origin}/docgen-local/published-preview-context?${new URLSearchParams({
        documentId: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
        documentRevision: String(FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION),
      })}`,
      { headers: authorization },
    )
    if (contextResponse.status !== 200) throw new Error("REALDOC-E.5.9 Published context route failed")
    const context = (await json(contextResponse)).context
    const profile = context.mappingProfiles[0].profile

    const directResponse = await fetch(`${origin}/docgen-local/admissions`, {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "docgen:realdoc-e59:form-direct",
      },
      body: JSON.stringify({
        ...runtime.prepared.request,
        structure: context.admission.structure,
        assets: context.admission.assets,
      }),
    })
    if (directResponse.status !== 202) throw new Error("REALDOC-E.5.9 direct Form-shaped admission failed")
    const direct = (await json(directResponse)).admission

    const adaptedResponse = await fetch(`${origin}/docgen-local/admissions`, {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": "docgen:realdoc-e59:api-adapted",
      },
      body: JSON.stringify({
        contractVersion: 1,
        kind: "docgen-local-admission-request",
        structure: context.admission.structure,
        assets: context.admission.assets,
        input: {
          kind: "adapted-json",
          mappingProfile: {
            mappingProfileId: profile.mappingProfileId,
            mappingProfileVersion: profile.mappingProfileVersion,
          },
          payloadText: runtime.prepared.adaptedPayloadText,
        },
      }),
    })
    if (adaptedResponse.status !== 202) throw new Error("REALDOC-E.5.9 adapted API admission failed")
    const adapted = (await json(adaptedResponse)).admission

    if (
      direct.lane !== "direct"
      || direct.mappingProfile !== null
      || direct.execution.mapping !== "not-required"
      || adapted.lane !== "adapted"
      || adapted.execution.mapping !== "executed"
      || direct.execution.runtimeValidation !== "run-valid"
      || adapted.execution.runtimeValidation !== "run-valid"
      || direct.canonicalContentFingerprint !== adapted.canonicalContentFingerprint
      || direct.canonicalInputFingerprint === adapted.canonicalInputFingerprint
      || direct.instance.instanceId === adapted.instance.instanceId
    ) throw new Error("REALDOC-E.5.9 Form/API canonical parity drifted")

    const requestExport = async (receipt: Record<string, any>, key: string) => {
      const response = await fetch(`${origin}/pdf-exports`, {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({
          documentId: receipt.instance.instanceId,
          documentRevision: receipt.instance.revision,
        }),
      })
      if (response.status !== 202) throw new Error("REALDOC-E.5.9 PDF operation was rejected")
      return (await json(response)).export.operationId as string
    }
    const directOperationId = await requestExport(direct, "pdf-export:realdoc-e59:form-direct")
    const adaptedOperationId = await requestExport(adapted, "pdf-export:realdoc-e59:api-adapted")
    const [directStatus, adaptedStatus] = await Promise.all([
      waitForArtifact(origin, authorization, directOperationId),
      waitForArtifact(origin, authorization, adaptedOperationId),
    ])
    const [directBytes, adaptedBytes] = await Promise.all([
      downloadArtifact(origin, authorization, directOperationId),
      downloadArtifact(origin, authorization, adaptedOperationId),
    ])
    if (directStatus.pageCount !== 10 || adaptedStatus.pageCount !== 10) {
      throw new Error("REALDOC-E.5.9 artifact page parity drifted")
    }

    const evidence = {
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.5.9",
      status: "accepted",
      source: {
        adaptedPayloadByteLength: runtime.prepared.evidence.adaptedPayloadByteLength,
        requirementCount: runtime.prepared.evidence.requirementCount,
        screenshotCount: runtime.prepared.evidence.screenshotCount,
        projectionFingerprint: runtime.prepared.projection.projectionFingerprint,
      },
      directForm: {
        lane: direct.lane,
        mapping: direct.execution.mapping,
        runtimeValidation: direct.execution.runtimeValidation,
        canonicalInputFingerprint: direct.canonicalInputFingerprint,
        diagnosticErrorCount: direct.diagnostics.summary.errorCount,
        diagnosticWarningCount: direct.diagnostics.summary.warningCount,
      },
      adaptedApi: {
        lane: adapted.lane,
        mapping: adapted.execution.mapping,
        runtimeValidation: adapted.execution.runtimeValidation,
        canonicalInputFingerprint: adapted.canonicalInputFingerprint,
        diagnosticErrorCount: adapted.diagnostics.summary.errorCount,
        diagnosticWarningCount: adapted.diagnostics.summary.warningCount,
      },
      parity: {
        canonicalContentFingerprint: direct.canonicalContentFingerprint,
        sameCanonicalContent: true,
        distinctInstanceIdentity: true,
        distinctCanonicalInputIdentity: true,
      },
      artifacts: {
        direct: { pageCount: directStatus.pageCount, byteLength: directBytes.byteLength, sha256: sha256(directBytes) },
        adapted: { pageCount: adaptedStatus.pageCount, byteLength: adaptedBytes.byteLength, sha256: sha256(adaptedBytes) },
        sameBytes: sha256(directBytes) === sha256(adaptedBytes),
      },
      contracts: {
        formUsesDirectCanonicalAdmission: true,
        apiUsesTrustedMapping: true,
        backendValidationShared: true,
        browserMapper: false,
        mappedValuesReturnedToEditor: false,
        authoredStructureMutated: false,
        productionBinding: false,
      },
    }
    if (JSON.stringify(evidence).includes("Ward Registry")) {
      throw new Error("retained REALDOC-E.5.9 evidence contains business text")
    }
    return evidence
  } finally {
    await runtime.close()
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  const semanticDirectory = option("--semantic-dir")
  if (!semanticDirectory) throw new Error("--semantic-dir is required")
  const evidence = await verifyFlowDocBackendRealdocE59V1({
    semanticDirectory,
    coreRoot: option("--core-root") ?? undefined,
  })
  const fixturePath = resolve(
    process.cwd(),
    "src/tests/fixtures/pdf-export-realdoc-e59-form-api-parity-evidence.v1.json",
  )
  if (process.argv.includes("--update-fixture")) {
    writeFileSync(fixturePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
  } else {
    const retained = JSON.parse(readFileSync(fixturePath, "utf8"))
    if (JSON.stringify(retained) !== JSON.stringify(evidence)) {
      throw new Error("retained REALDOC-E.5.9 evidence drifted")
    }
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}
