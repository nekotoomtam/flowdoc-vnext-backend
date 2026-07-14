import {
  compositionIssue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import type { FlowDocBackendCompositionWorkerJournalEntryV1 } from
  "./compositionSchedulerWorkerJournalContract.js"
import { inspectFlowDocBackendCompositionWorkerStorageAttemptV1 } from
  "./compositionSchedulerWorkerAttempt.js"

export const FLOWDOC_BACKEND_COMPOSITION_MAX_DUE_WORKER_ATTEMPTS = 64

export interface FlowDocBackendCompositionWorkerDueCursorV1 {
  dueAt: string
  attemptId: string
}

export interface FlowDocBackendCompositionWorkerDueListInputV1 {
  observedAt: string
  maximumResultCount: number
  after: FlowDocBackendCompositionWorkerDueCursorV1 | null
}

export type FlowDocBackendCompositionWorkerDueListResultV1 =
  | {
      status: "ready"
      entries: FlowDocBackendCompositionWorkerJournalEntryV1[]
      nextCursor: FlowDocBackendCompositionWorkerDueCursorV1 | null
      issues: []
    }
  | {
      status: "invalid" | "storage-invalid"
      entries: null
      nextCursor: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionWorkerDueListInspectionV1 =
  | { status: "ready"; input: FlowDocBackendCompositionWorkerDueListInputV1; issues: [] }
  | { status: "invalid"; input: null; issues: FlowDocBackendCompositionContractIssue[] }

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function validAttemptId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

export function inspectFlowDocBackendCompositionWorkerDueListInputV1(
  input: FlowDocBackendCompositionWorkerDueListInputV1,
): FlowDocBackendCompositionWorkerDueListInspectionV1 {
  if (
    !exactIso(input.observedAt)
    || !Number.isInteger(input.maximumResultCount)
    || input.maximumResultCount < 1
    || input.maximumResultCount > FLOWDOC_BACKEND_COMPOSITION_MAX_DUE_WORKER_ATTEMPTS
    || (input.after != null && (
      !exactIso(input.after.dueAt)
      || !validAttemptId(input.after.attemptId)
    ))
  ) return {
    status: "invalid",
    input: null,
    issues: [compositionIssue(
      "composition-worker-due-list-invalid",
      "dueList",
      "due listing requires an exact time, bounded result count, and exact optional cursor",
    )],
  }
  return {
    status: "ready",
    input: {
      observedAt: input.observedAt,
      maximumResultCount: input.maximumResultCount,
      after: input.after == null ? null : { ...input.after },
    },
    issues: [],
  }
}

export function inspectFlowDocBackendCompositionWorkerJournalNotBeforeV1(
  entry: FlowDocBackendCompositionWorkerJournalEntryV1,
): string | null {
  const inspected = inspectFlowDocBackendCompositionWorkerStorageAttemptV1({
    mutation: entry.mutation,
    state: entry.state,
  })
  return inspected.status === "ready" ? inspected.notBefore : null
}

export function inspectFlowDocBackendCompositionWorkerJournalDueAtV1(
  entry: FlowDocBackendCompositionWorkerJournalEntryV1,
): string | null {
  if (entry.status === "completed") return null
  if (entry.status === "claimed") return entry.claim?.expiresAt ?? null
  return inspectFlowDocBackendCompositionWorkerJournalNotBeforeV1(entry)
}

export function compareFlowDocBackendCompositionWorkerDueEntriesV1(
  left: FlowDocBackendCompositionWorkerJournalEntryV1,
  right: FlowDocBackendCompositionWorkerJournalEntryV1,
): number {
  const leftDueAt = inspectFlowDocBackendCompositionWorkerJournalDueAtV1(left)
  const rightDueAt = inspectFlowDocBackendCompositionWorkerJournalDueAtV1(right)
  if (leftDueAt == null || rightDueAt == null) return compareUtf8(left.attemptId, right.attemptId)
  return leftDueAt.localeCompare(rightDueAt) || compareUtf8(left.attemptId, right.attemptId)
}

export function isFlowDocBackendCompositionWorkerEntryAfterDueCursorV1(
  entry: FlowDocBackendCompositionWorkerJournalEntryV1,
  cursor: FlowDocBackendCompositionWorkerDueCursorV1,
): boolean {
  const dueAt = inspectFlowDocBackendCompositionWorkerJournalDueAtV1(entry)
  return dueAt != null && (
    dueAt > cursor.dueAt
    || (dueAt === cursor.dueAt && compareUtf8(entry.attemptId, cursor.attemptId) > 0)
  )
}

export function createFlowDocBackendCompositionWorkerDueCursorV1(
  entry: FlowDocBackendCompositionWorkerJournalEntryV1,
): FlowDocBackendCompositionWorkerDueCursorV1 | null {
  const dueAt = inspectFlowDocBackendCompositionWorkerJournalDueAtV1(entry)
  return dueAt == null ? null : { dueAt, attemptId: entry.attemptId }
}
