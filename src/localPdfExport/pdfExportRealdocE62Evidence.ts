import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1,
  createFlowDocBackendDocGenLocalAdmissionServiceV1,
  createFlowDocBackendDocGenTrustedStructureRegistryV1,
  type FlowDocBackendDocGenLocalAdmissionRepositoryV1,
  type FlowDocBackendDocGenTrustedAssetRegistryV1,
} from "../docgen/docGenLocalAdmission.js"
import {
  createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
  type FlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
} from "../docgen/docGenLocalDurablePdfExport.js"
import { createFlowDocBackendDocGenLocalArtifactBindingV1 } from "../docgen/docGenLocalPdfExport.js"
import { createFlowDocBackendDocGenLocalUatArtifactMaterializerV1 } from "../docgen/docGenLocalUatArtifact.js"
import { handleFlowDocBackendPdfExportRouteV1 } from "../pdfExport/pdfExportRoute.js"
import { runFlowDocBackendPdfExportEndToEndCandidateV1 } from "../pdfExport/pdfExportWorkflow.js"
import {
  createFlowDocBackendRealdocE56UatMapperV1,
  prepareFlowDocBackendRealdocE56InputV1,
  type FlowDocBackendRealdocE56PreparedInputV1,
} from "./pdfExportRealdocE56Runtime.js"

const EVIDENCE_AUTHORIZATION = "Bearer realdoc-e62-durable-evidence-token-0001"
const ADMISSION_CALLER_KEY = "docgen:realdoc-e62:adapted-preview"
const EXPORT_CALLER_KEY = "pdf-export:realdoc-e62:adapted-preview"
const ADMISSION_ACCEPTED_AT = "2026-07-20T08:59:00.000Z"
const ACCEPTED_AT = "2026-07-20T09:00:00.000Z"
const CLAIMED_AT = "2026-07-20T09:00:01.000Z"
const HANDOFF_AT = "2026-07-20T09:00:02.000Z"
const FIRST_RENDER_AT = "2026-07-20T09:00:03.000Z"
const RECOVERY_RENDER_AT = "2026-07-20T09:00:20.000Z"
const CLAIM_EXPIRES_AT = "2026-07-20T09:04:00.000Z"
const CLAIM_TOKEN = "claim:realdoc-e62:attempt:1"
const WORKER_ID = "worker:realdoc-e62:local"
const IDENTITY = {
  tenantId: "tenant:pdf-export-realdoc-e56-local",
  principalId: "principal:pdf-export-realdoc-e56-local",
  authenticationId: "authentication:pdf-export-realdoc-e56-local",
}
const SCOPE = {
  tenantId: IDENTITY.tenantId,
  principalId: IDENTITY.principalId,
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1] ?? null
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function differencePaths(left: unknown, right: unknown, path = "$", paths: string[] = []): string[] {
  if (Object.is(left, right)) return paths
  if (
    left == null
    || right == null
    || typeof left !== "object"
    || typeof right !== "object"
    || Array.isArray(left) !== Array.isArray(right)
  ) {
    paths.push(path)
    return paths
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])
  keys.forEach((key) => differencePaths(leftRecord[key], rightRecord[key], `${path}.${key}`, paths))
  return paths
}

function security() {
  return {
    authenticator: {
      async authenticate({ authorization }: { authorization: string | null }) {
        return authorization === EVIDENCE_AUTHORIZATION
          ? { status: "authenticated" as const, identity: IDENTITY, issues: [] as [] }
          : { status: "unauthenticated" as const, identity: null, issues: [] as [] }
      },
    },
    authorizer: {
      async authorize() {
        return { status: "authorized" as const, authorizationId: "authorization:realdoc-e62", issues: [] as [] }
      },
    },
  }
}

function routeRequest(input: {
  method: "POST" | "GET"
  path: string
  idempotencyKey?: string | null
  body?: unknown
}) {
  return {
    method: input.method,
    path: input.path,
    authorization: EVIDENCE_AUTHORIZATION,
    idempotencyKey: input.idempotencyKey ?? null,
    body: input.body ?? null,
  }
}

