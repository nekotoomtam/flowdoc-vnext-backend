import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  createFlowDocBackendDocGenInMemoryAdmissionRepositoryV1,
  createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1,
  createFlowDocBackendDocGenLocalAdmissionServiceV1,
  createFlowDocBackendDocGenLocalArtifactBindingV1,
  createFlowDocBackendDocGenLocalUatArtifactMaterializerV1,
  createFlowDocBackendDocGenTrustedStructureRegistryV1,
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1,
  createInMemoryFlowDocBackendPdfExportObservabilityRepositoryV1,
  createInMemoryFlowDocBackendPdfExportOperationRepositoryV1,
  handleFlowDocBackendPdfExportRouteV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
  type FlowDocBackendDocGenLocalAdmissionRequestV1,
  type FlowDocBackendDocGenTrustedAssetBytesV1,
  type FlowDocBackendPdfExportAuthenticatedIdentityV1,
  type FlowDocBackendPdfExportRouteOptionsV1,
} from "../index.js"

interface PreparedInputV1 {
  dataContract: Parameters<typeof createFlowDocBackendDocGenTrustedStructureRegistryV1>[0][number]["dataContract"]
  request: FlowDocBackendDocGenLocalAdmissionRequestV1
  trustedAssets: Array<{
    definition: FlowDocBackendDocGenTrustedAssetBytesV1["definition"]
    bytesBase64: string
  }>
  evidence: {
    sourceBundleFingerprint: string
    adapterBundleFingerprint: string
    selectedImageCanonicalDigest: string
    requirementCount: number
    screenshotCount: number
  }
}

const IDENTITY: FlowDocBackendPdfExportAuthenticatedIdentityV1 = {
  tenantId: "tenant:pdf-export-realdoc-e4-local",
  principalId: "principal:pdf-export-realdoc-e4-local",
  authenticationId: "authentication:pdf-export-realdoc-e4-local",
}
const AUTHORIZATION = "Bearer pdf-export-realdoc-e4-local"

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1] ?? null
}

