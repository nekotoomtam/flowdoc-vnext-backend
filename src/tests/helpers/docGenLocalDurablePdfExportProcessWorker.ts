import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  createFlowDocBackendDocGenLocalArtifactBindingV1,
  createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
  handleFlowDocBackendPdfExportRouteV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
  type FlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
} from "../../index.js"
import {
  DOCGEN_LOCAL_AUTHORIZATION,
  DOCGEN_LOCAL_IDENTITY,
  createDocGenLocalAdmissionFixture,
  docGenLocalAdaptedRequest,
  docGenLocalMapper,
} from "./docGenLocalFixture.js"
import { docGenLocalPdfMaterializer } from "./docGenLocalPdfExportFixture.js"

type WorkerMode = "create" | "render-fault" | "complete" | "verify"

interface WorkerInput {
  mode: WorkerMode
  rootDirectory: string
  operationId?: string
  instanceId?: string
}

const ADMISSION_CALLER_KEY = "docgen:e62:durable-admission"
const EXPORT_CALLER_KEY = "pdf-export:e62:durable-operation"
const PAYLOAD = JSON.stringify({ title: "Durable report", name: "Durable item", amount: 62 })
const ACCEPTED_AT = "2026-07-20T08:00:00.000Z"
const CLAIMED_AT = "2026-07-20T08:00:01.000Z"
const HANDOFF_AT = "2026-07-20T08:00:02.000Z"
const RENDER_AT = "2026-07-20T08:00:03.000Z"
const COMPLETE_AT = "2026-07-20T08:00:20.000Z"
const CLAIM_EXPIRES_AT = "2026-07-20T08:03:01.000Z"
const CLAIM_TOKEN = "claim:docgen-e62:attempt:1"
const WORKER_ID = "worker:docgen-e62:local"

function security() {
  return {
    authenticator: {
      async authenticate({ authorization }: { authorization: string | null }) {
        if (authorization !== DOCGEN_LOCAL_AUTHORIZATION) return {
          status: "unauthenticated" as const,
          identity: null,
          issues: [] as [],
        }
        return { status: "authenticated" as const, identity: DOCGEN_LOCAL_IDENTITY, issues: [] as [] }
      },
    },
    authorizer: {
      async authorize() {
        return { status: "authorized" as const, authorizationId: "authorization:docgen-e62", issues: [] as [] }
      },
    },
  }
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

function routeRequest(input: {
  method: "POST" | "GET"
  path: string
  idempotencyKey?: string | null
  body?: unknown
}) {
  return {
    method: input.method,
    path: input.path,
    authorization: DOCGEN_LOCAL_AUTHORIZATION,
    idempotencyKey: input.idempotencyKey ?? null,
    body: input.body ?? null,
  }
}

function jsonValue(result: Awaited<ReturnType<typeof handleFlowDocBackendPdfExportRouteV1>>): Record<string, any> {
  if (result.body.kind !== "json") throw new Error("expected JSON route response")
  return result.body.value as Record<string, any>
}

async function readOperation(
  composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
  operationId: string,
) {
  const result = await composition.operationRepository.readByOperationId({
    tenantId: DOCGEN_LOCAL_IDENTITY.tenantId,
    principalId: DOCGEN_LOCAL_IDENTITY.principalId,
    operationId,
  })
  if (result.status !== "found") throw new Error("durable operation is missing")
  return result.operation
}

async function readLifecycle(
  composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
  operationId: string,
) {
  const result = await composition.lifecycleRepository.readLifecycle({
    tenantId: DOCGEN_LOCAL_IDENTITY.tenantId,
    principalId: DOCGEN_LOCAL_IDENTITY.principalId,
    operationId,
  })
  if (result.status !== "found") throw new Error("durable lifecycle is missing")
  return result.head
}

async function claimPending(
  composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
  operationId: string,
) {
  const pending = await readLifecycle(composition, operationId)
  if (pending.status !== "pending") throw new Error("expected pending lifecycle before durable render")
  const claimed = await composition.lifecycleRepository.applyLifecycleTransition({
    transitionId: `claim:${operationId}:attempt:1`,
    ...pending.scope,
    operationId,
    expectedHeadRevision: pending.headRevision,
    transitionAt: CLAIMED_AT,
    kind: "claim",
    claimToken: CLAIM_TOKEN,
    workerId: WORKER_ID,
    claimExpiresAt: CLAIM_EXPIRES_AT,
  })
  if (claimed.status !== "applied") throw new Error("durable lifecycle claim failed")
  const handoff = await composition.lifecycleRepository.applyLifecycleTransition({
    transitionId: `before-handoff:${operationId}:attempt:1`,
    ...pending.scope,
    operationId,
    expectedHeadRevision: claimed.head.headRevision,
    transitionAt: HANDOFF_AT,
    kind: "pass-checkpoint",
    claimToken: CLAIM_TOKEN,
    nextCheckpoint: "before-render",
  })
  if (handoff.status !== "applied") throw new Error("durable lifecycle handoff failed")
  return handoff.head
}

async function workflowInput(input: {
  composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1
  operationId: string
  now: string
  onMaterialize: () => void
}) {
  const operation = await readOperation(input.composition, input.operationId)
  const lifecycle = await readLifecycle(input.composition, input.operationId)
  if (lifecycle.status !== "claimed" || lifecycle.claim == null) {
    throw new Error("durable workflow requires the retained live claim")
  }
  let mapperCount = 0
  const fixture = createDocGenLocalAdmissionFixture({
    repository: input.composition.admissionRepository,
    mapper: docGenLocalMapper({ onMap: () => { mapperCount += 1 } }),
  })
  const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
    repository: input.composition.admissionRepository,
    assets: fixture.assets,
    materializer: docGenLocalPdfMaterializer(input.onMaterialize),
  })
  const value = await binding.createWorkflowInput({
    entry: {
      source: "flowdoc-backend-pdf-export-due-work",
      operationId: operation.operationId,
      scope: operation.scope,
      dueAt: operation.acceptedAt,
      lane: "claim-ready",
      headRevision: lifecycle.headRevision,
      lifecycleFingerprint: lifecycle.lifecycleFingerprint,
      head: lifecycle,
    },
    operation,
    lifecycleHead: lifecycle,
    workerId: lifecycle.claim.workerId,
    claimToken: lifecycle.claim.claimToken,
    ownsClaim: true,
    attemptNumber: lifecycle.claim.attemptNumber,
    now: () => input.now,
  }, repositories(input.composition))
  return { value, mapperCount }
}

