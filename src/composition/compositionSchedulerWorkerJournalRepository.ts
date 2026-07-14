import {
  cloneCompositionJson,
  compositionIssue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  claimFlowDocBackendCompositionWorkerJournalEntryV1,
  completeFlowDocBackendCompositionWorkerJournalEntryV1,
  createFlowDocBackendCompositionWorkerJournalEntryV1,
  isExactFlowDocBackendCompositionWorkerJournalCreationReplayV1,
  releaseFlowDocBackendCompositionWorkerJournalEntryV1,
  startFlowDocBackendCompositionWorkerJournalEntryV1,
  type FlowDocBackendCompositionWorkerJournalClaimTransitionResultV1,
  type FlowDocBackendCompositionWorkerJournalCompleteTransitionResultV1,
  type FlowDocBackendCompositionWorkerJournalEntryV1,
  type FlowDocBackendCompositionWorkerJournalReleaseTransitionResultV1,
  type FlowDocBackendCompositionWorkerJournalStartTransitionResultV1,
  type FlowDocBackendCompositionWorkerJournalTerminalStatusV1,
} from "./compositionSchedulerWorkerJournalContract.js"
import type {
  FlowDocBackendCompositionWorkerHeadMutationV1,
  FlowDocBackendCompositionWorkerStorageAttemptStateV1,
} from "./compositionSchedulerWorkerAttempt.js"
import {
  compareFlowDocBackendCompositionWorkerDueEntriesV1,
  createFlowDocBackendCompositionWorkerDueCursorV1,
  inspectFlowDocBackendCompositionWorkerDueListInputV1,
  inspectFlowDocBackendCompositionWorkerJournalDueAtV1,
  isFlowDocBackendCompositionWorkerEntryAfterDueCursorV1,
  type FlowDocBackendCompositionWorkerDueListInputV1,
  type FlowDocBackendCompositionWorkerDueListResultV1,
} from "./compositionSchedulerWorkerDueContract.js"

export const FLOWDOC_BACKEND_COMPOSITION_WORKER_JOURNAL_REPOSITORY_V1_SOURCE =
  "flowdoc-backend-composition-worker-journal-repository"

export interface FlowDocBackendCompositionWorkerJournalCreateInputV1 {
  attemptId: string
  createRequestId: string
  createRequestFingerprint: string
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1
  state: FlowDocBackendCompositionWorkerStorageAttemptStateV1
  createdAt: string
}

export type FlowDocBackendCompositionWorkerJournalCreateResultV1 =
  | { status: "created" | "idempotent-replay"; entry: FlowDocBackendCompositionWorkerJournalEntryV1; issues: [] }
  | { status: "conflict" | "invalid"; entry: null; issues: FlowDocBackendCompositionContractIssue[] }

export type FlowDocBackendCompositionWorkerJournalReadResultV1 =
  | { status: "found"; entry: FlowDocBackendCompositionWorkerJournalEntryV1; issues: [] }
  | { status: "not-found"; entry: null; issues: [] }
  | { status: "invalid"; entry: null; issues: FlowDocBackendCompositionContractIssue[] }

export type FlowDocBackendCompositionWorkerJournalClaimResultV1 =
  | FlowDocBackendCompositionWorkerJournalClaimTransitionResultV1
  | { status: "not-found"; entry: null; issues: [] }
  | { status: "storage-invalid"; entry: null; issues: FlowDocBackendCompositionContractIssue[] }

export type FlowDocBackendCompositionWorkerJournalReleaseResultV1 =
  | FlowDocBackendCompositionWorkerJournalReleaseTransitionResultV1
  | { status: "not-found"; entry: null; issues: [] }
  | { status: "storage-invalid"; entry: null; issues: FlowDocBackendCompositionContractIssue[] }

export type FlowDocBackendCompositionWorkerJournalStartResultV1 =
  | FlowDocBackendCompositionWorkerJournalStartTransitionResultV1
  | { status: "not-found"; entry: null; issues: [] }
  | { status: "storage-invalid"; entry: null; issues: FlowDocBackendCompositionContractIssue[] }

export type FlowDocBackendCompositionWorkerJournalCompleteResultV1 =
  | FlowDocBackendCompositionWorkerJournalCompleteTransitionResultV1
  | { status: "not-found"; entry: null; issues: [] }
  | { status: "storage-invalid"; entry: null; issues: FlowDocBackendCompositionContractIssue[] }

export interface FlowDocBackendCompositionWorkerJournalRepositoryV1 {
  workerJournalSource: typeof FLOWDOC_BACKEND_COMPOSITION_WORKER_JOURNAL_REPOSITORY_V1_SOURCE
  createWorkerAttempt(
    input: FlowDocBackendCompositionWorkerJournalCreateInputV1,
  ): Promise<FlowDocBackendCompositionWorkerJournalCreateResultV1>
  readWorkerAttempt(attemptId: string): Promise<FlowDocBackendCompositionWorkerJournalReadResultV1>
  listDueWorkerAttempts(
    input: FlowDocBackendCompositionWorkerDueListInputV1,
  ): Promise<FlowDocBackendCompositionWorkerDueListResultV1>
  claimWorkerAttempt(input: {
    attemptId: string
    expectedJournalRevision: number
    claimToken: string
    workerId: string
    claimedAt: string
    expiresAt: string
  }): Promise<FlowDocBackendCompositionWorkerJournalClaimResultV1>
  startWorkerAttempt(input: {
    attemptId: string
    expectedJournalRevision: number
    claimToken: string
    startedAt: string
  }): Promise<FlowDocBackendCompositionWorkerJournalStartResultV1>
  releaseWorkerAttempt(input: {
    attemptId: string
    expectedJournalRevision: number
    claimToken: string
    releasedAt: string
    nextState: FlowDocBackendCompositionWorkerStorageAttemptStateV1
  }): Promise<FlowDocBackendCompositionWorkerJournalReleaseResultV1>
  completeWorkerAttempt(input: {
    attemptId: string
    expectedJournalRevision: number
    claimToken: string
    completedAt: string
    terminalStatus: FlowDocBackendCompositionWorkerJournalTerminalStatusV1
    resultFingerprint: string
  }): Promise<FlowDocBackendCompositionWorkerJournalCompleteResultV1>
}

