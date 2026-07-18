import { randomBytes } from "node:crypto"
import {
  createFlowDocBackendPdfExportLocalCanonicalEvidenceV1,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
} from "./pdfExportLocalCanonicalEvidence.js"
import type {
  FlowDocBackendPdfExportLocalCompositionConfigV1,
  FlowDocBackendPdfExportLocalHttpConfigV1,
} from "./pdfExportLocalConfig.js"
import {
  createFlowDocBackendPdfExportLocalHttpServerV1,
  type FlowDocBackendPdfExportLocalHttpServerV1,
} from "./pdfExportLocalHttpServer.js"
import { createFlowDocBackendPdfExportLocalOrphanMaintenanceV1 } from "./pdfExportLocalOrphanMaintenance.js"
import {
  createFlowDocBackendPdfExportLocalPostgresRepositoriesV1,
  type FlowDocBackendPdfExportLocalPostgresRepositoriesV1,
} from "./pdfExportLocalPostgresRepositories.js"
import { createFlowDocBackendPdfExportLocalSecurityV1 } from "./pdfExportLocalSecurity.js"
import {
  createFlowDocBackendPdfExportLocalWorkerHostV1,
  type FlowDocBackendPdfExportLocalWorkerHostV1,
} from "./pdfExportLocalWorkerHost.js"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_COMMAND_RUNTIME_V1_SOURCE,
  type FlowDocBackendPdfExportLocalWorkerCommandRuntimeV1,
} from "./pdfExportLocalWorkerCommandRuntime.js"
import {
  createFlowDocBackendPdfExportS3ContentAddressedStoreV1,
  type FlowDocBackendPdfExportS3ContentAddressedStoreV1,
} from "./pdfExportS3ContentAddressedStore.js"
import { runFlowDocBackendPdfExportEndToEndCandidateV1 } from "./pdfExportWorkflow.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_COMPOSITION_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-composition" as const

interface CommonCompositionV1 {
  repositories: FlowDocBackendPdfExportLocalPostgresRepositoriesV1
  contentStore: FlowDocBackendPdfExportS3ContentAddressedStoreV1
  evidence: Awaited<ReturnType<typeof createFlowDocBackendPdfExportLocalCanonicalEvidenceV1>>
  close(): Promise<void>
}

export interface FlowDocBackendPdfExportLocalHttpCompositionV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_COMPOSITION_V1_SOURCE
    runtimeProfile: "local-integration"
    purpose: "http"
    canonicalEvidenceOnly: true
    routeMountedSeparately: true
    defaultApplicationServerMounted: false
    workerAutomaticStart: false
    remoteProviderCallsAllowed: false
    productionBinding: false
  }
  server: FlowDocBackendPdfExportLocalHttpServerV1
  close(): Promise<void>
}

async function common(input: {
  config: FlowDocBackendPdfExportLocalCompositionConfigV1
  identity: ReturnType<typeof createFlowDocBackendPdfExportLocalSecurityV1>["identity"]
  operationIdFactory?: () => string
}): Promise<CommonCompositionV1> {
  if (
    input.config.runtimeProfile !== "local-integration"
    || input.config.integrationEnabled !== true
    || input.config.productionBinding !== false
  ) throw new Error("LOCAL-E composition requires the explicit local-integration profile")
  let repositories: FlowDocBackendPdfExportLocalPostgresRepositoriesV1 | null = null
  let contentStore: FlowDocBackendPdfExportS3ContentAddressedStoreV1 | null = null
  try {
    repositories = await createFlowDocBackendPdfExportLocalPostgresRepositoriesV1(input.config.postgres)
    contentStore = await createFlowDocBackendPdfExportS3ContentAddressedStoreV1(input.config.s3)
    if (
      repositories.facts.loopbackOnly !== true
      || repositories.facts.productionBinding !== false
      || contentStore.facts.loopbackOnly !== true
      || contentStore.facts.productionBinding !== false
    ) throw new Error("LOCAL-E providers must remain loopback-only and non-production")
    const evidence = await createFlowDocBackendPdfExportLocalCanonicalEvidenceV1({
      ...input.config.evidence,
      identity: input.identity,
      operationIdFactory: input.operationIdFactory,
    })
    let closed = false
    return {
      repositories,
      contentStore,
      evidence,
      async close() {
        if (closed) return
        closed = true
        contentStore!.close()
        await repositories!.close()
      },
    }
  } catch (error) {
    contentStore?.close()
    await repositories?.close().catch(() => undefined)
    throw error
  }
}