function prepare(coreRoot: string, semanticDirectory: string): PreparedInputV1 {
  const command = resolve(
    coreRoot,
    "packages/uat-realdoc/local-runtime/prepare-69c-docgen-local-input.mjs",
  )
  const result = spawnSync(process.execPath, [command, semanticDirectory], {
    cwd: coreRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error("69C DocGen local input preparation failed")
  return JSON.parse(result.stdout) as PreparedInputV1
}

function security() {
  return {
    authenticator: {
      async authenticate({ authorization }: { authorization: string | null }) {
        if (authorization !== AUTHORIZATION) return {
          status: "unauthenticated" as const,
          identity: null,
          issues: [] as [],
        }
        return { status: "authenticated" as const, identity: IDENTITY, issues: [] as [] }
      },
    },
    authorizer: {
      async authorize() {
        return { status: "authorized" as const, authorizationId: "authorization:realdoc-e4-local", issues: [] as [] }
      },
    },
  }
}

function jsonValue(response: Awaited<ReturnType<typeof handleFlowDocBackendPdfExportRouteV1>>) {
  if (response.body.kind !== "json") throw new Error("expected JSON route response")
  return response.body.value as Record<string, unknown>
}

export async function verifyFlowDocBackendRealdocE4V1(input: {
  semanticDirectory: string
  coreRoot?: string
  outputPath?: string | null
}) {
  const coreRoot = resolve(input.coreRoot ?? resolve(process.cwd(), "../flowdoc-vnext-core"))
  const prepared = prepare(coreRoot, resolve(input.semanticDirectory))
  const repository = createFlowDocBackendDocGenInMemoryAdmissionRepositoryV1()
  const assets = createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1(
    prepared.trustedAssets.map((asset) => ({
      definition: asset.definition,
      bytes: new Uint8Array(Buffer.from(asset.bytesBase64, "base64")),
    })),
  )
  const structures = createFlowDocBackendDocGenTrustedStructureRegistryV1([{
    dataContract: prepared.dataContract,
  }])
  const admission = createFlowDocBackendDocGenLocalAdmissionServiceV1({
    structures,
    assets,
    repository,
    now: () => "2026-07-19T12:00:00.000Z",
  })
  const admitted = await admission.admit({
    identity: IDENTITY,
    callerIdempotencyKey: "docgen:realdoc-e4:69c-section-2-1",
    request: prepared.request,
  })
  if (admitted.status !== "created") throw new Error("69C Backend DocGen admission failed")

  let operationNumber = 0
  const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
    repository,
    assets,
    materializer: createFlowDocBackendDocGenLocalUatArtifactMaterializerV1({ coreRoot }),
    operationIdFactory: () => `69c-section-2-1-${++operationNumber}`,
  })
  const repositories = {
    operationRepository: createInMemoryFlowDocBackendPdfExportOperationRepositoryV1(),
    lifecycleRepository: createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1(),
    persistenceRepository: createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1(),
    observabilityRepository: createInMemoryFlowDocBackendPdfExportObservabilityRepositoryV1(),
  }
  const storageRoot = mkdtempSync(join(tmpdir(), "flowdoc-realdoc-e4-"))
  try {
    const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: storageRoot })
    const options: FlowDocBackendPdfExportRouteOptionsV1 = {
      ...security(),
      ...repositories,
      contentStore,
      admissionResolver: binding.admissionResolver,
      now: () => "2026-07-19T12:00:01.000Z",
    }
    const pin = {
      documentId: admitted.receipt.instance.instanceId,
      documentRevision: admitted.receipt.instance.revision,
    }
    const requestRoute = async (callerKey: string) => handleFlowDocBackendPdfExportRouteV1({
      method: "POST",
      path: "/pdf-exports",
      authorization: AUTHORIZATION,
      idempotencyKey: callerKey,
      body: pin,
    }, options)

    const created = await requestRoute("pdf-export:realdoc-e4:artifact")
    if (created.httpStatus !== 202) throw new Error("69C PDF export route did not admit an operation")
    const replay = await requestRoute("pdf-export:realdoc-e4:artifact")
    if (replay.httpStatus !== 200 || jsonValue(replay).status !== "idempotent-replay") {
      throw new Error("69C PDF export route did not replay its caller key")
    }
    const found = await repositories.operationRepository.readByCallerKey({
      tenantId: IDENTITY.tenantId,
      principalId: IDENTITY.principalId,
      callerIdempotencyKey: "pdf-export:realdoc-e4:artifact",
    })
    if (found.status !== "found") throw new Error("69C PDF operation was not retained")
    const operation = found.operation
    const claimToken = "claim:realdoc-e4:69c-section-2-1"
    const claimed = await repositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: `claim:${operation.operationId}:attempt:1`,
      ...operation.scope,
      operationId: operation.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-19T12:00:02.000Z",
      kind: "claim",
      claimToken,
      workerId: "worker:realdoc-e4:local",
      claimExpiresAt: "2026-07-19T12:03:02.000Z",
    })
    if (claimed.status !== "applied") throw new Error("69C PDF worker claim failed")
    const handoff = await repositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: `before-handoff:${operation.operationId}:attempt:1`,
      ...operation.scope,
      operationId: operation.operationId,
      expectedHeadRevision: 1,
      transitionAt: "2026-07-19T12:00:03.000Z",
      kind: "pass-checkpoint",
      claimToken,
      nextCheckpoint: "before-render",
    })
    if (handoff.status !== "applied") throw new Error("69C PDF worker handoff checkpoint failed")
    const lifecycle = await repositories.lifecycleRepository.readLifecycle({
      ...operation.scope,
      operationId: operation.operationId,
    })
    if (lifecycle.status !== "found") throw new Error("69C PDF lifecycle is unavailable")
    const workflowInput = await binding.createWorkflowInput({
      entry: {
        source: "flowdoc-backend-pdf-export-due-work",
        operationId: operation.operationId,
        scope: operation.scope,
        dueAt: "2026-07-19T12:00:01.000Z",
        lane: "claim-ready",
        headRevision: lifecycle.head.headRevision,
        lifecycleFingerprint: lifecycle.head.lifecycleFingerprint,
        head: lifecycle.head,
      },
      operation,
      lifecycleHead: lifecycle.head,
      workerId: "worker:realdoc-e4:local",
      claimToken,
      ownsClaim: true,
      attemptNumber: 1,
      now: () => "2026-07-19T12:00:04.000Z",
    }, { ...repositories, contentStore })
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(workflowInput)
    if (completed.status !== "completed") throw new Error("69C local artifact workflow did not complete")

    const status = await handleFlowDocBackendPdfExportRouteV1({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operation.operationId)}`,
      authorization: AUTHORIZATION,
      idempotencyKey: null,
      body: null,
    }, options)
    const download = await handleFlowDocBackendPdfExportRouteV1({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operation.operationId)}/download`,
      authorization: AUTHORIZATION,
      idempotencyKey: null,
      body: null,
    }, options)
    if (status.httpStatus !== 200 || download.httpStatus !== 200 || download.body.kind !== "pdf") {
      throw new Error("69C completed artifact status or verified download failed")
    }
    const pdfBytes = download.body.bytes
    if (Buffer.from(pdfBytes).subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("69C verified download is not a PDF")
    }

    const cancelCreated = await requestRoute("pdf-export:realdoc-e4:cancel")
    if (cancelCreated.httpStatus !== 202) throw new Error("69C cancellation probe was not admitted")
    const cancelOperation = await repositories.operationRepository.readByCallerKey({
      tenantId: IDENTITY.tenantId,
      principalId: IDENTITY.principalId,
      callerIdempotencyKey: "pdf-export:realdoc-e4:cancel",
    })
    if (cancelOperation.status !== "found") throw new Error("69C cancellation operation is unavailable")
    const cancelled = await handleFlowDocBackendPdfExportRouteV1({
      method: "POST",
      path: `/pdf-exports/${encodeURIComponent(cancelOperation.operation.operationId)}/cancel`,
      authorization: AUTHORIZATION,
      idempotencyKey: "cancel:realdoc-e4:69c-section-2-1",
      body: null,
    }, options)
    if (cancelled.httpStatus !== 200) throw new Error("69C cancellation route failed")
    const cancelledPersistence = await repositories.persistenceRepository.readByOperationId({
      ...cancelOperation.operation.scope,
      operationId: cancelOperation.operation.operationId,
    })
    if (cancelledPersistence.status !== "not-found") throw new Error("cancelled 69C operation persisted bytes")

    if (input.outputPath != null) {
      const outputPath = resolve(input.outputPath)
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, pdfBytes)
    }
    const statusValue = jsonValue(status) as { export?: { pageCount?: number; byteLength?: number } }
    const evidence = {
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.4",
      status: "accepted",
      source: prepared.evidence,
      admission: {
        lane: admitted.receipt.lane,
        instanceId: admitted.receipt.instance.instanceId,
        instanceRevision: admitted.receipt.instance.revision,
        canonicalInputFingerprint: admitted.receipt.canonicalInputFingerprint,
        protectedRecordFingerprint: (await repository.readByAdmissionId(admitted.receipt.admissionId))?.recordFingerprint,
        rawPayloadRetained: admitted.receipt.contracts.rawPayloadRetained,
      },
      artifactIdentity: {
        documentFingerprint: operation.admission.exportIdentity.sourceIdentity.documentFingerprint,
        requestFingerprint: operation.admission.exportIdentity.requestFingerprint,
        measuredContractFingerprint: operation.admission.exportIdentity.sourceContractFingerprint,
      },
      artifact: {
        pageCount: statusValue.export?.pageCount,
        byteLength: pdfBytes.byteLength,
        sha256: sha256(pdfBytes),
        verifiedDownload: true,
      },
      lifecycle: {
        routeReplay: true,
        workerWorkflow: completed.status,
        persistence: completed.persistenceReceipt == null ? "missing" : "retained",
        status: "completed",
        cancellationBeforeWorker: true,
        cancelledBytesPersisted: false,
      },
      contracts: {
        protectedCanonicalRecordOnly: binding.facts.protectedCanonicalRecordOnly,
        rawPayloadRead: binding.facts.rawPayloadRead,
        existingArtifactLifecycleReused: binding.facts.existingArtifactLifecycleReused,
        defaultApplicationServerMounted: binding.facts.defaultApplicationServerMounted,
        durableGenerationPersistence: binding.facts.durableGenerationPersistence,
        productionBinding: binding.facts.productionBinding,
      },
    }
    if (JSON.stringify(evidence).includes("Ward Registry")) throw new Error("retained E.4 evidence contains source text")
    return { evidence, pdfBytes }
  } finally {
    rmSync(storageRoot, { recursive: true, force: true })
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  const semanticDirectory = option("--semantic-dir")
  if (semanticDirectory == null) throw new Error("--semantic-dir is required")
  const result = await verifyFlowDocBackendRealdocE4V1({
    semanticDirectory,
    coreRoot: option("--core-root") ?? undefined,
    outputPath: option("--output"),
  })
  const fixturePath = resolve(
    process.cwd(),
    "src/tests/fixtures/pdf-export-realdoc-e4-evidence.v1.json",
  )
  if (process.argv.includes("--update-fixture")) {
    writeFileSync(fixturePath, `${JSON.stringify(result.evidence, null, 2)}\n`, "utf8")
  } else {
    const retained = JSON.parse(readFileSync(fixturePath, "utf8"))
    if (JSON.stringify(retained) !== JSON.stringify(result.evidence)) {
      throw new Error("retained REALDOC-E.4 evidence drifted")
    }
  }
  process.stdout.write(`${JSON.stringify(result.evidence, null, 2)}\n`)
}
