import { randomUUID } from "node:crypto"
import type { FlowDocBackendDocGenLocalArtifactBindingV1 } from "./docGenLocalPdfExport.js"
import type { FlowDocBackendDocGenLocalDurablePdfExportCompositionV1 } from "./docGenLocalDurablePdfExport.js"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
  type FlowDocBackendPdfExportDueWorkEntryV1,
} from "../pdfExport/pdfExportDueWork.js"
import {
  createFlowDocBackendPdfExportLocalHttpServerV1,
  type FlowDocBackendPdfExportLocalCompositionEvidenceV1,
} from "../pdfExport/pdfExportLocalHttpServer.js"
import { runFlowDocBackendPdfExportLocalDueWorkEntryV1 } from "../pdfExport/pdfExportLocalWorker.js"
import type { FlowDocBackendPdfExportOperationRepositoryV1 } from "../pdfExport/pdfExportOperationRepository.js"
import { runFlowDocBackendPdfExportEndToEndCandidateV1 } from "../pdfExport/pdfExportWorkflow.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_DURABLE_PDF_EXPORT_RUNTIME_V1_SOURCE =
  "flowdoc-backend-docgen-local-durable-pdf-export-runtime" as const

type LocalHttpServerInputV1 = Parameters<typeof createFlowDocBackendPdfExportLocalHttpServerV1>[0]

export interface FlowDocBackendDocGenLocalDurablePdfExportRuntimeV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_DURABLE_PDF_EXPORT_RUNTIME_V1_SOURCE
    runtimeProfile: "local-integration"
    durableComposition: true
    explicitRequestReplayResume: true
    automaticStartupDiscovery: false
    defaultApplicationServerMounted: false
    productionBinding: false
  }
  origin(): string | null
  start(): Promise<FlowDocBackendPdfExportLocalCompositionEvidenceV1>
  close(): Promise<void>
  readDispatchEvidence(): {
    scheduledCount: number
    completedCount: number
    failedCount: number
    activeCount: number
    pendingTimerCount: number
  }
}

function monotonicClock(): () => string {
  let previous = Date.now() - 1
  return () => {
    previous = Math.max(Date.now(), previous + 1)
    return new Date(previous).toISOString()
  }
}

function dueEntry(head: FlowDocBackendPdfExportDueWorkEntryV1["head"]): FlowDocBackendPdfExportDueWorkEntryV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
    operationId: head.operationId,
    scope: head.scope,
    dueAt: head.status === "pending"
      ? head.retryAfter ?? head.updatedAt
      : head.status === "claimed"
        ? head.claim!.expiresAt
        : head.updatedAt,
    lane: head.status === "pending"
      ? "claim-ready"
      : head.status === "claimed"
        ? "claim-expired"
        : "terminal-finalization",
    headRevision: head.headRevision,
    lifecycleFingerprint: head.lifecycleFingerprint,
    head,
  }
}

