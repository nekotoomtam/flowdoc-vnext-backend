import {
  createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1,
  createInMemoryFlowDocBackendPdfExportObservabilityRepositoryV1,
  createInMemoryFlowDocBackendPdfExportOperationRepositoryV1,
  type FlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  type FlowDocBackendPdfExportContentAddressedStoreV1,
  type FlowDocBackendPdfExportLifecycleRepositoryV1,
  type FlowDocBackendPdfExportObservabilityRepositoryV1,
  type FlowDocBackendPdfExportOperationRepositoryV1,
  type FlowDocBackendPdfExportRendererV1,
  type FlowDocBackendPdfExportWorkflowFaultPointV1,
  type FlowDocBackendPdfExportWorkflowInputV1,
} from "../../index.js"
import {
  PDF_EXPORT_RENDERER_CLAIM_TOKEN,
  createCooperativeRenderer,
  createPdfExportRendererFixture,
  monotonicRendererClock,
} from "./pdfExportRendererFixture.js"

export interface PdfExportWorkflowRepositories {
  operationRepository: FlowDocBackendPdfExportOperationRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilityRepositoryV1
}

export function createInMemoryPdfExportWorkflowRepositories(): PdfExportWorkflowRepositories {
  return {
    operationRepository: createInMemoryFlowDocBackendPdfExportOperationRepositoryV1(),
    lifecycleRepository: createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1(),
    persistenceRepository: createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1(),
    observabilityRepository: createInMemoryFlowDocBackendPdfExportObservabilityRepositoryV1(),
  }
}

export function createPdfExportWorkflowFixture(input: {
  operationId?: string
  renderer?: FlowDocBackendPdfExportRendererV1
} = {}) {
  const fixture = createPdfExportRendererFixture({
    operationId: input.operationId ?? "operation:pdf-export-workflow",
  })
  return {
    fixture,
    renderer: input.renderer ?? createCooperativeRenderer({ fixture }),
  }
}

export function pdfExportWorkflowInput(input: {
  fixture: ReturnType<typeof createPdfExportWorkflowFixture>
  repositories: PdfExportWorkflowRepositories
  contentStore: FlowDocBackendPdfExportContentAddressedStoreV1
  renderer?: FlowDocBackendPdfExportRendererV1
  faultPoint?: FlowDocBackendPdfExportWorkflowFaultPointV1
}): FlowDocBackendPdfExportWorkflowInputV1 {
  const operationId = input.fixture.fixture.operation.operationId
  let faulted = false
  return {
    workflowId: `workflow:${operationId}`,
    operation: input.fixture.fixture.operation,
    request: input.fixture.fixture.request,
    currentSource: input.fixture.fixture.currentSource,
    measuredDrawContract: input.fixture.fixture.measuredDrawContract,
    qualification: input.fixture.fixture.qualification,
    renderer: input.renderer ?? input.fixture.renderer,
    ...input.repositories,
    contentStore: input.contentStore,
    worker: {
      workerId: "worker:pdf-export-workflow",
      claimToken: PDF_EXPORT_RENDERER_CLAIM_TOKEN,
      claimTransitionId: `transition:${operationId}:claim`,
      claimedAt: "2026-07-18T09:00:02.000Z",
      claimExpiresAt: "2026-07-18T09:00:32.000Z",
      beforeHandoffTransitionId: `transition:${operationId}:before-handoff`,
      beforeHandoffAt: "2026-07-18T09:00:03.000Z",
    },
    rendererAttempt: {
      renderAttemptId: `render-attempt:${operationId}`,
      completionId: `completion:${operationId}`,
      beforeRenderTransitionId: `transition:${operationId}:before-render`,
      beforeRenderExpectedHeadRevision: 2,
      beforeRenderAt: "2026-07-18T09:00:04.000Z",
      beforePersistTransitionId: `transition:${operationId}:before-persist`,
      now: monotonicRendererClock(),
    },
    persistence: {
      persistenceId: `persistence:${operationId}`,
      jobId: `job:${operationId}`,
      layoutProfileId: "layout:pdf-export-v-f:v1",
      persistedAt: "2026-07-18T09:00:06.000Z",
    },
    events: {
      renderStartedAt: "2026-07-18T09:00:04.000Z",
      renderCompletedAt: "2026-07-18T09:00:05.500Z",
      persistStartedAt: "2026-07-18T09:00:05.750Z",
      persistCompletedAt: "2026-07-18T09:00:06.000Z",
      workflowCompletedAt: "2026-07-18T09:00:07.000Z",
    },
    faultInjector: input.faultPoint == null ? undefined : ({ point }) => {
      if (!faulted && point === input.faultPoint) {
        faulted = true
        throw new Error(`injected-${point}`)
      }
    },
  }
}
