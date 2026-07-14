import { compositionIssue, type FlowDocBackendCompositionContractIssue } from "./compositionSchedulerContractSupport.js"
import type {
  FlowDocBackendCompositionHeadCompareAndSwapResultV1,
  FlowDocBackendCompositionHeadCreateResultV1,
  FlowDocBackendCompositionHeadReadResultV1,
  FlowDocBackendCompositionImmutableReadResultV1,
  FlowDocBackendCompositionImmutableWriteResultV1,
  FlowDocBackendCompositionRepositoryV1,
} from "./compositionSchedulerRepository.js"
import type { FlowDocBackendCompositionContentRefV1 } from "./compositionSchedulerSourcePin.js"

export const FLOWDOC_BACKEND_COMPOSITION_PRODUCTION_REPOSITORY_V1_SOURCE =
  "flowdoc-backend-composition-production-repository"
export const FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS = 256
export const FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_WRITE_RECORDS = 64
export const FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS = 1_000
export const FLOWDOC_BACKEND_COMPOSITION_DEFAULT_TRANSIENT_RETRY_AFTER_MS = 250
export const FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_STORAGE_ATTEMPTS = 3
export const FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_RETRY_AFTER_MS = 2_000

export interface FlowDocBackendCompositionTransientAvailabilityV1 {
  kind: "transient-storage"
  source: "provider-declared" | "adapter-exception"
  operation: "head-create" | "head-compare-and-swap"
  commitState: "unknown"
  retryable: true
  retryAfterMilliseconds: number
  retryPolicy: {
    strategy: "exponential"
    reconcileBeforeRetry: true
    maximumAttemptCount: number
    maximumDelayMilliseconds: number
  }
  reconcileWith: "create-request" | "head-read" | "committed-request" | "committed-finalization"
}

export type FlowDocBackendCompositionHeadUnavailableResultV1 = {
  status: "unavailable"
  head: null
  availability: FlowDocBackendCompositionTransientAvailabilityV1
  issues: FlowDocBackendCompositionContractIssue[]
}

export type FlowDocBackendCompositionAvailableHeadCreateResultV1 =
  | FlowDocBackendCompositionHeadCreateResultV1
  | FlowDocBackendCompositionHeadUnavailableResultV1

export type FlowDocBackendCompositionAvailableHeadCompareAndSwapResultV1 =
  | FlowDocBackendCompositionHeadCompareAndSwapResultV1
  | FlowDocBackendCompositionHeadUnavailableResultV1

export function createFlowDocBackendCompositionHeadUnavailableResultV1(input: {
  operation: FlowDocBackendCompositionTransientAvailabilityV1["operation"]
  reconcileWith: FlowDocBackendCompositionTransientAvailabilityV1["reconcileWith"]
  message: string
  source?: FlowDocBackendCompositionTransientAvailabilityV1["source"]
}): FlowDocBackendCompositionHeadUnavailableResultV1 {
  return {
    status: "unavailable",
    head: null,
    availability: {
      kind: "transient-storage",
      source: input.source ?? "provider-declared",
      operation: input.operation,
      commitState: "unknown",
      retryable: true,
      retryAfterMilliseconds: FLOWDOC_BACKEND_COMPOSITION_DEFAULT_TRANSIENT_RETRY_AFTER_MS,
      retryPolicy: {
        strategy: "exponential",
        reconcileBeforeRetry: true,
        maximumAttemptCount: FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_STORAGE_ATTEMPTS,
        maximumDelayMilliseconds: FLOWDOC_BACKEND_COMPOSITION_MAX_TRANSIENT_RETRY_AFTER_MS,
      },
      reconcileWith: input.reconcileWith,
    },
    issues: [compositionIssue("composition-storage-transient-unavailable", "repository", input.message)],
  }
}

