import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1,
  type FlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1,
} from "./docGenLocalAdmissionSqliteRepository.js"
import { createFlowDocBackendPdfExportFileContentAddressedStoreV1 } from "../pdfExport/pdfExportContentAddressedStore.js"
import {
  createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1,
  type FlowDocBackendPdfExportLifecycleSqliteRepositoryV1,
} from "../pdfExport/pdfExportLifecycleSqliteRepository.js"
import {
  createFlowDocBackendPdfExportObservabilitySqliteRepositoryV1,
  type FlowDocBackendPdfExportObservabilitySqliteRepositoryV1,
} from "../pdfExport/pdfExportObservabilitySqliteRepository.js"
import {
  createFlowDocBackendPdfExportOperationSqliteRepositoryV1,
  type FlowDocBackendPdfExportOperationSqliteRepositoryV1,
} from "../pdfExport/pdfExportOperationSqliteRepository.js"
import {
  createFlowDocBackendPdfExportPersistenceSqliteRepositoryV1,
  type FlowDocBackendPdfExportPersistenceSqliteRepositoryV1,
} from "../pdfExport/pdfExportArtifactPersistenceSqliteRepository.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_DURABLE_PDF_EXPORT_V1_SOURCE =
  "flowdoc-backend-docgen-local-durable-pdf-export" as const

export interface FlowDocBackendDocGenLocalDurablePdfExportOptionsV1 {
  rootDirectory: string
  busyTimeoutMs?: number
}

export interface FlowDocBackendDocGenLocalDurablePdfExportCompositionV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_DURABLE_PDF_EXPORT_V1_SOURCE
    runtimeProfile: "local-integration"
    protectedAdmissionPersistence: "sqlite"
    operationPersistence: "sqlite"
    lifecyclePersistence: "sqlite"
    artifactMetadataPersistence: "sqlite"
    observabilityPersistence: "sqlite"
    artifactBytePersistence: "filesystem-content-addressed"
    processRestartReplay: true
    defaultApplicationServerMounted: false
    productionBinding: false
  }
  rootDirectory: string
  databasePaths: {
    admission: string
    operation: string
    lifecycle: string
    persistence: string
    observability: string
  }
  contentRootDirectory: string
  admissionRepository: FlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1
  operationRepository: FlowDocBackendPdfExportOperationSqliteRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleSqliteRepositoryV1
  persistenceRepository: FlowDocBackendPdfExportPersistenceSqliteRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilitySqliteRepositoryV1
  contentStore: ReturnType<typeof createFlowDocBackendPdfExportFileContentAddressedStoreV1>
  close(): void
}

interface CloseableRepositoryV1 {
  close(): void
}

export async function createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1(
  options: FlowDocBackendDocGenLocalDurablePdfExportOptionsV1,
): Promise<FlowDocBackendDocGenLocalDurablePdfExportCompositionV1> {
  const rootDirectory = resolve(options.rootDirectory)
  const metadataDirectory = join(rootDirectory, "metadata")
  const contentRootDirectory = join(rootDirectory, "content")
  mkdirSync(metadataDirectory, { recursive: true })
  mkdirSync(contentRootDirectory, { recursive: true })
  const databasePaths = {
    admission: join(metadataDirectory, "docgen-admission.sqlite"),
    operation: join(metadataDirectory, "pdf-operation.sqlite"),
    lifecycle: join(metadataDirectory, "pdf-lifecycle.sqlite"),
    persistence: join(metadataDirectory, "pdf-persistence.sqlite"),
    observability: join(metadataDirectory, "pdf-observability.sqlite"),
  }
  const opened: CloseableRepositoryV1[] = []
  try {
    const admissionRepository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
      databasePath: databasePaths.admission,
      busyTimeoutMs: options.busyTimeoutMs,
    })
    opened.push(admissionRepository)
    const operationRepository = await createFlowDocBackendPdfExportOperationSqliteRepositoryV1({
      databasePath: databasePaths.operation,
      busyTimeoutMs: options.busyTimeoutMs,
    })
    opened.push(operationRepository)
    const lifecycleRepository = await createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1({
      databasePath: databasePaths.lifecycle,
      busyTimeoutMs: options.busyTimeoutMs,
    })
    opened.push(lifecycleRepository)
    const persistenceRepository = await createFlowDocBackendPdfExportPersistenceSqliteRepositoryV1({
      databasePath: databasePaths.persistence,
      busyTimeoutMs: options.busyTimeoutMs,
    })
    opened.push(persistenceRepository)
    const observabilityRepository = await createFlowDocBackendPdfExportObservabilitySqliteRepositoryV1({
      databasePath: databasePaths.observability,
      busyTimeoutMs: options.busyTimeoutMs,
    })
    opened.push(observabilityRepository)
    const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({
      rootDirectory: contentRootDirectory,
    })
    let closed = false
    return {
      facts: {
        source: FLOWDOC_BACKEND_DOCGEN_LOCAL_DURABLE_PDF_EXPORT_V1_SOURCE,
        runtimeProfile: "local-integration",
        protectedAdmissionPersistence: "sqlite",
        operationPersistence: "sqlite",
        lifecyclePersistence: "sqlite",
        artifactMetadataPersistence: "sqlite",
        observabilityPersistence: "sqlite",
        artifactBytePersistence: "filesystem-content-addressed",
        processRestartReplay: true,
        defaultApplicationServerMounted: false,
        productionBinding: false,
      },
      rootDirectory,
      databasePaths,
      contentRootDirectory,
      admissionRepository,
      operationRepository,
      lifecycleRepository,
      persistenceRepository,
      observabilityRepository,
      contentStore,
      close() {
        if (closed) return
        closed = true
        opened.reverse().forEach((repository) => repository.close())
      },
    }
  } catch (error) {
    opened.reverse().forEach((repository) => {
      try {
        repository.close()
      } catch {
        // Preserve the original open failure while closing partial handles.
      }
    })
    throw error
  }
}
