import { createHash } from "node:crypto"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
  type FlowDocBackendPdfExportDueWorkEntryV1,
} from "./pdfExportDueWork.js"
import {
  parseFlowDocBackendPdfExportLifecycleHeadV1,
  type FlowDocBackendPdfExportLifecycleHeadV1,
} from "./pdfExportLifecycle.js"
import type { FlowDocBackendPdfExportLifecycleRepositoryV1 } from "./pdfExportLifecycleRepository.js"
import {
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  type FlowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"
import type { FlowDocBackendPdfExportOperationRepositoryV1 } from "./pdfExportOperationRepository.js"
import type { FlowDocBackendPdfExportObservabilityRepositoryV1 } from "./pdfExportObservability.js"
import type {
  FlowDocBackendPdfExportWorkflowInputV1,
  FlowDocBackendPdfExportWorkflowResultV1,
} from "./pdfExportWorkflow.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-worker" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_MAX_CLAIM_DURATION_MS = 300_000

export interface FlowDocBackendPdfExportLocalWorkerExecutionInputV1 {
  entry: FlowDocBackendPdfExportDueWorkEntryV1
  operation: FlowDocBackendPdfExportOperationV1
  lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1
  workerId: string
  claimToken: string
  ownsClaim: boolean
  attemptNumber: number | null
  now(): string
}

export type FlowDocBackendPdfExportLocalWorkerExecutorV1 = (
  input: FlowDocBackendPdfExportLocalWorkerExecutionInputV1,
) => Promise<FlowDocBackendPdfExportWorkflowResultV1>

export type FlowDocBackendPdfExportLocalWorkerEntryStatusV1 =
  | "completed"
  | "terminal-replay"
  | "terminated"
  | "released"
  | "attempts-exhausted"
  | "deadline-stopped"
  | "deferred"
  | "ownership-lost"
  | "not-found"
  | "blocked"
  | "storage-unavailable"
  | "execution-interrupted"

export interface FlowDocBackendPdfExportLocalWorkerEntryResultV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_V1_SOURCE
  operationId: string
  status: FlowDocBackendPdfExportLocalWorkerEntryStatusV1
  claimToken: string | null
  attemptNumber: number | null
  lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1 | null
  rendererExecuted: boolean
  persistenceExecuted: boolean
  issues: FlowDocBackendPdfExportOperationIssueV1[]
  contracts: {
    terminalCheckedBeforeClaim: true
    claimUsesLifecycleCas: true
    uncertainClaimReconciledByRead: true
    uncertainTerminalNeverReleased: true
    retryReleaseBounded: true
    concurrency: 1
    backendRoute: false
    productionBinding: false
  }
}

export interface FlowDocBackendPdfExportLocalWorkerEntryRunnerInputV1 {
  runId: string
  workerId: string
  entry: FlowDocBackendPdfExportDueWorkEntryV1
  claimDurationMs: number
  retryDelayMs: number
  operationRepository: FlowDocBackendPdfExportOperationRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilityRepositoryV1
  execute: FlowDocBackendPdfExportLocalWorkerExecutorV1
  now(): string
  onClaimed?: (input: {
    entry: FlowDocBackendPdfExportDueWorkEntryV1
    claimToken: string
    lifecycleHead: FlowDocBackendPdfExportLifecycleHeadV1
  }) => void
}

function contracts() {
  return {
    terminalCheckedBeforeClaim: true as const,
    claimUsesLifecycleCas: true as const,
    uncertainClaimReconciledByRead: true as const,
    uncertainTerminalNeverReleased: true as const,
    retryReleaseBounded: true as const,
    concurrency: 1 as const,
    backendRoute: false as const,
    productionBinding: false as const,
  }
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function id(kind: string, facts: object): string {
  const digest = createHash("sha256").update(JSON.stringify(facts)).digest("hex")
  return `pdf-local-${kind}:${digest}`
}

function result(input: {
  operationId: string
  status: FlowDocBackendPdfExportLocalWorkerEntryStatusV1
  claimToken?: string | null
  attemptNumber?: number | null
  lifecycleHead?: FlowDocBackendPdfExportLifecycleHeadV1 | null
  rendererExecuted?: boolean
  persistenceExecuted?: boolean
  issues?: FlowDocBackendPdfExportOperationIssueV1[]
}): FlowDocBackendPdfExportLocalWorkerEntryResultV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_V1_SOURCE,
    operationId: input.operationId,
    status: input.status,
    claimToken: input.claimToken ?? null,
    attemptNumber: input.attemptNumber ?? null,
    lifecycleHead: input.lifecycleHead ?? null,
    rendererExecuted: input.rendererExecuted ?? false,
    persistenceExecuted: input.persistenceExecuted ?? false,
    issues: input.issues ?? [],
    contracts: contracts(),
  }
}