export type FlowDocBackendCompositionTransientRetryDecisionV1 =
  | {
      status: "retry"
      nextAttemptNumber: number
      delayMilliseconds: number
      reconcileWith: FlowDocBackendCompositionTransientAvailabilityV1["reconcileWith"]
    }
  | {
      status: "exhausted"
      nextAttemptNumber: null
      delayMilliseconds: null
      reconcileWith: FlowDocBackendCompositionTransientAvailabilityV1["reconcileWith"]
    }

export function decideFlowDocBackendCompositionTransientRetryV1(input: {
  availability: FlowDocBackendCompositionTransientAvailabilityV1
  completedAttemptCount: number
}): FlowDocBackendCompositionTransientRetryDecisionV1 {
  if (!Number.isInteger(input.completedAttemptCount) || input.completedAttemptCount < 1) return {
    status: "exhausted",
    nextAttemptNumber: null,
    delayMilliseconds: null,
    reconcileWith: input.availability.reconcileWith,
  }
  if (input.completedAttemptCount >= input.availability.retryPolicy.maximumAttemptCount) return {
    status: "exhausted",
    nextAttemptNumber: null,
    delayMilliseconds: null,
    reconcileWith: input.availability.reconcileWith,
  }
  return {
    status: "retry",
    nextAttemptNumber: input.completedAttemptCount + 1,
    delayMilliseconds: Math.min(
      FLOWDOC_BACKEND_COMPOSITION_DEFAULT_TRANSIENT_RETRY_AFTER_MS * 2 ** (input.completedAttemptCount - 1),
      input.availability.retryPolicy.maximumDelayMilliseconds,
    ),
    reconcileWith: input.availability.reconcileWith,
  }
}

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

export type FlowDocBackendCompositionPhysicalAdmissionBatchWriteResultV1 =
  | {
      status: "written" | "idempotent-replay"
      refs: FlowDocBackendCompositionContentRefV1[]
      writtenRecordCount: number
      usage: FlowDocBackendCompositionPhysicalUsageV1
      issues: []
    }
  | {
      status: "conflict" | "invalid" | "physical-quota-exceeded" | "storage-error"
      refs: null
      writtenRecordCount: 0
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
  createHeadWithAvailability(
    input: Parameters<FlowDocBackendCompositionRepositoryV1["createHead"]>[0],
  ): Promise<FlowDocBackendCompositionAvailableHeadCreateResultV1>
  compareAndSwapHeadWithAvailability(
    input: Parameters<FlowDocBackendCompositionRepositoryV1["compareAndSwapHead"]>[0],
  ): Promise<FlowDocBackendCompositionAvailableHeadCompareAndSwapResultV1>
  putImmutableWithPhysicalAdmission(input: {
    ref: unknown
    value: unknown
    storedAt: string
    maximumPhysicalByteCount: number
  }): Promise<FlowDocBackendCompositionPhysicalAdmissionWriteResultV1>
  putImmutableBatchWithPhysicalAdmission(input: {
    records: readonly { ref: unknown; value: unknown }[]
    storedAt: string
    maximumPhysicalByteCount: number
  }): Promise<FlowDocBackendCompositionPhysicalAdmissionBatchWriteResultV1>
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

export function isFlowDocBackendCompositionProductionRepositoryV1(
  repository: FlowDocBackendCompositionRepositoryV1,
): repository is FlowDocBackendCompositionProductionRepositoryV1 {
  const candidate = repository as Partial<FlowDocBackendCompositionProductionRepositoryV1>
  return candidate.productionSource === FLOWDOC_BACKEND_COMPOSITION_PRODUCTION_REPOSITORY_V1_SOURCE
    && typeof candidate.createHeadWithAvailability === "function"
    && typeof candidate.compareAndSwapHeadWithAvailability === "function"
    && typeof candidate.putImmutableWithPhysicalAdmission === "function"
    && typeof candidate.putImmutableBatchWithPhysicalAdmission === "function"
    && typeof candidate.readImmutableBatch === "function"
    && typeof candidate.inspectPhysicalUsage === "function"
    && typeof candidate.cleanupUnreachable === "function"
}
