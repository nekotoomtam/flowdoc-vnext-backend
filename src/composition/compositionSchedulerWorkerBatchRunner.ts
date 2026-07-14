import {
  compositionFingerprint,
  compositionIssue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import type { FlowDocBackendCompositionRepositoryV1 } from "./compositionSchedulerRepository.js"
import type { FlowDocBackendCompositionWorkerDueCursorV1 } from "./compositionSchedulerWorkerDueContract.js"
import { FLOWDOC_BACKEND_COMPOSITION_MAX_WORKER_CLAIM_DURATION_MS } from
  "./compositionSchedulerWorkerJournalContract.js"
import type { FlowDocBackendCompositionWorkerJournalRepositoryV1 } from
  "./compositionSchedulerWorkerJournalRepository.js"
import {
  runFlowDocBackendCompositionWorkerAttemptOnceV1,
  type FlowDocBackendCompositionWorkerRunnerClockV1,
  type FlowDocBackendCompositionWorkerRunnerResultV1,
} from "./compositionSchedulerWorkerRunner.js"

export const FLOWDOC_BACKEND_COMPOSITION_WORKER_BATCH_RUNNER_V1_SOURCE =
  "flowdoc-backend-composition-worker-batch-runner"

interface OutcomeCountsV1 {
  released: number
  completed: number
  terminalReplay: number
  deferred: number
  busy: number
  ownershipLost: number
  blocked: number
  journalUnavailable: number
  executionInterrupted: number
  notFound: number
}

interface TerminalCountsV1 {
  committed: number
  superseded: number
  conflict: number
  exhausted: number
  failed: number
  reconciliationExhausted: number
}

export interface FlowDocBackendCompositionWorkerBatchReportV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_WORKER_BATCH_RUNNER_V1_SOURCE
  schemaVersion: 1
  kind: "composition-worker-batch-report"
  runId: string
  workerId: string
  observedAt: string
  maximumResultCount: number
  listedAttemptCount: number
  invokedAttemptCount: number
  nextCursor: FlowDocBackendCompositionWorkerDueCursorV1 | null
  outcomes: OutcomeCountsV1
  terminals: TerminalCountsV1
  fingerprint: string
}

export interface FlowDocBackendCompositionWorkerBatchAttemptResultV1 {
  attemptId: string
  result: FlowDocBackendCompositionWorkerRunnerResultV1
}

export type FlowDocBackendCompositionWorkerBatchResultV1 =
  | {
      status: "ready"
      attempts: FlowDocBackendCompositionWorkerBatchAttemptResultV1[]
      report: FlowDocBackendCompositionWorkerBatchReportV1
      issues: []
    }
  | {
      status: "invalid" | "journal-unavailable" | "storage-invalid"
      attempts: null
      report: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
}

function issue(code: string, message: string): FlowDocBackendCompositionContractIssue[] {
  return [compositionIssue(code, "batchRunner", message)]
}

function emptyOutcomes(): OutcomeCountsV1 {
  return {
    released: 0,
    completed: 0,
    terminalReplay: 0,
    deferred: 0,
    busy: 0,
    ownershipLost: 0,
    blocked: 0,
    journalUnavailable: 0,
    executionInterrupted: 0,
    notFound: 0,
  }
}

function emptyTerminals(): TerminalCountsV1 {
  return {
    committed: 0,
    superseded: 0,
    conflict: 0,
    exhausted: 0,
    failed: 0,
    reconciliationExhausted: 0,
  }
}

function countResult(
  outcomes: OutcomeCountsV1,
  terminals: TerminalCountsV1,
  result: FlowDocBackendCompositionWorkerRunnerResultV1,
): void {
  const outcomeKey: Record<FlowDocBackendCompositionWorkerRunnerResultV1["status"], keyof OutcomeCountsV1> = {
    released: "released",
    completed: "completed",
    "terminal-replay": "terminalReplay",
    deferred: "deferred",
    busy: "busy",
    "ownership-lost": "ownershipLost",
    blocked: "blocked",
    "journal-unavailable": "journalUnavailable",
    "execution-interrupted": "executionInterrupted",
    "not-found": "notFound",
  }
  outcomes[outcomeKey[result.status]] += 1
  const terminal = result.status === "completed" || result.status === "terminal-replay"
    ? result.terminalStatus
    : null
  if (terminal === "committed") terminals.committed += 1
  if (terminal === "superseded") terminals.superseded += 1
  if (terminal === "conflict") terminals.conflict += 1
  if (terminal === "exhausted") terminals.exhausted += 1
  if (terminal === "failed") terminals.failed += 1
  if (terminal === "reconciliation-exhausted") terminals.reconciliationExhausted += 1
}