async function create(input: WorkerInput, composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1) {
  let mapperCount = 0
  let materializerCount = 0
  const fixture = createDocGenLocalAdmissionFixture({
    repository: composition.admissionRepository,
    mapper: docGenLocalMapper({ onMap: () => { mapperCount += 1 } }),
  })
  const admission = await fixture.admission.admit({
    identity: DOCGEN_LOCAL_IDENTITY,
    callerIdempotencyKey: ADMISSION_CALLER_KEY,
    request: docGenLocalAdaptedRequest(PAYLOAD),
  })
  if (admission.status !== "created") throw new Error(`durable admission failed: ${admission.status}`)
  const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
    repository: composition.admissionRepository,
    assets: fixture.assets,
    materializer: docGenLocalPdfMaterializer(() => { materializerCount += 1 }),
    operationIdFactory: () => "docgen-e62-durable",
  })
  const response = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
    method: "POST",
    path: "/pdf-exports",
    idempotencyKey: EXPORT_CALLER_KEY,
    body: {
      documentId: admission.receipt.instance.instanceId,
      documentRevision: admission.receipt.instance.revision,
    },
  }), {
    ...security(),
    ...repositories(composition),
    admissionResolver: binding.admissionResolver,
    now: () => ACCEPTED_AT,
  })
  if (response.httpStatus !== 202) throw new Error(`durable operation route failed: ${response.httpStatus}`)
  const body = jsonValue(response)
  const operationId = body.export.operationId as string
  const lifecycle = await readLifecycle(composition, operationId)
  return {
    mode: input.mode,
    admissionStatus: admission.status,
    durablePersistence: admission.receipt.contracts.durablePersistence,
    receiptFingerprint: admission.receipt.receiptFingerprint,
    instanceId: admission.receipt.instance.instanceId,
    operationId,
    operationState: body.export.state,
    lifecycleStatus: lifecycle.status,
    lifecycleCheckpoint: lifecycle.checkpoint,
    mapperCount,
    materializerCount,
    productionBinding: composition.facts.productionBinding,
  }
}

async function renderFault(input: WorkerInput, composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1) {
  if (input.operationId == null) throw new Error("render-fault operation id is required")
  await claimPending(composition, input.operationId)
  let materializerCount = 0
  const workflow = await workflowInput({
    composition,
    operationId: input.operationId,
    now: RENDER_AT,
    onMaterialize: () => { materializerCount += 1 },
  })
  let faultObserved = false
  try {
    await runFlowDocBackendPdfExportEndToEndCandidateV1({
      ...workflow.value,
      faultInjector({ point }) {
        if (point === "after-render") {
          faultObserved = true
          throw new Error("injected-after-render")
        }
      },
    })
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "injected-after-render") throw error
  }
  if (!faultObserved) throw new Error("after-render fault was not observed")
  const lifecycle = await readLifecycle(composition, input.operationId)
  return {
    mode: input.mode,
    faultObserved,
    lifecycleStatus: lifecycle.status,
    lifecycleCheckpoint: lifecycle.checkpoint,
    lifecycleHeadRevision: lifecycle.headRevision,
    mapperCount: workflow.mapperCount,
    materializerCount,
    persistenceStatus: (await composition.persistenceRepository.readByOperationId({
      ...lifecycle.scope,
      operationId: input.operationId,
    })).status,
  }
}