function inspectEntry(entry: FlowDocBackendPdfExportDueWorkEntryV1): FlowDocBackendPdfExportOperationIssueV1[] {
  const parsed = parseFlowDocBackendPdfExportLifecycleHeadV1(entry.head)
  if (parsed.status === "blocked") return parsed.issues
  const head = parsed.head
  const expectedLane = head.status === "pending"
    ? "claim-ready"
    : head.status === "claimed"
      ? "claim-expired"
      : "terminal-finalization"
  const expectedDueAt = head.status === "pending"
    ? head.retryAfter ?? head.updatedAt
    : head.status === "claimed"
      ? head.claim!.expiresAt
      : head.updatedAt
  if (
    entry.source !== FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE
    || entry.operationId !== head.operationId
    || entry.scope.tenantId !== head.scope.tenantId
    || entry.scope.principalId !== head.scope.principalId
    || entry.headRevision !== head.headRevision
    || entry.lifecycleFingerprint !== head.lifecycleFingerprint
    || entry.lane !== expectedLane
    || entry.dueAt !== expectedDueAt
  ) return [issue(
    "pdf-export-local-worker-entry-invalid",
    "entry",
    "due-work entry must match its exact retained lifecycle head and schedule projection",
  )]
  return []
}

function readNow(input: FlowDocBackendPdfExportLocalWorkerEntryRunnerInputV1): string | null {
  const value = input.now()
  return exactIso(value) ? value : null
}

async function terminalStatus(
  input: FlowDocBackendPdfExportLocalWorkerEntryRunnerInputV1,
): Promise<"found" | "not-found" | "storage-unavailable" | "invalid"> {
  const terminal = await input.observabilityRepository.readTerminalWorkflow({
    ...input.entry.scope,
    operationId: input.entry.operationId,
  })
  return terminal.status
}