function jsonValue(result: Awaited<ReturnType<typeof handleFlowDocBackendPdfExportRouteV1>>): Record<string, any> {
  if (result.body.kind !== "json") throw new Error("REALDOC-E.6.2 expected a JSON route response")
  return result.body.value as Record<string, any>
}

function repositories(composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1) {
  return {
    operationRepository: composition.operationRepository,
    lifecycleRepository: composition.lifecycleRepository,
    persistenceRepository: composition.persistenceRepository,
    observabilityRepository: composition.observabilityRepository,
    contentStore: composition.contentStore,
  }
}

function adaptedRequest(prepared: FlowDocBackendRealdocE56PreparedInputV1) {
  return {
    contractVersion: 1 as const,
    kind: "docgen-local-admission-request" as const,
    structure: prepared.request.structure,
    assets: prepared.request.assets,
    input: {
      kind: "adapted-json" as const,
      mappingProfile: {
        mappingProfileId: prepared.mappingProfile.mappingProfileId,
        mappingProfileVersion: prepared.mappingProfile.mappingProfileVersion,
      },
      payloadText: prepared.adaptedPayloadText,
    },
  }
}

function createStage(input: {
  coreRoot: string
  prepared: FlowDocBackendRealdocE56PreparedInputV1
  repository: FlowDocBackendDocGenLocalAdmissionRepositoryV1
  onMap?: () => void
  onMaterialize?: () => void
}) {
  const trustedAssetBytes = input.prepared.trustedAssets.map((asset) => ({
    definition: asset.definition,
    bytes: new Uint8Array(Buffer.from(asset.bytesBase64, "base64")),
  }))
  const assets: FlowDocBackendDocGenTrustedAssetRegistryV1 =
    createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1(trustedAssetBytes)
  const baseMapper = createFlowDocBackendRealdocE56UatMapperV1(input.coreRoot, input.prepared.mappingProfile)
  const mapper = {
    ...baseMapper,
    map(payload: unknown, context: Parameters<typeof baseMapper.map>[1]) {
      input.onMap?.()
      return baseMapper.map(payload, context)
    },
  }
  const structures = createFlowDocBackendDocGenTrustedStructureRegistryV1([{
    dataContract: input.prepared.dataContract,
    mappings: [{ profile: input.prepared.mappingProfile, mapper }],
  }])
  const admission = createFlowDocBackendDocGenLocalAdmissionServiceV1({
    structures,
    assets,
    repository: input.repository,
    now: () => ADMISSION_ACCEPTED_AT,
  })
  const baseMaterializer = createFlowDocBackendDocGenLocalUatArtifactMaterializerV1({ coreRoot: input.coreRoot })
  const materializer = {
    ...baseMaterializer,
    async materialize(value: Parameters<typeof baseMaterializer.materialize>[0]) {
      input.onMaterialize?.()
      return baseMaterializer.materialize(value)
    },
  }
  const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
    repository: input.repository,
    assets,
    materializer,
    operationIdFactory: () => "realdoc-e62-durable",
  })
  return { admission, binding }
}

async function operation(
  composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
  operationId: string,
) {
  const result = await composition.operationRepository.readByOperationId({ ...IDENTITY, operationId })
  if (result.status !== "found") throw new Error("REALDOC-E.6.2 durable operation is missing")
  return result.operation
}

async function lifecycle(
  composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
  operationId: string,
) {
  const result = await composition.lifecycleRepository.readLifecycle({ ...IDENTITY, operationId })
  if (result.status !== "found") throw new Error("REALDOC-E.6.2 durable lifecycle is missing")
  return result.head
}

async function createWorkflowInput(input: {
  composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1
  binding: ReturnType<typeof createFlowDocBackendDocGenLocalArtifactBindingV1>
  operationId: string
  now: string
}) {
  const durableOperation = await operation(input.composition, input.operationId)
  const durableLifecycle = await lifecycle(input.composition, input.operationId)
  if (durableLifecycle.status !== "claimed" || durableLifecycle.claim == null) {
    throw new Error("REALDOC-E.6.2 workflow requires the retained live claim")
  }
  return input.binding.createWorkflowInput({
    entry: {
      source: "flowdoc-backend-pdf-export-due-work",
      operationId: input.operationId,
      scope: durableOperation.scope,
      dueAt: durableOperation.acceptedAt,
      lane: "claim-ready",
      headRevision: durableLifecycle.headRevision,
      lifecycleFingerprint: durableLifecycle.lifecycleFingerprint,
      head: durableLifecycle,
    },
    operation: durableOperation,
    lifecycleHead: durableLifecycle,
    workerId: durableLifecycle.claim.workerId,
    claimToken: durableLifecycle.claim.claimToken,
    ownsClaim: true,
    attemptNumber: durableLifecycle.claim.attemptNumber,
    now: () => input.now,
  }, repositories(input.composition))
}