async function complete(input: WorkerInput, composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1) {
  if (input.operationId == null) throw new Error("complete operation id is required")
  let materializerCount = 0
  const workflow = await workflowInput({
    composition,
    operationId: input.operationId,
    now: COMPLETE_AT,
    onMaterialize: () => { materializerCount += 1 },
  })
  const result = await runFlowDocBackendPdfExportEndToEndCandidateV1(workflow.value)
  if (result.status !== "completed") throw new Error(`durable completion failed: ${result.status}`)
  return {
    mode: input.mode,
    workflowStatus: result.status,
    terminalStatus: result.completion.terminalStatus,
    completionFingerprint: result.completion.completionFingerprint,
    persistenceFingerprint: result.persistenceReceipt?.persistenceReceiptFingerprint ?? null,
    pageCount: result.persistenceReceipt?.core.completion.artifact.pageCount ?? null,
    mapperCount: workflow.mapperCount,
    materializerCount,
    rendererExecuted: result.execution.rendererExecuted,
    persistenceExecuted: result.execution.persistenceExecuted,
  }
}

async function verify(input: WorkerInput, composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1) {
  if (input.operationId == null || input.instanceId == null) throw new Error("verify identities are required")
  let materializerCount = 0
  const fixture = createDocGenLocalAdmissionFixture({ repository: composition.admissionRepository })
  const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
    repository: composition.admissionRepository,
    assets: fixture.assets,
    materializer: docGenLocalPdfMaterializer(() => { materializerCount += 1 }),
  })
  const options = {
    ...security(),
    ...repositories(composition),
    admissionResolver: binding.admissionResolver,
    now: () => "2026-07-20T08:00:30.000Z",
  }
  const statusResponse = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
    method: "GET",
    path: `/pdf-exports/${encodeURIComponent(input.operationId)}`,
  }), options)
  const status = jsonValue(statusResponse).export as Record<string, any>
  const downloadResponse = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
    method: "GET",
    path: `/pdf-exports/${encodeURIComponent(input.operationId)}/download`,
  }), options)
  if (downloadResponse.body.kind !== "pdf") throw new Error("durable download did not return PDF bytes")
  const replayResponse = await handleFlowDocBackendPdfExportRouteV1(routeRequest({
    method: "POST",
    path: "/pdf-exports",
    idempotencyKey: EXPORT_CALLER_KEY,
    body: { documentId: input.instanceId, documentRevision: 0 },
  }), options)
  const lookup = {
    tenantId: DOCGEN_LOCAL_IDENTITY.tenantId,
    principalId: DOCGEN_LOCAL_IDENTITY.principalId,
    operationId: input.operationId,
  }
  const terminal = await composition.observabilityRepository.readTerminalWorkflow(lookup)
  const persistence = await composition.persistenceRepository.readByOperationId(lookup)
  const otherScope = {
    tenantId: DOCGEN_LOCAL_IDENTITY.tenantId,
    principalId: "principal:other",
    operationId: input.operationId,
  }
  const otherScopeConcealed = (
    await composition.operationRepository.readByOperationId(otherScope)
  ).status === "not-found"
    && (await composition.lifecycleRepository.readLifecycle(otherScope)).status === "not-found"
    && (await composition.persistenceRepository.readByOperationId(otherScope)).status === "not-found"
    && (await composition.observabilityRepository.readTerminalWorkflow(otherScope)).status === "not-found"
  if (terminal.status !== "found" || persistence.status !== "found") {
    throw new Error("durable terminal metadata is missing")
  }
  const pdfSha256 = createHash("sha256").update(downloadResponse.body.bytes).digest("hex")
  return {
    mode: input.mode,
    statusHttp: statusResponse.httpStatus,
    state: status.state,
    pageCount: status.pageCount,
    byteLength: status.byteLength,
    downloadHttp: downloadResponse.httpStatus,
    pdfMagic: Buffer.from(downloadResponse.body.bytes).subarray(0, 5).toString("ascii"),
    pdfSha256,
    terminalEventCount: terminal.events.length,
    terminalCompletionFingerprint: terminal.completion.completionFingerprint,
    metadataByteLength: persistence.receipt.bytes.byteLength,
    metadataSha256: persistence.receipt.bytes.sha256,
    metadataMatchesDownload: persistence.receipt.bytes.byteLength === downloadResponse.body.bytes.byteLength
      && persistence.receipt.bytes.sha256 === pdfSha256,
    otherScopeConcealed,
    replayHttp: replayResponse.httpStatus,
    replayStatus: jsonValue(replayResponse).status,
    materializerCount,
  }
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2]
  if (payloadPath == null) throw new Error("worker payload path is required")
  const input = JSON.parse(readFileSync(payloadPath, "utf8")) as WorkerInput
  const composition = await createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1({
    rootDirectory: input.rootDirectory,
  })
  try {
    const output = input.mode === "create"
      ? await create(input, composition)
      : input.mode === "render-fault"
        ? await renderFault(input, composition)
        : input.mode === "complete"
          ? await complete(input, composition)
          : await verify(input, composition)
    process.stdout.write(JSON.stringify({ pid: process.pid, ...output }))
  } finally {
    composition.close()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