function finalizeReport(
  facts: Omit<FlowDocBackendCompositionWorkerBatchReportV1, "fingerprint">,
): FlowDocBackendCompositionWorkerBatchReportV1 {
  return { ...facts, fingerprint: compositionFingerprint(facts) }
}

export async function runFlowDocBackendCompositionDueWorkerBatchV1(input: {
  journalRepository: FlowDocBackendCompositionWorkerJournalRepositoryV1
  compositionRepository: FlowDocBackendCompositionRepositoryV1
  runId: string
  workerId: string
  maximumResultCount: number
  after: FlowDocBackendCompositionWorkerDueCursorV1 | null
  claimDurationMilliseconds: number
  clock: FlowDocBackendCompositionWorkerRunnerClockV1
}): Promise<FlowDocBackendCompositionWorkerBatchResultV1> {
  if (
    !validId(input.runId)
    || !validId(input.workerId)
    || !Number.isInteger(input.claimDurationMilliseconds)
    || input.claimDurationMilliseconds < 1
    || input.claimDurationMilliseconds > FLOWDOC_BACKEND_COMPOSITION_MAX_WORKER_CLAIM_DURATION_MS
  ) return {
    status: "invalid",
    attempts: null,
    report: null,
    issues: issue(
      "composition-worker-batch-input-invalid",
      "batch identities and claim duration must be valid and bounded",
    ),
  }
  let observedAt: string
  try {
    observedAt = input.clock.now()
  } catch {
    observedAt = ""
  }
  if (!exactIso(observedAt)) return {
    status: "invalid",
    attempts: null,
    report: null,
    issues: issue("composition-worker-batch-clock-invalid", "batch clock must return one exact listing time"),
  }

  let due
  try {
    due = await input.journalRepository.listDueWorkerAttempts({
      observedAt,
      maximumResultCount: input.maximumResultCount,
      after: input.after,
    })
  } catch {
    return {
      status: "journal-unavailable",
      attempts: null,
      report: null,
      issues: issue("composition-worker-batch-journal-unavailable", "due listing ended without a retained result"),
    }
  }
  if (due.status !== "ready") return {
    status: due.status,
    attempts: null,
    report: null,
    issues: due.issues,
  }

  const attempts: FlowDocBackendCompositionWorkerBatchAttemptResultV1[] = []
  const outcomes = emptyOutcomes()
  const terminals = emptyTerminals()
  for (const entry of due.entries) {
    const claimToken = compositionFingerprint({
      source: FLOWDOC_BACKEND_COMPOSITION_WORKER_BATCH_RUNNER_V1_SOURCE,
      schemaVersion: 1,
      kind: "composition-worker-batch-claim",
      runId: input.runId,
      workerId: input.workerId,
      attemptId: entry.attemptId,
      listedEntryFingerprint: entry.fingerprint,
    })
    let result: FlowDocBackendCompositionWorkerRunnerResultV1
    try {
      result = await runFlowDocBackendCompositionWorkerAttemptOnceV1({
        journalRepository: input.journalRepository,
        compositionRepository: input.compositionRepository,
        attemptId: entry.attemptId,
        workerId: input.workerId,
        claimToken,
        claimDurationMilliseconds: input.claimDurationMilliseconds,
        clock: input.clock,
      })
    } catch {
      result = {
        status: "execution-interrupted",
        action: null,
        outcomeStatus: null,
        terminalStatus: null,
        entry,
        issues: issue(
          "composition-worker-batch-invocation-interrupted",
          "one bounded runner invocation threw without a batch-level decision",
        ),
      }
    }
    attempts.push({ attemptId: entry.attemptId, result })
    countResult(outcomes, terminals, result)
  }

  return {
    status: "ready",
    attempts,
    report: finalizeReport({
      source: FLOWDOC_BACKEND_COMPOSITION_WORKER_BATCH_RUNNER_V1_SOURCE,
      schemaVersion: 1,
      kind: "composition-worker-batch-report",
      runId: input.runId,
      workerId: input.workerId,
      observedAt,
      maximumResultCount: input.maximumResultCount,
      listedAttemptCount: due.entries.length,
      invokedAttemptCount: attempts.length,
      nextCursor: due.nextCursor,
      outcomes,
      terminals,
    }),
    issues: [],
  }
}