export async function createFlowDocBackendPdfExportLocalHttpCompositionV1(input: {
  config: FlowDocBackendPdfExportLocalHttpConfigV1
  listenerPortOverride?: number
  now?: () => string
  operationIdFactory?: () => string
}): Promise<FlowDocBackendPdfExportLocalHttpCompositionV1> {
  const security = createFlowDocBackendPdfExportLocalSecurityV1({
    bearerToken: input.config.http.bearerToken,
    documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
  })
  const providers = await common({
    config: input.config,
    identity: security.identity,
    operationIdFactory: input.operationIdFactory,
  })
  const server = createFlowDocBackendPdfExportLocalHttpServerV1({
    host: input.config.http.host,
    port: input.listenerPortOverride ?? input.config.http.port,
    routeOptions: {
      authenticator: security.authenticator,
      authorizer: security.authorizer,
      admissionResolver: providers.evidence.admissionResolver,
      operationRepository: providers.repositories.operationRepository,
      lifecycleRepository: providers.repositories.lifecycleRepository,
      persistenceRepository: providers.repositories.persistenceRepository,
      observabilityRepository: providers.repositories.observabilityRepository,
      contentStore: providers.contentStore,
      now: input.now ?? (() => new Date().toISOString()),
    },
    eligibilityOptions: {
      authenticator: security.authenticator,
      authorizer: security.authorizer,
      inspectEligibility: providers.evidence.inspectEligibility,
    },
  })
  let closed = false
  return {
    facts: {
      source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_COMPOSITION_V1_SOURCE,
      runtimeProfile: "local-integration",
      purpose: "http",
      canonicalEvidenceOnly: true,
      routeMountedSeparately: true,
      defaultApplicationServerMounted: false,
      workerAutomaticStart: false,
      remoteProviderCallsAllowed: false,
      productionBinding: false,
    },
    server,
    async close() {
      if (closed) return
      closed = true
      await server.close()
      await providers.close()
    },
  }
}

export async function createFlowDocBackendPdfExportLocalWorkerRuntimeV1(input: {
  config: FlowDocBackendPdfExportLocalCompositionConfigV1
  now?: () => string
}): Promise<FlowDocBackendPdfExportLocalWorkerCommandRuntimeV1> {
  const identity = {
    tenantId: "tenant:flowdoc-pdf-local",
    principalId: "principal:flowdoc-pdf-local-operator",
    authenticationId: "authentication:pdf-local:trusted-worker-composition",
  }
  const providers = await common({ config: input.config, identity })
  const now = input.now ?? (() => new Date().toISOString())
  const createdAt = now()
  const nonce = randomBytes(12).toString("hex")
  const maintenance = createFlowDocBackendPdfExportLocalOrphanMaintenanceV1({
    createdAt,
    intervalMs: 60_000,
    unavailableBackoffMs: 2_000,
    gracePeriodMs: 60 * 60 * 1_000,
    maxScanCount: 64,
    maxDeleteCount: 16,
    contentStore: providers.contentStore,
    persistenceRepository: providers.repositories.persistenceRepository,
  })
  const host: FlowDocBackendPdfExportLocalWorkerHostV1 = createFlowDocBackendPdfExportLocalWorkerHostV1({
    hostId: `host:pdf-local-e:${nonce}`,
    workerId: `worker:pdf-local-e:${nonce}`,
    runId: `run:pdf-local-e:${nonce}`,
    createdAt,
    maxBatchCount: 8,
    claimDurationMs: 180_000,
    retryDelayMs: 1_000,
    pollIntervalMs: 1_000,
    unavailableBackoffMs: 2_000,
    dueWorkRepository: providers.repositories.dueWorkRepository,
    operationRepository: providers.repositories.operationRepository,
    lifecycleRepository: providers.repositories.lifecycleRepository,
    observabilityRepository: providers.repositories.observabilityRepository,
    maintenance,
    now,
    execute: (execution) => runFlowDocBackendPdfExportEndToEndCandidateV1(
      providers.evidence.createWorkflowInput(execution, {
        ...providers.repositories,
        contentStore: providers.contentStore,
      }),
    ),
  })
  let closed = false
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_COMMAND_RUNTIME_V1_SOURCE,
    runtimeProfile: "local-integration",
    host,
    shutdownTimeoutMs: 30_000,
    productionBinding: false,
    async close() {
      if (closed) return
      closed = true
      host.beginDrain()
      await providers.close()
    },
  }
}