export async function verifyFlowDocBackendRealdocE62V1(input: {
  semanticDirectory: string
  coreRoot?: string
  rootDirectory?: string
}) {
  const coreRoot = resolve(input.coreRoot ?? resolve(process.cwd(), "../flowdoc-vnext-core"))
  const prepared = prepareFlowDocBackendRealdocE56InputV1(coreRoot, resolve(input.semanticDirectory))
  const ownsRoot = input.rootDirectory == null
  const rootDirectory = input.rootDirectory == null
    ? mkdtempSync(join(tmpdir(), "flowdoc-realdoc-e62-"))
    : resolve(input.rootDirectory)
  let composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1 | null = null
  try {
    let mapCount = 0
    let initialMaterializationCount = 0
    composition = await createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1({ rootDirectory })
    const initial = createStage({
      coreRoot,
      prepared,
      repository: composition.admissionRepository,
      onMap: () => { mapCount += 1 },
      onMaterialize: () => { initialMaterializationCount += 1 },
    })
    const admitted = await initial.admission.admit({
      identity: IDENTITY,
      callerIdempotencyKey: ADMISSION_CALLER_KEY,
      request: adaptedRequest(prepared),
    })
    if (admitted.status !== "created") throw new Error(`REALDOC-E.6.2 admission failed: ${admitted.status}`)
    const createdResponse = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "POST",
      path: "/pdf-exports",
      idempotencyKey: EXPORT_CALLER_KEY,
      body: {
        documentId: admitted.receipt.instance.instanceId,
        documentRevision: admitted.receipt.instance.revision,
      },
    }), {
      ...security(),
      ...repositories(composition),
      admissionResolver: initial.binding.admissionResolver,
      now: () => ACCEPTED_AT,
    })
    if (createdResponse.httpStatus !== 202) throw new Error("REALDOC-E.6.2 operation admission failed")
    const createdBody = jsonValue(createdResponse)
    const operationId = createdBody.export.operationId as string
    const pending = await lifecycle(composition, operationId)
    if (pending.status !== "pending") throw new Error("REALDOC-E.6.2 did not retain pending lifecycle")
    composition.close()
    composition = null

    let replayMapCount = 0
    let firstRenderMaterializationCount = 0
    composition = await createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1({ rootDirectory })
    const firstRender = createStage({
      coreRoot,
      prepared,
      repository: composition.admissionRepository,
      onMap: () => { replayMapCount += 1 },
      onMaterialize: () => { firstRenderMaterializationCount += 1 },
    })
    const replayedAdmission = await firstRender.admission.admit({
      identity: IDENTITY,
      callerIdempotencyKey: ADMISSION_CALLER_KEY,
      request: adaptedRequest(prepared),
    })
    if (replayedAdmission.status !== "replayed") throw new Error("REALDOC-E.6.2 admission did not replay")
    const claimed = await composition.lifecycleRepository.applyLifecycleTransition({
      transitionId: `claim:${operationId}:attempt:1`,
      ...SCOPE,
      operationId,
      expectedHeadRevision: pending.headRevision,
      transitionAt: CLAIMED_AT,
      kind: "claim",
      claimToken: CLAIM_TOKEN,
      workerId: WORKER_ID,
      claimExpiresAt: CLAIM_EXPIRES_AT,
    })
    if (claimed.status !== "applied") throw new Error("REALDOC-E.6.2 lifecycle claim failed")
    const handoff = await composition.lifecycleRepository.applyLifecycleTransition({
      transitionId: `before-handoff:${operationId}:attempt:1`,
      ...SCOPE,
      operationId,
      expectedHeadRevision: claimed.head.headRevision,
      transitionAt: HANDOFF_AT,
      kind: "pass-checkpoint",
      claimToken: CLAIM_TOKEN,
      nextCheckpoint: "before-render",
    })
    if (handoff.status !== "applied") throw new Error("REALDOC-E.6.2 lifecycle handoff failed")
    const firstWorkflow = await createWorkflowInput({
      composition,
      binding: firstRender.binding,
      operationId,
      now: FIRST_RENDER_AT,
    })
    let afterRenderFaultObserved = false
    try {
      await runFlowDocBackendPdfExportEndToEndCandidateV1({
        ...firstWorkflow,
        faultInjector({ point }) {
          if (point === "after-render") {
            afterRenderFaultObserved = true
            throw new Error("injected-realdoc-e62-after-render")
          }
        },
      })
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "injected-realdoc-e62-after-render") throw error
    }
    const afterRender = await lifecycle(composition, operationId)
    const beforeRecoveryPersistence = await composition.persistenceRepository.readByOperationId({
      ...IDENTITY,
      operationId,
    })
    if (
      !afterRenderFaultObserved
      || afterRender.status !== "claimed"
      || afterRender.checkpoint !== "before-persist"
      || beforeRecoveryPersistence.status !== "not-found"
    ) throw new Error("REALDOC-E.6.2 after-render restart checkpoint drifted")
    composition.close()
    composition = null

    let recoveryMaterializationCount = 0
    composition = await createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1({ rootDirectory })
    const recovery = createStage({
      coreRoot,
      prepared,
      repository: composition.admissionRepository,
      onMaterialize: () => { recoveryMaterializationCount += 1 },
    })
    const recoveryWorkflow = await createWorkflowInput({
      composition,
      binding: recovery.binding,
      operationId,
      now: RECOVERY_RENDER_AT,
    })
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(recoveryWorkflow)
    if (completed.status !== "completed" || completed.persistenceReceipt == null) {
      throw new Error(`REALDOC-E.6.2 recovery failed: ${completed.status}`)
    }
    const completionFingerprint = completed.completion.completionFingerprint
    const persistenceFingerprint = completed.persistenceReceipt.persistenceReceiptFingerprint
    composition.close()
    composition = null

    composition = await createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1({ rootDirectory })
    let verifyMaterializationCount = 0
    const verify = createStage({
      coreRoot,
      prepared,
      repository: composition.admissionRepository,
      onMaterialize: () => { verifyMaterializationCount += 1 },
    })
    const routeOptions = {
      ...security(),
      ...repositories(composition),
      admissionResolver: verify.binding.admissionResolver,
      now: () => "2026-07-20T09:00:30.000Z",
    }
    const statusResponse = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operationId)}`,
    }), routeOptions)
    const status = jsonValue(statusResponse).export as Record<string, any>
    const downloadResponse = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operationId)}/download`,
    }), routeOptions)
    if (downloadResponse.body.kind !== "pdf") throw new Error("REALDOC-E.6.2 verified download failed")
    const replayResponse = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
      method: "POST",
      path: "/pdf-exports",
      idempotencyKey: EXPORT_CALLER_KEY,
      body: {
        documentId: admitted.receipt.instance.instanceId,
        documentRevision: admitted.receipt.instance.revision,
      },
    }), routeOptions)
    const terminal = await composition.observabilityRepository.readTerminalWorkflow({ ...IDENTITY, operationId })
    const persistence = await composition.persistenceRepository.readByOperationId({ ...IDENTITY, operationId })
    if (terminal.status !== "found" || persistence.status !== "found") {
      throw new Error("REALDOC-E.6.2 terminal records are missing after reopen")
    }
    const pdfBytes = downloadResponse.body.bytes
    const pdfSha256 = sha256(pdfBytes)
    const evidence = {
      evidenceVersion: 1,
      phaseId: "PDF-EXPORT-REALDOC-E.6.2",
      status: "accepted",
      source: {
        sourceBundleFingerprint: prepared.evidence.sourceBundleFingerprint,
        adapterBundleFingerprint: prepared.evidence.adapterBundleFingerprint,
        requirementCount: prepared.evidence.requirementCount,
        screenshotCount: prepared.evidence.screenshotCount,
        adaptedPayloadByteLength: prepared.evidence.adaptedPayloadByteLength,
      },
      admission: {
        lane: admitted.receipt.lane,
        durablePersistence: admitted.receipt.contracts.durablePersistence,
        receiptFingerprint: admitted.receipt.receiptFingerprint,
        canonicalInputFingerprint: admitted.receipt.canonicalInputFingerprint,
        canonicalContentFingerprint: admitted.receipt.canonicalContentFingerprint,
        initialMapCount: mapCount,
        restartReplayMapCount: replayMapCount,
        rawPayloadRetained: admitted.receipt.contracts.rawPayloadRetained,
        canonicalBusinessDataExposed: admitted.receipt.contracts.canonicalBusinessDataExposed,
      },
      restart: {
        repositoryOpenCount: 4,
        pendingReopen: true,
        afterRenderFaultObserved,
        afterRenderCheckpoint: afterRender.checkpoint,
        beforeRecoveryPersistence: beforeRecoveryPersistence.status,
        recoveryStatus: completed.status,
        terminalReopen: true,
        initialMaterializationCount,
        firstRenderMaterializationCount,
        recoveryMaterializationCount,
        verifyMaterializationCount,
      },
      artifact: {
        state: status.state,
        pageCount: status.pageCount,
        byteLength: pdfBytes.byteLength,
        sha256: pdfSha256,
        metadataByteLength: persistence.receipt.bytes.byteLength,
        metadataSha256: persistence.receipt.bytes.sha256,
        metadataMatchesDownload: persistence.receipt.bytes.byteLength === pdfBytes.byteLength
          && persistence.receipt.bytes.sha256 === pdfSha256,
        completionFingerprint,
        persistenceFingerprint,
        terminalEventCount: terminal.events.length,
        verifiedDownload: downloadResponse.httpStatus === 200,
        idempotentReplay: replayResponse.httpStatus === 200
          && jsonValue(replayResponse).status === "idempotent-replay",
      },
      scale: {
        acceptedSlicePages: status.pageCount,
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
    }
    const gates = {
      initialMapOnce: mapCount === 1,
      adaptedAdmissionLane: admitted.receipt.lane === "adapted",
      restartDoesNotRemap: replayMapCount === 0,
      terminalCompleted: status.state === "completed",
      acceptedSlicePageCount: status.pageCount === 10,
      terminalReadDoesNotMaterialize: verifyMaterializationCount === 0,
      metadataMatchesDownload: evidence.artifact.metadataMatchesDownload === true,
      verifiedDownload: evidence.artifact.verifiedDownload === true,
      idempotentReplay: evidence.artifact.idempotentReplay === true,
      contentFreeEvidence: !JSON.stringify(evidence).includes("Ward Registry"),
    }
    const failedGates = Object.entries(gates).filter(([, accepted]) => !accepted).map(([name]) => name)
    if (failedGates.length > 0) {
      throw new Error(`REALDOC-E.6.2 retained evidence drifted: ${failedGates.join(", ")}`)
    }
    return evidence
  } finally {
    composition?.close()
    if (ownsRoot) rmSync(rootDirectory, { recursive: true, force: true })
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  const semanticDirectory = option("--semantic-dir")
  if (semanticDirectory == null) throw new Error("--semantic-dir is required")
  const evidence = await verifyFlowDocBackendRealdocE62V1({
    semanticDirectory,
    coreRoot: option("--core-root") ?? undefined,
    rootDirectory: option("--root") ?? undefined,
  })
  const fixturePath = resolve(
    process.cwd(),
    "src/tests/fixtures/pdf-export-realdoc-e62-durable-lifecycle-evidence.v1.json",
  )
  if (process.argv.includes("--update-fixture")) {
    writeFileSync(fixturePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
  } else {
    const retained = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown
    if (JSON.stringify(retained) !== JSON.stringify(evidence)) {
      const paths = differencePaths(retained, evidence).slice(0, 20)
      throw new Error(`retained REALDOC-E.6.2 evidence drifted: ${paths.join(", ")}`)
    }
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}
