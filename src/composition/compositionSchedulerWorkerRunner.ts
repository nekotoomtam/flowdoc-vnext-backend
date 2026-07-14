import {
  compositionFingerprint,
  compositionIssue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import type { FlowDocBackendCompositionRepositoryV1 } from "./compositionSchedulerRepository.js"
import {
  recoverFlowDocBackendCompositionInterruptedWorkerRetryV1,
  reconcileFlowDocBackendCompositionWorkerStorageAttemptV1,
  retryFlowDocBackendCompositionWorkerStorageAttemptV1,
  type FlowDocBackendCompositionWorkerReconciliationResultV1,
  type FlowDocBackendCompositionWorkerRetryResultV1,
} from "./compositionSchedulerWorkerAttempt.js"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_WORKER_CLAIM_DURATION_MS,
  type FlowDocBackendCompositionWorkerJournalEntryV1,
  type FlowDocBackendCompositionWorkerJournalTerminalStatusV1,
} from "./compositionSchedulerWorkerJournalContract.js"
import type { FlowDocBackendCompositionWorkerJournalRepositoryV1 } from
  "./compositionSchedulerWorkerJournalRepository.js"

export const FLOWDOC_BACKEND_COMPOSITION_WORKER_RUNNER_V1_SOURCE =
  "flowdoc-backend-composition-worker-runner"

type WorkerOutcomeStatus =
  | FlowDocBackendCompositionWorkerReconciliationResultV1["status"]
  | FlowDocBackendCompositionWorkerRetryResultV1["status"]
  | "interrupted-retry-recovered"

export type FlowDocBackendCompositionWorkerRunnerResultV1 =
  | {
      status: "released"
      action: "reconcile" | "retry" | "recover-interrupted-retry"
      outcomeStatus: WorkerOutcomeStatus
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: FlowDocBackendCompositionContractIssue[]
    }
  | {
      status: "completed"
      action: "reconcile" | "retry"
      outcomeStatus: WorkerOutcomeStatus
      terminalStatus: FlowDocBackendCompositionWorkerJournalTerminalStatusV1
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: FlowDocBackendCompositionContractIssue[]
    }
  | {
      status: "terminal-replay"
      action: null
      outcomeStatus: null
      terminalStatus: FlowDocBackendCompositionWorkerJournalTerminalStatusV1
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: []
    }
  | {
      status: "deferred" | "busy" | "ownership-lost" | "blocked" | "journal-unavailable" | "execution-interrupted"
      action: null
      outcomeStatus: null
      terminalStatus: null
      entry: FlowDocBackendCompositionWorkerJournalEntryV1 | null
      issues: FlowDocBackendCompositionContractIssue[]
    }
  | {
      status: "not-found"
      action: null
      outcomeStatus: null
      terminalStatus: null
      entry: null
      issues: []
    }

