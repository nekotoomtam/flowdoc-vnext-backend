import type { FlowDocBackendCompositionContractIssue } from "./compositionSchedulerContractSupport.js"
import type {
  FlowDocBackendCompositionHeadReadResultV1,
  FlowDocBackendCompositionImmutableReadResultV1,
  FlowDocBackendCompositionImmutableWriteResultV1,
  FlowDocBackendCompositionRepositoryV1,
} from "./compositionSchedulerRepository.js"
import type { FlowDocBackendCompositionContentRefV1 } from "./compositionSchedulerSourcePin.js"

export const FLOWDOC_BACKEND_COMPOSITION_PRODUCTION_REPOSITORY_V1_SOURCE =
  "flowdoc-backend-composition-production-repository"
export const FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS = 256
export const FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS = 1_000

export interface FlowDocBackendCompositionPhysicalUsageV1 {
  recordCount: number
  byteCount: number
}

export type FlowDocBackendCompositionPhysicalUsageResultV1 =
  | {
      status: "ready"
      usage: FlowDocBackendCompositionPhysicalUsageV1
      issues: []
    }
  | {
      status: "not-found" | "invalid" | "storage-error"
      usage: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionPhysicalAdmissionWriteResultV1 =
  | FlowDocBackendCompositionImmutableWriteResultV1
  | {
      status: "physical-quota-exceeded" | "storage-error"
      ref: null
      usage: FlowDocBackendCompositionPhysicalUsageV1 | null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionImmutableBatchReadResultV1 =
  | {
      status: "found"
      records: Array<Extract<FlowDocBackendCompositionImmutableReadResultV1, { status: "found" }>>
      issues: []
    }
  | {
      status: "not-found" | "invalid" | "storage-error"
      records: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionCleanupResultV1 =
  | {
      status: "completed" | "budget-exhausted"
      deletedRefs: FlowDocBackendCompositionContentRefV1[]
      usage: FlowDocBackendCompositionPhysicalUsageV1
      issues: []
    }
  | {
      status: "stale" | "not-found" | "invalid" | "storage-error"
      deletedRefs: null
      usage: null
      head: FlowDocBackendCompositionHeadReadResultV1["head"]
      issues: FlowDocBackendCompositionContractIssue[]
    }

/**
 * Production adapters extend the scheduler repository without weakening its
 * existing logical commit contract. These methods remain inactive until an
 * adapter passes the independent conformance gate.
 */
export interface FlowDocBackendCompositionProductionRepositoryV1
  extends FlowDocBackendCompositionRepositoryV1 {
  productionSource: typeof FLOWDOC_BACKEND_COMPOSITION_PRODUCTION_REPOSITORY_V1_SOURCE
  putImmutableWithPhysicalAdmission(input: {
    ref: unknown
    value: unknown
    storedAt: string
    maximumPhysicalByteCount: number
  }): Promise<FlowDocBackendCompositionPhysicalAdmissionWriteResultV1>
  readImmutableBatch(input: {
    jobId: string
    refs: readonly unknown[]
  }): Promise<FlowDocBackendCompositionImmutableBatchReadResultV1>
  inspectPhysicalUsage(jobId: string): Promise<FlowDocBackendCompositionPhysicalUsageResultV1>
  cleanupUnreachable(input: {
    jobId: string
    expectedHeadFingerprint: string
    reachableRefs: readonly unknown[]
    storedBefore: string
    maximumDeleteCount: number
  }): Promise<FlowDocBackendCompositionCleanupResultV1>
}