async function execute(
  input: FlowDocBackendPdfExportLocalWorkerEntryRunnerInputV1,
  operation: FlowDocBackendPdfExportOperationV1,
  head: FlowDocBackendPdfExportLifecycleHeadV1,
  claimToken: string,
): Promise<FlowDocBackendPdfExportLocalWorkerEntryResultV1> {
  const ownsClaim = head.status === "claimed" && head.claim?.claimToken === claimToken
  if (ownsClaim) input.onClaimed?.({ entry: input.entry, claimToken, lifecycleHead: head })
  let execution: FlowDocBackendPdfExportWorkflowResultV1 | null = null
  let executionError: unknown = null
  try {
    execution = await input.execute({
      entry: input.entry,
      operation,
      lifecycleHead: head,
      workerId: input.workerId,
      claimToken,
      ownsClaim,
      attemptNumber: ownsClaim ? head.claim!.attemptNumber : null,
      now: input.now,
    })
  } catch (error) {
    executionError = error
  }
  if (execution != null && execution.status !== "blocked") return result({
    operationId: input.entry.operationId,
    status: execution.status,
    claimToken: ownsClaim ? claimToken : null,
    attemptNumber: ownsClaim ? head.claim!.attemptNumber : null,
    lifecycleHead: execution.lifecycleHead,
    rendererExecuted: execution.execution.rendererExecuted,
    persistenceExecuted: execution.execution.persistenceExecuted,
  })

  let retainedTerminal: "found" | "not-found" | "storage-unavailable" | "invalid"
  try {
    retainedTerminal = await terminalStatus(input)
  } catch {
    retainedTerminal = "storage-unavailable"
  }
  if (retainedTerminal === "found") return result({
    operationId: input.entry.operationId,
    status: "terminal-replay",
    claimToken: ownsClaim ? claimToken : null,
    attemptNumber: ownsClaim ? head.claim!.attemptNumber : null,
    lifecycleHead: execution?.lifecycleHead ?? head,
    rendererExecuted: execution?.execution.rendererExecuted ?? false,
    persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
  })
  if (retainedTerminal !== "not-found") return result({
    operationId: input.entry.operationId,
    status: "execution-interrupted",
    claimToken: ownsClaim ? claimToken : null,
    attemptNumber: ownsClaim ? head.claim!.attemptNumber : null,
    lifecycleHead: execution?.lifecycleHead ?? head,
    rendererExecuted: execution?.execution.rendererExecuted ?? false,
    persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
    issues: [issue(
      "pdf-export-local-worker-terminal-uncertain",
      "terminalWorkflow",
      "worker cannot release ownership while terminal commit state is unavailable",
    )],
  })

  const current = await input.lifecycleRepository.readLifecycle({
    ...input.entry.scope,
    operationId: input.entry.operationId,
  })
  if (current.status !== "found") return result({
    operationId: input.entry.operationId,
    status: current.status === "not-found" ? "not-found" : "storage-unavailable",
    claimToken: ownsClaim ? claimToken : null,
    attemptNumber: ownsClaim ? head.claim!.attemptNumber : null,
    lifecycleHead: execution?.lifecycleHead ?? head,
    rendererExecuted: execution?.execution.rendererExecuted ?? false,
    persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
    issues: current.issues,
  })
  if (current.head.status !== "claimed" || current.head.claim?.claimToken !== claimToken) return result({
    operationId: input.entry.operationId,
    status: current.head.status === "stopped" ? "blocked" : "ownership-lost",
    claimToken: null,
    lifecycleHead: current.head,
    rendererExecuted: execution?.execution.rendererExecuted ?? false,
    persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
    issues: execution?.issues ?? (executionError == null ? [] : [issue(
      "pdf-export-local-worker-execution-failed",
      "execute",
      "worker execution failed after ownership was no longer live",
    )]),
  })
  const releasedAt = readNow(input)
  if (
    releasedAt == null
    || Date.parse(releasedAt) >= Date.parse(current.head.claim.expiresAt)
    || Date.parse(releasedAt) >= Date.parse(current.head.deadlineAt)
  ) return result({
    operationId: input.entry.operationId,
    status: "execution-interrupted",
    claimToken,
    attemptNumber: current.head.claim.attemptNumber,
    lifecycleHead: current.head,
    rendererExecuted: execution?.execution.rendererExecuted ?? false,
    persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
    issues: [issue(
      "pdf-export-local-worker-release-window-expired",
      "release",
      "worker leaves ownership to expire when a safe retry release window is no longer available",
    )],
  })
  const desiredRetryAt = Date.parse(releasedAt) + input.retryDelayMs
  if (desiredRetryAt >= Date.parse(current.head.deadlineAt)) return result({
    operationId: input.entry.operationId,
    status: "execution-interrupted",
    claimToken,
    attemptNumber: current.head.claim.attemptNumber,
    lifecycleHead: current.head,
    rendererExecuted: execution?.execution.rendererExecuted ?? false,
    persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
    issues: [issue(
      "pdf-export-local-worker-retry-crosses-deadline",
      "retryAfter",
      "worker leaves the bounded claim to expire when retry backoff reaches the operation deadline",
    )],
  })
  const retryAfter = new Date(desiredRetryAt).toISOString()
  const released = await input.lifecycleRepository.applyLifecycleTransition({
    transitionId: id("release", {
      runId: input.runId,
      operationId: input.entry.operationId,
      claimToken,
      headRevision: current.head.headRevision,
    }),
    ...input.entry.scope,
    operationId: input.entry.operationId,
    expectedHeadRevision: current.head.headRevision,
    transitionAt: releasedAt,
    kind: "release-claim",
    claimToken,
    retryAfter,
  })
  let releasedHead: FlowDocBackendPdfExportLifecycleHeadV1
  if (released.status === "storage-unavailable") {
    const reconciled = await input.lifecycleRepository.readLifecycle({
      ...input.entry.scope,
      operationId: input.entry.operationId,
    })
    if (
      reconciled.status !== "found"
      || reconciled.head.lastRelease?.claimToken !== claimToken
      || (reconciled.head.status !== "pending" && reconciled.head.status !== "stopped")
    ) return result({
      operationId: input.entry.operationId,
      status: "execution-interrupted",
      claimToken,
      attemptNumber: current.head.claim.attemptNumber,
      lifecycleHead: reconciled.status === "found" ? reconciled.head : current.head,
      rendererExecuted: execution?.execution.rendererExecuted ?? false,
      persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
      issues: [issue(
        "pdf-export-local-worker-release-uncertain",
        "release",
        "worker could not prove a durable retry release after an unavailable response",
      )],
    })
    releasedHead = reconciled.head
  } else {
    if (released.status !== "applied" && released.status !== "idempotent-replay") return result({
      operationId: input.entry.operationId,
      status: "ownership-lost",
      claimToken,
      attemptNumber: current.head.claim.attemptNumber,
      lifecycleHead: released.head ?? current.head,
      rendererExecuted: execution?.execution.rendererExecuted ?? false,
      persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
      issues: released.issues,
    })
    releasedHead = released.head
  }
  return result({
    operationId: input.entry.operationId,
    status: releasedHead.status === "stopped" ? "attempts-exhausted" : "released",
    claimToken,
    attemptNumber: current.head.claim.attemptNumber,
    lifecycleHead: releasedHead,
    rendererExecuted: execution?.execution.rendererExecuted ?? false,
    persistenceExecuted: execution?.execution.persistenceExecuted ?? false,
    issues: execution?.issues ?? (executionError == null ? [] : [issue(
      "pdf-export-local-worker-execution-failed",
      "execute",
      "worker execution failed and its claim was released for bounded retry",
    )]),
  })
}