function conflict(message: string): FlowDocBackendCompositionContractIssue[] {
  return [compositionIssue("composition-worker-journal-conflict", "attemptId", message)]
}

export function createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1():
FlowDocBackendCompositionWorkerJournalRepositoryV1 {
  const byAttemptId = new Map<string, FlowDocBackendCompositionWorkerJournalEntryV1>()
  const attemptIdByMutationFingerprint = new Map<string, string>()

  const read = (attemptId: string) => byAttemptId.get(attemptId) ?? null
  const store = (entry: FlowDocBackendCompositionWorkerJournalEntryV1) => {
    byAttemptId.set(entry.attemptId, cloneCompositionJson(entry))
    attemptIdByMutationFingerprint.set(entry.mutationFingerprint, entry.attemptId)
  }

  return {
    workerJournalSource: FLOWDOC_BACKEND_COMPOSITION_WORKER_JOURNAL_REPOSITORY_V1_SOURCE,

    async createWorkerAttempt(input) {
      const created = createFlowDocBackendCompositionWorkerJournalEntryV1(input)
      if (created.status === "blocked") return { status: "invalid", entry: null, issues: created.issues }
      const existing = read(created.entry.attemptId)
      if (existing != null) {
        return isExactFlowDocBackendCompositionWorkerJournalCreationReplayV1(existing, created.entry)
          ? { status: "idempotent-replay", entry: cloneCompositionJson(existing), issues: [] }
          : { status: "conflict", entry: null, issues: conflict("attempt id already owns different journal facts") }
      }
      const mutationOwner = attemptIdByMutationFingerprint.get(created.entry.mutationFingerprint)
      if (mutationOwner != null) return {
        status: "conflict",
        entry: null,
        issues: conflict("worker mutation already belongs to another attempt id"),
      }
      store(created.entry)
      return { status: "created", entry: cloneCompositionJson(created.entry), issues: [] }
    },

    async readWorkerAttempt(attemptId) {
      if (typeof attemptId !== "string" || attemptId.length === 0 || attemptId.length > 512) return {
        status: "invalid",
        entry: null,
        issues: [compositionIssue("composition-worker-journal-invalid", "attemptId", "attempt id must be valid")],
      }
      const entry = read(attemptId)
      return entry == null
        ? { status: "not-found", entry: null, issues: [] }
        : { status: "found", entry: cloneCompositionJson(entry), issues: [] }
    },

    async listDueWorkerAttempts(input) {
      const inspected = inspectFlowDocBackendCompositionWorkerDueListInputV1(input)
      if (inspected.status === "invalid") return {
        status: "invalid",
        entries: null,
        nextCursor: null,
        issues: inspected.issues,
      }
      const candidates = [...byAttemptId.values()]
        .filter((entry) => {
          const dueAt = inspectFlowDocBackendCompositionWorkerJournalDueAtV1(entry)
          return entry.status !== "completed"
            && dueAt != null
            && dueAt <= inspected.input.observedAt
            && (inspected.input.after == null
              || isFlowDocBackendCompositionWorkerEntryAfterDueCursorV1(entry, inspected.input.after))
        })
        .sort(compareFlowDocBackendCompositionWorkerDueEntriesV1)
      const hasMore = candidates.length > inspected.input.maximumResultCount
      const entries = candidates.slice(0, inspected.input.maximumResultCount).map(cloneCompositionJson)
      const nextCursor = hasMore && entries.length > 0
        ? createFlowDocBackendCompositionWorkerDueCursorV1(entries.at(-1)!)
        : null
      return { status: "ready", entries, nextCursor, issues: [] }
    },

    async claimWorkerAttempt(input) {
      const entry = read(input.attemptId)
      if (entry == null) return { status: "not-found", entry: null, issues: [] }
      const result = claimFlowDocBackendCompositionWorkerJournalEntryV1({ entry, ...input })
      if (result.status === "claimed" || result.status === "reclaimed") store(result.entry)
      return cloneCompositionJson(result)
    },

    async startWorkerAttempt(input) {
      const entry = read(input.attemptId)
      if (entry == null) return { status: "not-found", entry: null, issues: [] }
      const result = startFlowDocBackendCompositionWorkerJournalEntryV1({ entry, ...input })
      if (result.status === "started") store(result.entry)
      return cloneCompositionJson(result)
    },

    async releaseWorkerAttempt(input) {
      const entry = read(input.attemptId)
      if (entry == null) return { status: "not-found", entry: null, issues: [] }
      const result = releaseFlowDocBackendCompositionWorkerJournalEntryV1({ entry, ...input })
      if (result.status === "released") store(result.entry)
      return cloneCompositionJson(result)
    },

    async completeWorkerAttempt(input) {
      const entry = read(input.attemptId)
      if (entry == null) return { status: "not-found", entry: null, issues: [] }
      const result = completeFlowDocBackendCompositionWorkerJournalEntryV1({ entry, ...input })
      if (result.status === "completed") store(result.entry)
      return cloneCompositionJson(result)
    },
  }
}