export function createFlowDocBackendDocGenLocalDurablePdfExportRuntimeV1(input: {
  composition: FlowDocBackendDocGenLocalDurablePdfExportCompositionV1
  binding: FlowDocBackendDocGenLocalArtifactBindingV1
  host: "127.0.0.1"
  port: number
  routeOptions: Omit<
    LocalHttpServerInputV1["routeOptions"],
    "admissionResolver" | "operationRepository" | "lifecycleRepository" | "persistenceRepository"
      | "observabilityRepository" | "contentStore" | "now"
  >
  docGenAdmissionOptions?: LocalHttpServerInputV1["docGenAdmissionOptions"]
  publishedPreviewContextOptions?: LocalHttpServerInputV1["publishedPreviewContextOptions"]
  draftPreviewOptions?: LocalHttpServerInputV1["draftPreviewOptions"]
  operationDispatchDelayMs?: number
  now?: () => string
}): FlowDocBackendDocGenLocalDurablePdfExportRuntimeV1 {
  const dispatchDelayMs = input.operationDispatchDelayMs ?? 10_000
  if (!Number.isSafeInteger(dispatchDelayMs) || dispatchDelayMs < 0 || dispatchDelayMs > 60_000) {
    throw new Error("durable DocGen dispatch delay must be an integer from 0 through 60000")
  }
  const now = input.now ?? monotonicClock()
  const repositories = {
    operationRepository: input.composition.operationRepository,
    lifecycleRepository: input.composition.lifecycleRepository,
    persistenceRepository: input.composition.persistenceRepository,
    observabilityRepository: input.composition.observabilityRepository,
    contentStore: input.composition.contentStore,
  }
  const activeWork = new Map<string, Promise<void>>()
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let scheduledCount = 0
  let completedCount = 0
  let failedCount = 0
  let closing = false

  const readLifecycle = async (operationId: string, scope: { tenantId: string; principalId: string }) => {
    let result = await input.composition.lifecycleRepository.readLifecycle({ ...scope, operationId })
    for (let attempt = 0; result.status === "not-found" && attempt < 20; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10))
      result = await input.composition.lifecycleRepository.readLifecycle({ ...scope, operationId })
    }
    return result
  }

  const executeScopedKnownOperation = async (
    operationId: string,
    scope: { tenantId: string; principalId: string },
  ): Promise<void> => {
    const operationRead = await input.composition.operationRepository.readByOperationId({ ...scope, operationId })
    if (operationRead.status !== "found") return
    const lifecycleRead = await readLifecycle(operationId, scope)
    if (lifecycleRead.status !== "found") return
    const terminal = await input.composition.observabilityRepository.readTerminalWorkflow({ ...scope, operationId })
    if (terminal.status === "found") return
    const head = lifecycleRead.head
    if (head.status === "pending") {
      await runFlowDocBackendPdfExportLocalDueWorkEntryV1({
        runId: `run:docgen-durable:${randomUUID()}`,
        workerId: "worker:docgen-durable-local",
        entry: dueEntry(head),
        claimDurationMs: 180_000,
        retryDelayMs: 1_000,
        operationRepository: input.composition.operationRepository,
        lifecycleRepository: input.composition.lifecycleRepository,
        observabilityRepository: input.composition.observabilityRepository,
        now,
        execute: async (execution) => runFlowDocBackendPdfExportEndToEndCandidateV1(
          await input.binding.createWorkflowInput(execution, repositories),
        ),
      })
      return
    }
    if (head.status !== "claimed" || head.checkpoint !== "before-persist" || head.claim == null) return
    await runFlowDocBackendPdfExportEndToEndCandidateV1(await input.binding.createWorkflowInput({
      entry: dueEntry(head),
      operation: operationRead.operation,
      lifecycleHead: head,
      workerId: head.claim.workerId,
      claimToken: head.claim.claimToken,
      ownsClaim: true,
      attemptNumber: head.claim.attemptNumber,
      now,
    }, repositories))
  }

  const schedule = (operationId: string, scope: { tenantId: string; principalId: string }) => {
    if (closing || pendingTimers.has(operationId) || activeWork.has(operationId)) return
    scheduledCount += 1
    const timer = setTimeout(() => {
      pendingTimers.delete(operationId)
      if (closing) return
      const work = executeScopedKnownOperation(operationId, scope)
        .then(() => { completedCount += 1 })
        .catch(() => { failedCount += 1 })
        .finally(() => activeWork.delete(operationId))
      activeWork.set(operationId, work)
    }, dispatchDelayMs)
    pendingTimers.set(operationId, timer)
  }

  const baseOperationRepository = input.composition.operationRepository
  const operationRepository: FlowDocBackendPdfExportOperationRepositoryV1 = {
    source: baseOperationRepository.source,
    async admitOperation(value) {
      const result = await baseOperationRepository.admitOperation(value)
      if (result.status === "created" || result.status === "idempotent-replay") {
        schedule(result.operation.operationId, result.operation.scope)
      }
      return result
    },
    readByOperationId: (lookup) => baseOperationRepository.readByOperationId(lookup),
    async readByCallerKey(lookup) {
      const result = await baseOperationRepository.readByCallerKey(lookup)
      if (result.status === "found") schedule(result.operation.operationId, result.operation.scope)
      return result
    },
  }
  const server = createFlowDocBackendPdfExportLocalHttpServerV1({
    host: input.host,
    port: input.port,
    routeOptions: {
      ...input.routeOptions,
      admissionResolver: input.binding.admissionResolver,
      operationRepository,
      lifecycleRepository: input.composition.lifecycleRepository,
      persistenceRepository: input.composition.persistenceRepository,
      observabilityRepository: input.composition.observabilityRepository,
      contentStore: input.composition.contentStore,
      now,
    },
    ...(input.docGenAdmissionOptions == null ? {} : { docGenAdmissionOptions: input.docGenAdmissionOptions }),
    ...(input.publishedPreviewContextOptions == null
      ? {}
      : { publishedPreviewContextOptions: input.publishedPreviewContextOptions }),
    ...(input.draftPreviewOptions == null ? {} : { draftPreviewOptions: input.draftPreviewOptions }),
  })
  let listenerOrigin: string | null = null
  let closed = false

  return {
    facts: {
      source: FLOWDOC_BACKEND_DOCGEN_LOCAL_DURABLE_PDF_EXPORT_RUNTIME_V1_SOURCE,
      runtimeProfile: "local-integration",
      durableComposition: true,
      explicitRequestReplayResume: true,
      automaticStartupDiscovery: false,
      defaultApplicationServerMounted: false,
      productionBinding: false,
    },
    origin: () => listenerOrigin,
    async start() {
      const evidence = await server.start()
      listenerOrigin = `http://${evidence.listenerHost}:${evidence.listenerPort}`
      return evidence
    },
    async close() {
      if (closed) return
      closed = true
      closing = true
      pendingTimers.forEach((timer) => clearTimeout(timer))
      pendingTimers.clear()
      await server.close()
      await Promise.allSettled([...activeWork.values()])
      input.composition.close()
      listenerOrigin = null
    },
    readDispatchEvidence: () => ({
      scheduledCount,
      completedCount,
      failedCount,
      activeCount: activeWork.size,
      pendingTimerCount: pendingTimers.size,
    }),
  }
}
