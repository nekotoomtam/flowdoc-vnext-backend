import {
  createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1,
  runFlowDocBackendPdfExportRendererAttemptV1,
  type FlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
  type FlowDocBackendPdfExportContentAddressedStoreV1,
  type FlowDocBackendPdfExportLifecycleRepositoryV1,
} from "../../index.js"
import {
  PDF_EXPORT_RENDERER_CLAIM_TOKEN,
  createCooperativeRenderer,
  createPdfExportRendererFixture,
  preparePdfExportRendererLifecycle,
  rendererAttemptInput,
} from "./pdfExportRendererFixture.js"

export async function createReadyPdfExportPersistenceFixture(input: {
  operationId?: string
  lifecycleRepository?: FlowDocBackendPdfExportLifecycleRepositoryV1
} = {}) {
  const fixture = createPdfExportRendererFixture({
    operationId: input.operationId ?? "operation:pdf-export-persistence",
  })
  const lifecycleRepository = input.lifecycleRepository
    ?? createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
  await preparePdfExportRendererLifecycle({ repository: lifecycleRepository, fixture })
  const rendererAttempt = await runFlowDocBackendPdfExportRendererAttemptV1(rendererAttemptInput({
    fixture,
    repository: lifecycleRepository,
    renderer: createCooperativeRenderer({ fixture }),
  }))
  if (rendererAttempt.status !== "ready-for-persistence") {
    throw new Error(`renderer attempt fixture failed: ${JSON.stringify(rendererAttempt.issues)}`)
  }
  return { fixture, lifecycleRepository, rendererAttempt }
}

export function pdfExportPersistenceInput(input: {
  fixture: Awaited<ReturnType<typeof createReadyPdfExportPersistenceFixture>>
  contentStore: FlowDocBackendPdfExportContentAddressedStoreV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
  persistenceId?: string
  jobId?: string
  persistedAt?: string
}) {
  return {
    persistenceId: input.persistenceId ?? `persistence:${input.fixture.fixture.operation.operationId}`,
    jobId: input.jobId ?? `job:${input.fixture.fixture.operation.operationId}`,
    layoutProfileId: "layout:pdf-export-v-e:v1",
    persistedAt: input.persistedAt ?? "2026-07-18T09:00:06.000Z",
    claimToken: PDF_EXPORT_RENDERER_CLAIM_TOKEN,
    operation: input.fixture.fixture.operation,
    rendererAttempt: input.fixture.rendererAttempt,
    lifecycleRepository: input.fixture.lifecycleRepository,
    contentStore: input.contentStore,
    persistenceRepository: input.persistenceRepository,
  }
}
