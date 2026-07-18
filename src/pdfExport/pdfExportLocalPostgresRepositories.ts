import {
  createFlowDocBackendPdfExportPersistencePostgresRepositoryV1,
  type FlowDocBackendPdfExportPersistencePostgresFaultContextV1,
  type FlowDocBackendPdfExportPersistencePostgresRepositoryV1,
} from "./pdfExportArtifactPersistencePostgresRepository.js"
import {
  createFlowDocBackendPdfExportLifecyclePostgresRepositoryV1,
  type FlowDocBackendPdfExportLifecyclePostgresFaultContextV1,
  type FlowDocBackendPdfExportLifecyclePostgresRepositoryV1,
} from "./pdfExportLifecyclePostgresRepository.js"
import {
  assertFlowDocBackendPdfExportLocalPostgresSchemaV1,
  createFlowDocBackendPdfExportLocalPostgresPoolV1,
  type FlowDocBackendPdfExportLocalPostgresFactsV1,
  type FlowDocBackendPdfExportLocalPostgresOptionsV1,
} from "./pdfExportLocalPostgresSupport.js"
import {
  createFlowDocBackendPdfExportObservabilityPostgresRepositoryV1,
  type FlowDocBackendPdfExportObservabilityPostgresFaultContextV1,
  type FlowDocBackendPdfExportObservabilityPostgresRepositoryV1,
} from "./pdfExportObservabilityPostgresRepository.js"
import {
  createFlowDocBackendPdfExportOperationPostgresRepositoryV1,
  type FlowDocBackendPdfExportOperationPostgresFaultContextV1,
  type FlowDocBackendPdfExportOperationPostgresRepositoryV1,
} from "./pdfExportOperationPostgresRepository.js"
import type { FlowDocBackendPdfExportDueWorkRepositoryV1 } from "./pdfExportDueWork.js"

export interface FlowDocBackendPdfExportLocalPostgresRepositoryFaultsV1 {
  operation?: (context: FlowDocBackendPdfExportOperationPostgresFaultContextV1) => void | Promise<void>
  lifecycle?: (context: FlowDocBackendPdfExportLifecyclePostgresFaultContextV1) => void | Promise<void>
  persistence?: (context: FlowDocBackendPdfExportPersistencePostgresFaultContextV1) => void | Promise<void>
  observability?: (context: FlowDocBackendPdfExportObservabilityPostgresFaultContextV1) => void | Promise<void>
}

export interface FlowDocBackendPdfExportLocalPostgresRepositoriesOptionsV1
extends FlowDocBackendPdfExportLocalPostgresOptionsV1 {
  faultInjectors?: FlowDocBackendPdfExportLocalPostgresRepositoryFaultsV1
}

export interface FlowDocBackendPdfExportLocalPostgresRepositoriesV1 {
  facts: FlowDocBackendPdfExportLocalPostgresFactsV1 & {
    schemaVerifiedBeforeUse: true
    automaticMigration: false
    defaultServerMounted: false
    automaticWorkerStart: false
  }
  operationRepository: FlowDocBackendPdfExportOperationPostgresRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecyclePostgresRepositoryV1
  dueWorkRepository: FlowDocBackendPdfExportDueWorkRepositoryV1
  persistenceRepository: FlowDocBackendPdfExportPersistencePostgresRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilityPostgresRepositoryV1
  close(): Promise<void>
}

export async function createFlowDocBackendPdfExportLocalPostgresRepositoriesV1(
  options: FlowDocBackendPdfExportLocalPostgresRepositoriesOptionsV1,
): Promise<FlowDocBackendPdfExportLocalPostgresRepositoriesV1> {
  const local = await createFlowDocBackendPdfExportLocalPostgresPoolV1(options)
  try {
    await assertFlowDocBackendPdfExportLocalPostgresSchemaV1(local.pool)
  } catch (error) {
    await local.close()
    throw error
  }
  const repositoryOptions = { pool: local.pool, lockTimeoutMs: local.lockTimeoutMs }
  const lifecycleRepository = createFlowDocBackendPdfExportLifecyclePostgresRepositoryV1({
    ...repositoryOptions,
    faultInjector: options.faultInjectors?.lifecycle,
  })
  return {
    facts: {
      ...local.facts,
      schemaVerifiedBeforeUse: true,
      automaticMigration: false,
      defaultServerMounted: false,
      automaticWorkerStart: false,
    },
    operationRepository: createFlowDocBackendPdfExportOperationPostgresRepositoryV1({
      ...repositoryOptions,
      faultInjector: options.faultInjectors?.operation,
    }),
    lifecycleRepository,
    dueWorkRepository: lifecycleRepository,
    persistenceRepository: createFlowDocBackendPdfExportPersistencePostgresRepositoryV1({
      ...repositoryOptions,
      faultInjector: options.faultInjectors?.persistence,
    }),
    observabilityRepository: createFlowDocBackendPdfExportObservabilityPostgresRepositoryV1({
      ...repositoryOptions,
      faultInjector: options.faultInjectors?.observability,
    }),
    close: () => local.close(),
  }
}