export interface FlowDocBackendCompositionWorkerRunnerClockV1 {
  now(): string
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function runnerIssue(code: string, message: string, path = "runner"): FlowDocBackendCompositionContractIssue[] {
  return [compositionIssue(code, path, message)]
}

function unavailable(
  entry: FlowDocBackendCompositionWorkerJournalEntryV1 | null,
): FlowDocBackendCompositionWorkerRunnerResultV1 {
  return {
    status: "journal-unavailable",
    action: null,
    outcomeStatus: null,
    terminalStatus: null,
    entry,
    issues: runnerIssue(
      "composition-worker-runner-journal-unavailable",
      "worker journal operation ended without a retained runner decision",
    ),
  }
}

function blocked(
  entry: FlowDocBackendCompositionWorkerJournalEntryV1 | null,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionWorkerRunnerResultV1 {
  return { status: "blocked", action: null, outcomeStatus: null, terminalStatus: null, entry, issues }
}

function ownershipLost(
  entry: FlowDocBackendCompositionWorkerJournalEntryV1 | null,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionWorkerRunnerResultV1 {
  return { status: "ownership-lost", action: null, outcomeStatus: null, terminalStatus: null, entry, issues }
}

function terminalStatus(status: WorkerOutcomeStatus): FlowDocBackendCompositionWorkerJournalTerminalStatusV1 {
  if (status === "blocked" || status === "reconciliation-unavailable" || status === "retry-ready") return "failed"
  if (status === "unavailable" || status === "interrupted-retry-recovered") return "failed"
  return status
}

function resultFingerprint(input: {
  entry: FlowDocBackendCompositionWorkerJournalEntryV1
  action: "reconcile" | "retry"
  outcome: FlowDocBackendCompositionWorkerReconciliationResultV1 | FlowDocBackendCompositionWorkerRetryResultV1
}): string {
  return compositionFingerprint({
    source: FLOWDOC_BACKEND_COMPOSITION_WORKER_RUNNER_V1_SOURCE,
    schemaVersion: 1,
    kind: "composition-worker-runner-outcome",
    attemptId: input.entry.attemptId,
    mutationFingerprint: input.entry.mutationFingerprint,
    action: input.action,
    status: input.outcome.status,
    stateFingerprint: input.outcome.state.fingerprint,
    jobHeadFingerprint: input.outcome.jobHead?.fingerprint ?? null,
    issues: input.outcome.issues,
  })
}

function now(clock: FlowDocBackendCompositionWorkerRunnerClockV1): string | null {
  try {
    const value = clock.now()
    return exactIso(value) ? value : null
  } catch {
    return null
  }
}

export async function runFlowDocBackendCompositionWorkerAttemptOnceV1(input: {
  journalRepository: FlowDocBackendCompositionWorkerJournalRepositoryV1
  compositionRepository: FlowDocBackendCompositionRepositoryV1
  attemptId: string
  workerId: string
  claimToken: string
  claimDurationMilliseconds: number
  clock: FlowDocBackendCompositionWorkerRunnerClockV1
}): Promise<FlowDocBackendCompositionWorkerRunnerResultV1> {
  if (
    !Number.isInteger(input.claimDurationMilliseconds)
    || input.claimDurationMilliseconds < 1
    || input.claimDurationMilliseconds > FLOWDOC_BACKEND_COMPOSITION_MAX_WORKER_CLAIM_DURATION_MS
  ) return blocked(null, runnerIssue(
    "composition-worker-runner-claim-duration-invalid",
    "runner claim duration must be a positive bounded integer",
    "claimDurationMilliseconds",
  ))

  let read
  try {
    read = await input.journalRepository.readWorkerAttempt(input.attemptId)
  } catch {
    return unavailable(null)
  }
  if (read.status === "not-found") return {
    status: "not-found",
    action: null,
    outcomeStatus: null,
    terminalStatus: null,
    entry: null,
    issues: [],
  }
  if (read.status === "invalid") return blocked(null, read.issues)
  if (read.entry.status === "completed" && read.entry.terminal != null) return {
    status: "terminal-replay",
    action: null,
    outcomeStatus: null,
    terminalStatus: read.entry.terminal.status,
    entry: read.entry,
    issues: [],
  }

  const claimedAt = now(input.clock)
  if (claimedAt == null) return blocked(read.entry, runnerIssue(
    "composition-worker-runner-clock-invalid",
    "runner clock must return an exact ISO timestamp before claim",
    "clock",
  ))
  const expiresAt = new Date(Date.parse(claimedAt) + input.claimDurationMilliseconds).toISOString()
  const previousEntry = read.entry
  let claim
  try {
    claim = await input.journalRepository.claimWorkerAttempt({
      attemptId: input.attemptId,
      expectedJournalRevision: previousEntry.journalRevision,
      claimToken: input.claimToken,
      workerId: input.workerId,
      claimedAt,
      expiresAt,
    })
  } catch {
    return unavailable(previousEntry)
  }
  if (claim.status === "not-found") return {
    status: "not-found",
    action: null,
    outcomeStatus: null,
    terminalStatus: null,
    entry: null,
    issues: [],
  }
  if (claim.status === "terminal" && claim.entry.terminal != null) return {
    status: "terminal-replay",
    action: null,
    outcomeStatus: null,
    terminalStatus: claim.entry.terminal.status,
    entry: claim.entry,
    issues: [],
  }
  if (claim.status === "deferred" || claim.status === "busy") return {
    status: claim.status,
    action: null,
    outcomeStatus: null,
    terminalStatus: null,
    entry: claim.entry,
    issues: claim.issues,
  }
  if (claim.status === "stale") return ownershipLost(claim.entry, claim.issues)
  if (claim.status === "invalid" || claim.status === "storage-invalid") return blocked(claim.entry, claim.issues)
  if (claim.status === "idempotent-replay" && claim.entry.execution != null) return {
    status: "busy",
    action: null,
    outcomeStatus: null,
    terminalStatus: null,
    entry: claim.entry,
    issues: runnerIssue(
      "composition-worker-runner-execution-already-started",
      "the exact claim already has an in-flight execution marker",
    ),
  }

  const startedAt = now(input.clock)
  if (startedAt == null) return blocked(claim.entry, runnerIssue(
    "composition-worker-runner-clock-invalid",
    "runner clock must return an exact ISO timestamp before execution",
    "clock",
  ))
  let started
  try {
    started = await input.journalRepository.startWorkerAttempt({
      attemptId: input.attemptId,
      expectedJournalRevision: claim.entry.journalRevision,
      claimToken: input.claimToken,
      startedAt,
    })
  } catch {
    return unavailable(claim.entry)
  }
  if (started.status === "not-found") return {
    status: "not-found",
    action: null,
    outcomeStatus: null,
    terminalStatus: null,
    entry: null,
    issues: [],
  }
  if (started.status === "terminal" && started.entry.terminal != null) return {
    status: "terminal-replay",
    action: null,
    outcomeStatus: null,
    terminalStatus: started.entry.terminal.status,
    entry: started.entry,
    issues: [],
  }
  if (started.status === "idempotent-replay") return {
    status: "busy",
    action: null,
    outcomeStatus: null,
    terminalStatus: null,
    entry: started.entry,
    issues: runnerIssue(
      "composition-worker-runner-execution-already-started",
      "the exact claim already started execution and cannot run in parallel",
    ),
  }
  if (started.status === "stale") return ownershipLost(started.entry, started.issues)
  if (started.status === "invalid" || started.status === "storage-invalid") {
    return blocked(started.entry, started.issues)
  }

  if (
    claim.status === "reclaimed"
    && previousEntry.execution?.phase === "retry-ready"
  ) {
    if (started.entry.state.phase !== "retry-ready") return blocked(started.entry, runnerIssue(
      "composition-worker-runner-recovery-state-invalid",
      "interrupted retry recovery requires the exact retained retry-ready state",
      "entry.state",
    ))
    const recovered = recoverFlowDocBackendCompositionInterruptedWorkerRetryV1({
      mutation: started.entry.mutation,
      state: started.entry.state,
      executionStartedAt: previousEntry.execution.startedAt,
    })
    if (recovered.status === "blocked") return blocked(started.entry, recovered.issues)
    const releasedAt = now(input.clock)
    if (releasedAt == null) return blocked(started.entry, runnerIssue(
      "composition-worker-runner-clock-invalid",
      "runner clock must return an exact ISO timestamp after recovery",
      "clock",
    ))
    try {
      const release = await input.journalRepository.releaseWorkerAttempt({
        attemptId: input.attemptId,
        expectedJournalRevision: started.entry.journalRevision,
        claimToken: input.claimToken,
        releasedAt,
        nextState: recovered.state,
      })
      if (release.status === "released" || release.status === "idempotent-replay") return {
        status: "released",
        action: "recover-interrupted-retry",
        outcomeStatus: "interrupted-retry-recovered",
        entry: release.entry,
        issues: [],
      }
      if (release.status === "stale") return ownershipLost(release.entry, release.issues)
      if (release.status === "not-found") return {
        status: "not-found", action: null, outcomeStatus: null, terminalStatus: null, entry: null, issues: [],
      }
      return blocked(release.entry, release.issues)
    } catch {
      return unavailable(started.entry)
    }
  }

  const action = started.entry.state.phase
  let outcome: FlowDocBackendCompositionWorkerReconciliationResultV1 | FlowDocBackendCompositionWorkerRetryResultV1
  try {
    outcome = action === "reconcile"
      ? await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
          repository: input.compositionRepository,
          mutation: started.entry.mutation,
          state: started.entry.state,
          observedAt: startedAt,
        })
      : await retryFlowDocBackendCompositionWorkerStorageAttemptV1({
          repository: input.compositionRepository,
          mutation: started.entry.mutation,
          state: started.entry.state,
          startedAt,
        })
  } catch {
    return {
      status: "execution-interrupted",
      action: null,
      outcomeStatus: null,
      terminalStatus: null,
      entry: started.entry,
      issues: runnerIssue(
        "composition-worker-runner-execution-interrupted",
        "worker execution threw after its durable start marker and must be recovered after claim expiry",
      ),
    }
  }
  const settledAt = now(input.clock)
  if (settledAt == null) return blocked(started.entry, runnerIssue(
    "composition-worker-runner-clock-invalid",
    "runner clock must return an exact ISO timestamp after execution",
    "clock",
  ))

  const nextState = outcome.status === "retry-ready" || outcome.status === "reconciliation-unavailable"
    || outcome.status === "unavailable" ? outcome.state : null
  if (nextState != null) {
    try {
      const release = await input.journalRepository.releaseWorkerAttempt({
        attemptId: input.attemptId,
        expectedJournalRevision: started.entry.journalRevision,
        claimToken: input.claimToken,
        releasedAt: settledAt,
        nextState,
      })
      if (release.status === "released" || release.status === "idempotent-replay") return {
        status: "released",
        action: action === "reconcile" ? "reconcile" : "retry",
        outcomeStatus: outcome.status,
        entry: release.entry,
        issues: outcome.issues,
      }
      if (release.status === "stale") return ownershipLost(release.entry, release.issues)
      if (release.status === "not-found") return {
        status: "not-found", action: null, outcomeStatus: null, terminalStatus: null, entry: null, issues: [],
      }
      return blocked(release.entry, release.issues)
    } catch {
      return unavailable(started.entry)
    }
  }

  const terminal = terminalStatus(outcome.status)
  try {
    const completion = await input.journalRepository.completeWorkerAttempt({
      attemptId: input.attemptId,
      expectedJournalRevision: started.entry.journalRevision,
      claimToken: input.claimToken,
      completedAt: settledAt,
      terminalStatus: terminal,
      resultFingerprint: resultFingerprint({
        entry: started.entry,
        action: action === "reconcile" ? "reconcile" : "retry",
        outcome,
      }),
    })
    if (completion.status === "completed" || completion.status === "idempotent-replay") return {
      status: "completed",
      action: action === "reconcile" ? "reconcile" : "retry",
      outcomeStatus: outcome.status,
      terminalStatus: terminal,
      entry: completion.entry,
      issues: outcome.issues,
    }
    if (completion.status === "stale") return ownershipLost(completion.entry, completion.issues)
    if (completion.status === "not-found") return {
      status: "not-found", action: null, outcomeStatus: null, terminalStatus: null, entry: null, issues: [],
    }
    return blocked(completion.entry, completion.issues)
  } catch {
    return unavailable(started.entry)
  }
}
