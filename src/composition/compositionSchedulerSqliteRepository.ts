import type { DatabaseSync } from "node:sqlite"
import { compositionIssue } from "./compositionSchedulerContractSupport.js"
import {
  FLOWDOC_BACKEND_COMPOSITION_PRODUCTION_REPOSITORY_V1_SOURCE,
  type FlowDocBackendCompositionProductionRepositoryV1,
} from "./compositionSchedulerProductionRepository.js"
import {
  inspectFlowDocBackendCompositionSqlitePhysicalUsageV1,
  putFlowDocBackendCompositionSqliteImmutableBatchV1,
  putFlowDocBackendCompositionSqliteImmutableV1,
  readFlowDocBackendCompositionSqliteImmutableBatchV1,
  readFlowDocBackendCompositionSqliteImmutableByFingerprintV1,
  readFlowDocBackendCompositionSqliteImmutableV1,
} from "./compositionSchedulerSqliteImmutableStore.js"
import {
  compareAndSwapFlowDocBackendCompositionSqliteHeadV1,
  createFlowDocBackendCompositionSqliteHeadV1,
  readFlowDocBackendCompositionSqliteCommittedFinalizationV1,
  readFlowDocBackendCompositionSqliteCommittedRequestV1,
  readFlowDocBackendCompositionSqliteHeadV1,
} from "./compositionSchedulerSqliteHeadStore.js"
import { cleanupFlowDocBackendCompositionSqliteUnreachableV1 } from "./compositionSchedulerSqliteMaintenance.js"
import {
  FLOWDOC_BACKEND_COMPOSITION_SQLITE_CANDIDATE_SOURCE,
  isFlowDocBackendCompositionSqliteBusyErrorV1,
  openFlowDocBackendCompositionSqliteDatabaseV1,
  type FlowDocBackendCompositionSqliteCandidateOptionsV1,
} from "./compositionSchedulerSqliteSupport.js"

export interface FlowDocBackendCompositionSqliteRepositoryV1
  extends FlowDocBackendCompositionProductionRepositoryV1 {
  candidateSource: typeof FLOWDOC_BACKEND_COMPOSITION_SQLITE_CANDIDATE_SOURCE
  databasePath: string
  close(): void
}

function createRepository(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
): FlowDocBackendCompositionSqliteRepositoryV1 {
  return {
    source: "flowdoc-backend-composition-repository",
    productionSource: FLOWDOC_BACKEND_COMPOSITION_PRODUCTION_REPOSITORY_V1_SOURCE,
    candidateSource: FLOWDOC_BACKEND_COMPOSITION_SQLITE_CANDIDATE_SOURCE,
    databasePath: options.databasePath,

    async putImmutable(input) {
      const result = putFlowDocBackendCompositionSqliteImmutableV1(database, options, {
        ...input,
        storedAt: new Date().toISOString(),
        maximumPhysicalByteCount: null,
      })
      if ("usage" in result) {
        throw new Error("unbounded SQLite immutable write returned a production-only storage status")
      }
      return result
    },
    async putImmutableWithPhysicalAdmission(input) {
      try {
        return putFlowDocBackendCompositionSqliteImmutableV1(database, options, input)
      } catch (error) {
        if (!isFlowDocBackendCompositionSqliteBusyErrorV1(error)) throw error
        return {
          status: "storage-error",
          ref: null,
          usage: null,
          issues: [compositionIssue(
            "composition-sqlite-busy",
            "repository",
            "SQLite immutable admission exceeded its bounded writer wait",
          )],
        }
      }
    },
    async putImmutableBatchWithPhysicalAdmission(input) {
      try {
        return putFlowDocBackendCompositionSqliteImmutableBatchV1(database, options, input)
      } catch (error) {
        if (!isFlowDocBackendCompositionSqliteBusyErrorV1(error)) throw error
        return {
          status: "storage-error",
          refs: null,
          writtenRecordCount: 0,
          usage: null,
          issues: [compositionIssue(
            "composition-sqlite-busy",
            "repository",
            "SQLite immutable batch admission exceeded its bounded writer wait",
          )],
        }
      }
    },
    async readImmutable(input) {
      return readFlowDocBackendCompositionSqliteImmutableV1(database, input)
    },
    async readImmutableByFingerprint(input) {
      return readFlowDocBackendCompositionSqliteImmutableByFingerprintV1(database, input)
    },
    async readImmutableBatch(input) {
      return readFlowDocBackendCompositionSqliteImmutableBatchV1(database, input)
    },
    async inspectPhysicalUsage(jobId) {
      return inspectFlowDocBackendCompositionSqlitePhysicalUsageV1(database, jobId)
    },
    async cleanupUnreachable(input) {
      return cleanupFlowDocBackendCompositionSqliteUnreachableV1(database, options, input)
    },
    async createHead(input) {
      return createFlowDocBackendCompositionSqliteHeadV1(database, options, input)
    },
    async readHead(jobId) {
      return readFlowDocBackendCompositionSqliteHeadV1(database, jobId)
    },
    async readCommittedRequest(input) {
      return readFlowDocBackendCompositionSqliteCommittedRequestV1(database, input)
    },
    async readCommittedFinalization(input) {
      return readFlowDocBackendCompositionSqliteCommittedFinalizationV1(database, input)
    },
    async compareAndSwapHead(input) {
      return compareAndSwapFlowDocBackendCompositionSqliteHeadV1(database, options, input)
    },
    close() {
      database.close()
    },
  }
}

export async function createFlowDocBackendCompositionSqliteRepositoryV1(
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
): Promise<FlowDocBackendCompositionSqliteRepositoryV1> {
  const database = await openFlowDocBackendCompositionSqliteDatabaseV1(options)
  return createRepository(database, options)
}