export async function runFlowDocBackendPdfExportLocalDueWorkEntryV1(
  input: FlowDocBackendPdfExportLocalWorkerEntryRunnerInputV1,
): Promise<FlowDocBackendPdfExportLocalWorkerEntryResultV1> {
  const entryIssues = inspectEntry(input.entry)
  if (
    entryIssues.length > 0
    || !isFlowDocBackendPdfExportBoundedStringV1(input.runId)
    || !isFlowDocBackendPdfExportBoundedStringV1(input.workerId)
    || !boundedInteger(input.claimDurationMs, 1_000, FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_MAX_CLAIM_DURATION_MS)
    || !boundedInteger(input.retryDelayMs, 100, 60_000)
  ) return result({
    operationId: input.entry.operationId,
    status: "blocked",
    issues: entryIssues.length > 0 ? entryIssues : [issue(
      "pdf-export-local-worker-input-invalid",
      "worker",
      "local worker requires bounded identity, claim duration, retry delay, and exact due work",
    )],
  })

  const observedAt = readNow(input)
  if (observedAt == null) return result({
    operationId: input.entry.operationId,
    status: "blocked",
    issues: [issue("pdf-export-local-worker-clock-invalid", "now", "worker clock must return an exact ISO time")],
  })
  if (Date.parse(input.entry.dueAt) > Date.parse(observedAt)) return result({
    operationId: input.entry.operationId,
    status: "deferred",
    lifecycleHead: input.entry.head,
  })

  const terminal = await input.observabilityRepository.readTerminalWorkflow({
    ...input.entry.scope,
    operationId: input.entry.operationId,
  })
  if (terminal.status === "found") return result({
    operationId: input.entry.operationId,
    status: "terminal-replay",
    lifecycleHead: input.entry.head,
  })
  if (terminal.status !== "not-found") return result({
    operationId: input.entry.operationId,
    status: "storage-unavailable",
    lifecycleHead: input.entry.head,
    issues: terminal.issues,
  })

  const operationRead = await input.operationRepository.readByOperationId({
    ...input.entry.scope,
    operationId: input.entry.operationId,
  })
  if (operationRead.status !== "found") return result({
    operationId: input.entry.operationId,
    status: operationRead.status === "not-found"
      ? "not-found"
      : operationRead.status === "storage-unavailable"
        ? "storage-unavailable"
        : "blocked",
    lifecycleHead: input.entry.head,
    issues: operationRead.issues,
  })

  const live = await input.lifecycleRepository.readLifecycle({
    ...input.entry.scope,
    operationId: input.entry.operationId,
  })
  if (live.status !== "found") return result({
    operationId: input.entry.operationId,
    status: live.status === "not-found"
      ? "not-found"
      : live.status === "storage-unavailable"
        ? "storage-unavailable"
        : "blocked",
    issues: live.issues,
  })
  let head = live.head
  const claimToken = id("claim", {
    runId: input.runId,
    workerId: input.workerId,
    operationId: input.entry.operationId,
    headRevision: head.headRevision,
    observedAt,
  })
  if (head.status === "stopped") return execute(input, operationRead.operation, head, claimToken)
  if (head.status === "claimed" && Date.parse(head.claim!.expiresAt) > Date.parse(observedAt)) return result({
    operationId: input.entry.operationId,
    status: "ownership-lost",
    lifecycleHead: head,
  })
  if (head.status === "pending" && Date.parse(head.retryAfter ?? head.updatedAt) > Date.parse(observedAt)) return result({
    operationId: input.entry.operationId,
    status: "deferred",
    lifecycleHead: head,
  })

  const claimExpiresAtMs = Math.min(
    Date.parse(observedAt) + input.claimDurationMs,
    Date.parse(head.deadlineAt),
  )
  const transition = Date.parse(observedAt) >= Date.parse(head.deadlineAt)
    ? {
        transitionId: id("deadline", {
          runId: input.runId,
          operationId: input.entry.operationId,
          headRevision: head.headRevision,
        }),
        ...input.entry.scope,
        operationId: input.entry.operationId,
        expectedHeadRevision: head.headRevision,
        transitionAt: observedAt,
        kind: "enforce-deadline" as const,
      }
    : {
        transitionId: id("claim-transition", {
          runId: input.runId,
          operationId: input.entry.operationId,
          headRevision: head.headRevision,
          claimToken,
        }),
        ...input.entry.scope,
        operationId: input.entry.operationId,
        expectedHeadRevision: head.headRevision,
        transitionAt: observedAt,
        kind: "claim" as const,
        claimToken,
        workerId: input.workerId,
        claimExpiresAt: new Date(claimExpiresAtMs).toISOString(),
      }
  let transitioned
  try {
    transitioned = await input.lifecycleRepository.applyLifecycleTransition(transition)
  } catch {
    const reconciled = await input.lifecycleRepository.readLifecycle({
      ...input.entry.scope,
      operationId: input.entry.operationId,
    })
    if (
      reconciled.status === "found"
      && reconciled.head.status === "claimed"
      && reconciled.head.claim?.claimToken === claimToken
    ) head = reconciled.head
    else return result({
      operationId: input.entry.operationId,
      status: "execution-interrupted",
      claimToken,
      lifecycleHead: reconciled.status === "found" ? reconciled.head : head,
      issues: [issue(
        "pdf-export-local-worker-claim-uncertain",
        "claim",
        "worker could not prove ownership after an interrupted claim transition",
      )],
    })
  }
  if (transitioned != null) {
    if (transitioned.status === "storage-unavailable") {
      const reconciled = await input.lifecycleRepository.readLifecycle({
        ...input.entry.scope,
        operationId: input.entry.operationId,
      })
      if (
        reconciled.status === "found"
        && (
          (reconciled.head.status === "claimed" && reconciled.head.claim?.claimToken === claimToken)
          || (transition.kind === "enforce-deadline"
            && reconciled.head.status === "stopped"
            && reconciled.head.stop?.reason === "deadline-exceeded")
        )
      ) head = reconciled.head
      else return result({
        operationId: input.entry.operationId,
        status: "execution-interrupted",
        claimToken,
        lifecycleHead: reconciled.status === "found" ? reconciled.head : head,
        issues: [issue(
          "pdf-export-local-worker-claim-uncertain",
          "claim",
          "worker could not prove ownership after an unavailable claim response",
        )],
      })
    } else {
      if (transitioned.status !== "applied" && transitioned.status !== "idempotent-replay") return result({
        operationId: input.entry.operationId,
        status: "ownership-lost",
        claimToken,
        lifecycleHead: transitioned.head,
        issues: transitioned.issues,
      })
      head = transitioned.head
    }
  }
  if (head.status === "stopped" && head.stop?.reason === "deadline-exceeded") {
    const finalized = await execute(input, operationRead.operation, head, claimToken)
    return finalized.status === "blocked" ? { ...finalized, status: "deadline-stopped" } : finalized
  }
  return execute(input, operationRead.operation, head, claimToken)
}

export type FlowDocBackendPdfExportLocalWorkerWorkflowFactoryV1 = (
  input: FlowDocBackendPdfExportLocalWorkerExecutionInputV1,
) => FlowDocBackendPdfExportWorkflowInputV1
