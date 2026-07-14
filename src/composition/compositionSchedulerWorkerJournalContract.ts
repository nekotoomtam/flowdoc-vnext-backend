import {
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  exactCompositionValue,
  readCompositionRecord,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  inspectFlowDocBackendCompositionWorkerStorageAttemptV1,
  type FlowDocBackendCompositionWorkerHeadMutationV1,
  type FlowDocBackendCompositionWorkerStorageAttemptStateV1,
} from "./compositionSchedulerWorkerAttempt.js"

export const FLOWDOC_BACKEND_COMPOSITION_WORKER_JOURNAL_V1_SOURCE =
  "flowdoc-backend-composition-worker-journal"
export const FLOWDOC_BACKEND_COMPOSITION_MAX_WORKER_CLAIM_DURATION_MS = 300_000

export interface FlowDocBackendCompositionWorkerJournalClaimV1 {
  claimToken: string
  workerId: string
  claimedAt: string
  expiresAt: string
}

export type FlowDocBackendCompositionWorkerJournalTerminalStatusV1 =
  | "committed"
  | "superseded"
  | "conflict"
  | "exhausted"
  | "failed"
  | "reconciliation-exhausted"

export interface FlowDocBackendCompositionWorkerJournalTerminalV1 {
  status: FlowDocBackendCompositionWorkerJournalTerminalStatusV1
  resultFingerprint: string
  claimToken: string
  workerId: string
  completedAt: string
}

export interface FlowDocBackendCompositionWorkerJournalReleaseReceiptV1 {
  claimToken: string
  workerId: string
  releasedFromJournalRevision: number
  releasedAt: string
  stateFingerprint: string
}

export interface FlowDocBackendCompositionWorkerJournalEntryV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_WORKER_JOURNAL_V1_SOURCE
  schemaVersion: 1
  kind: "composition-worker-journal-entry"
  attemptId: string
  createRequestId: string
  createRequestFingerprint: string
  jobId: string
  mutationFingerprint: string
  initialStateFingerprint: string
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1
  state: FlowDocBackendCompositionWorkerStorageAttemptStateV1
  journalRevision: number
  status: "pending" | "claimed" | "completed"
  claim: FlowDocBackendCompositionWorkerJournalClaimV1 | null
  lastRelease: FlowDocBackendCompositionWorkerJournalReleaseReceiptV1 | null
  terminal: FlowDocBackendCompositionWorkerJournalTerminalV1 | null
  createdAt: string
  updatedAt: string
  fingerprint: string
}

type EntryFacts = Omit<FlowDocBackendCompositionWorkerJournalEntryV1, "fingerprint">

export type FlowDocBackendCompositionWorkerJournalEntryResultV1 =
  | { status: "ready"; entry: FlowDocBackendCompositionWorkerJournalEntryV1; issues: [] }
  | { status: "blocked"; entry: null; issues: FlowDocBackendCompositionContractIssue[] }

export type FlowDocBackendCompositionWorkerJournalClaimTransitionResultV1 =
  | {
      status: "claimed" | "reclaimed" | "idempotent-replay"
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: []
    }
  | {
      status: "deferred" | "busy" | "stale" | "terminal" | "invalid"
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionWorkerJournalReleaseTransitionResultV1 =
  | {
      status: "released" | "idempotent-replay"
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: []
    }
  | {
      status: "stale" | "terminal" | "invalid"
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionWorkerJournalCompleteTransitionResultV1 =
  | {
      status: "completed" | "idempotent-replay"
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: []
    }
  | {
      status: "stale" | "invalid"
      entry: FlowDocBackendCompositionWorkerJournalEntryV1
      issues: FlowDocBackendCompositionContractIssue[]
    }

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u
const terminalStatuses = new Set<FlowDocBackendCompositionWorkerJournalTerminalStatusV1>([
  "committed",
  "superseded",
  "conflict",
  "exhausted",
  "failed",
  "reconciliation-exhausted",
])

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function issue(message: string, path = "entry"): FlowDocBackendCompositionContractIssue[] {
  return [compositionIssue("composition-worker-journal-invalid", path, message)]
}

function parseClaim(value: unknown): FlowDocBackendCompositionWorkerJournalClaimV1 | null {
  if (value == null) return null
  if (typeof value !== "object" || Array.isArray(value)) return null
  const claim = value as Record<string, unknown>
  if (
    Object.keys(claim).sort().join("|") !== "claimToken|claimedAt|expiresAt|workerId"
    || !validId(claim.claimToken)
    || !validId(claim.workerId)
    || !exactIso(claim.claimedAt)
    || !exactIso(claim.expiresAt)
    || Date.parse(claim.expiresAt) <= Date.parse(claim.claimedAt)
    || Date.parse(claim.expiresAt) - Date.parse(claim.claimedAt) > FLOWDOC_BACKEND_COMPOSITION_MAX_WORKER_CLAIM_DURATION_MS
  ) return null
  return {
    claimToken: claim.claimToken,
    workerId: claim.workerId,
    claimedAt: claim.claimedAt,
    expiresAt: claim.expiresAt,
  }
}

function parseTerminal(value: unknown): FlowDocBackendCompositionWorkerJournalTerminalV1 | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null
  const terminal = value as Record<string, unknown>
  if (
    Object.keys(terminal).sort().join("|") !== "claimToken|completedAt|resultFingerprint|status|workerId"
    || typeof terminal.status !== "string"
    || !terminalStatuses.has(terminal.status as FlowDocBackendCompositionWorkerJournalTerminalStatusV1)
    || typeof terminal.resultFingerprint !== "string"
    || !FINGERPRINT.test(terminal.resultFingerprint)
    || !validId(terminal.claimToken)
    || !validId(terminal.workerId)
    || !exactIso(terminal.completedAt)
  ) return null
  return {
    status: terminal.status as FlowDocBackendCompositionWorkerJournalTerminalStatusV1,
    resultFingerprint: terminal.resultFingerprint,
    claimToken: terminal.claimToken,
    workerId: terminal.workerId,
    completedAt: terminal.completedAt,
  }
}

function parseReleaseReceipt(value: unknown): FlowDocBackendCompositionWorkerJournalReleaseReceiptV1 | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null
  const receipt = value as Record<string, unknown>
  if (
    Object.keys(receipt).sort().join("|")
      !== "claimToken|releasedAt|releasedFromJournalRevision|stateFingerprint|workerId"
    || !validId(receipt.claimToken)
    || !validId(receipt.workerId)
    || !Number.isInteger(receipt.releasedFromJournalRevision)
    || (receipt.releasedFromJournalRevision as number) < 0
    || !exactIso(receipt.releasedAt)
    || typeof receipt.stateFingerprint !== "string"
    || !FINGERPRINT.test(receipt.stateFingerprint)
  ) return null
  return {
    claimToken: receipt.claimToken,
    workerId: receipt.workerId,
    releasedFromJournalRevision: receipt.releasedFromJournalRevision as number,
    releasedAt: receipt.releasedAt,
    stateFingerprint: receipt.stateFingerprint,
  }
}

function validateEntryFacts(facts: EntryFacts): FlowDocBackendCompositionContractIssue[] {
  let inspection
  try {
    inspection = inspectFlowDocBackendCompositionWorkerStorageAttemptV1({
      mutation: facts.mutation,
      state: facts.state,
    })
  } catch {
    return issue("journal mutation and state must be valid worker storage-attempt values", "state")
  }
  const claim = parseClaim(facts.claim)
  const lastRelease = parseReleaseReceipt(facts.lastRelease)
  const terminal = parseTerminal(facts.terminal)
  if (
    facts.source !== FLOWDOC_BACKEND_COMPOSITION_WORKER_JOURNAL_V1_SOURCE
    || facts.schemaVersion !== 1
    || facts.kind !== "composition-worker-journal-entry"
    || !validId(facts.attemptId)
    || !validId(facts.createRequestId)
    || !FINGERPRINT.test(facts.createRequestFingerprint)
    || inspection.status !== "ready"
    || facts.jobId !== inspection.jobId
    || facts.mutationFingerprint !== inspection.mutationFingerprint
    || !FINGERPRINT.test(facts.initialStateFingerprint)
    || !Number.isInteger(facts.journalRevision)
    || facts.journalRevision < 0
    || !["pending", "claimed", "completed"].includes(facts.status)
    || !exactIso(facts.createdAt)
    || !exactIso(facts.updatedAt)
    || Date.parse(facts.updatedAt) < Date.parse(facts.createdAt)
  ) return issue("journal identity, state binding, revision, status, and times must be valid")
  if (facts.status === "pending" && (facts.claim != null || facts.terminal != null)) {
    return issue("pending journal entry cannot retain a claim or terminal outcome", "status")
  }
  if (facts.status === "pending" && facts.lastRelease != null && lastRelease == null) {
    return issue("pending journal release receipt must be valid", "lastRelease")
  }
  if (facts.status === "claimed" && (claim == null || facts.lastRelease != null || facts.terminal != null)) {
    return issue("claimed journal entry requires one valid claim and no terminal outcome", "claim")
  }
  if (facts.status === "completed" && (facts.claim != null || facts.lastRelease != null || terminal == null)) {
    return issue("completed journal entry requires one terminal outcome and no active claim", "terminal")
  }
  if (claim != null && Date.parse(claim.claimedAt) < Date.parse(facts.createdAt)) {
    return issue("claim cannot precede journal creation", "claim.claimedAt")
  }
  if (claim != null && claim.claimedAt !== facts.updatedAt) {
    return issue("active claim time must match the journal update time", "claim.claimedAt")
  }
  if (terminal != null && Date.parse(terminal.completedAt) < Date.parse(facts.createdAt)) {
    return issue("terminal completion cannot precede journal creation", "terminal.completedAt")
  }
  if (terminal != null && terminal.completedAt !== facts.updatedAt) {
    return issue("terminal completion time must match the journal update time", "terminal.completedAt")
  }
  if (lastRelease != null && (
    lastRelease.releasedAt !== facts.updatedAt
    || lastRelease.stateFingerprint !== facts.state.fingerprint
    || lastRelease.releasedFromJournalRevision + 1 !== facts.journalRevision
  )) return issue("release receipt must own the exact pending revision, state, and update time", "lastRelease")
  return []
}

function finalizeFacts(facts: EntryFacts): FlowDocBackendCompositionWorkerJournalEntryResultV1 {
  const issues = validateEntryFacts(facts)
  if (issues.length > 0) return { status: "blocked", entry: null, issues }
  return {
    status: "ready",
    entry: { ...cloneCompositionJson(facts), fingerprint: compositionFingerprint(facts) },
    issues: [],
  }
}

export function createFlowDocBackendCompositionWorkerJournalEntryV1(input: {
  attemptId: string
  createRequestId: string
  createRequestFingerprint: string
  mutation: FlowDocBackendCompositionWorkerHeadMutationV1
  state: FlowDocBackendCompositionWorkerStorageAttemptStateV1
  createdAt: string
}): FlowDocBackendCompositionWorkerJournalEntryResultV1 {
  let inspection
  try {
    inspection = inspectFlowDocBackendCompositionWorkerStorageAttemptV1({
      mutation: input.mutation,
      state: input.state,
    })
  } catch {
    return { status: "blocked", entry: null, issues: issue("journal mutation and state are invalid", "state") }
  }
  if (inspection.status === "blocked") return { status: "blocked", entry: null, issues: inspection.issues }
  return finalizeFacts({
    source: FLOWDOC_BACKEND_COMPOSITION_WORKER_JOURNAL_V1_SOURCE,
    schemaVersion: 1,
    kind: "composition-worker-journal-entry",
    attemptId: input.attemptId,
    createRequestId: input.createRequestId,
    createRequestFingerprint: input.createRequestFingerprint,
    jobId: inspection.jobId,
    mutationFingerprint: inspection.mutationFingerprint,
    initialStateFingerprint: input.state.fingerprint,
    mutation: cloneCompositionJson(input.mutation),
    state: cloneCompositionJson(input.state),
    journalRevision: 0,
    status: "pending",
    claim: null,
    lastRelease: null,
    terminal: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
}

export function parseFlowDocBackendCompositionWorkerJournalEntryV1(
  value: unknown,
): FlowDocBackendCompositionWorkerJournalEntryResultV1 {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const record = readCompositionRecord(value, "", [
    "source",
    "schemaVersion",
    "kind",
    "attemptId",
    "createRequestId",
    "createRequestFingerprint",
    "jobId",
    "mutationFingerprint",
    "initialStateFingerprint",
    "mutation",
    "state",
    "journalRevision",
    "status",
    "claim",
    "lastRelease",
    "terminal",
    "createdAt",
    "updatedAt",
    "fingerprint",
  ], issues)
  if (record == null || issues.length > 0) return { status: "blocked", entry: null, issues }
  const { fingerprint, ...facts } = record
  const finalized = finalizeFacts(facts as unknown as EntryFacts)
  if (finalized.status === "blocked") return finalized
  if (fingerprint !== finalized.entry.fingerprint) return {
    status: "blocked",
    entry: null,
    issues: issue("journal fingerprint must match the exact canonical entry facts", "fingerprint"),
  }
  return finalized
}

export function isExactFlowDocBackendCompositionWorkerJournalCreationReplayV1(
  current: FlowDocBackendCompositionWorkerJournalEntryV1,
  initial: FlowDocBackendCompositionWorkerJournalEntryV1,
): boolean {
  return current.attemptId === initial.attemptId
    && current.createRequestId === initial.createRequestId
    && current.createRequestFingerprint === initial.createRequestFingerprint
    && current.jobId === initial.jobId
    && current.mutationFingerprint === initial.mutationFingerprint
    && current.initialStateFingerprint === initial.initialStateFingerprint
    && current.createdAt === initial.createdAt
}

function nextEntry(
  entry: FlowDocBackendCompositionWorkerJournalEntryV1,
  changes: Partial<EntryFacts>,
): FlowDocBackendCompositionWorkerJournalEntryResultV1 {
  const { fingerprint: _fingerprint, ...facts } = entry
  return finalizeFacts({ ...facts, ...cloneCompositionJson(changes) })
}

function claimInputValid(input: {
  expectedJournalRevision: number
  claimToken: string
  workerId: string
  claimedAt: string
  expiresAt: string
}): boolean {
  return Number.isInteger(input.expectedJournalRevision)
    && input.expectedJournalRevision >= 0
    && parseClaim({
      claimToken: input.claimToken,
      workerId: input.workerId,
      claimedAt: input.claimedAt,
      expiresAt: input.expiresAt,
    }) != null
}

export function claimFlowDocBackendCompositionWorkerJournalEntryV1(input: {
  entry: FlowDocBackendCompositionWorkerJournalEntryV1
  expectedJournalRevision: number
  claimToken: string
  workerId: string
  claimedAt: string
  expiresAt: string
}): FlowDocBackendCompositionWorkerJournalClaimTransitionResultV1 {
  const current = cloneCompositionJson(input.entry)
  if (!claimInputValid(input) || Date.parse(input.claimedAt) < Date.parse(current.updatedAt)) return {
    status: "invalid",
    entry: current,
    issues: issue("claim identity, revision, and bounded claim window must be valid", "claim"),
  }
  const requested: FlowDocBackendCompositionWorkerJournalClaimV1 = {
    claimToken: input.claimToken,
    workerId: input.workerId,
    claimedAt: input.claimedAt,
    expiresAt: input.expiresAt,
  }
  if (current.status === "completed") return {
    status: "terminal",
    entry: current,
    issues: issue("completed journal entry cannot be claimed", "status"),
  }
  if (current.status === "claimed" && exactCompositionValue(current.claim, requested)) {
    return { status: "idempotent-replay", entry: current, issues: [] }
  }
  if (current.status === "claimed" && current.claim != null && Date.parse(input.claimedAt) < Date.parse(current.claim.expiresAt)) {
    return {
      status: "busy",
      entry: current,
      issues: issue("journal entry already has an active claim", "claim"),
    }
  }
  if (current.journalRevision !== input.expectedJournalRevision) return {
    status: "stale",
    entry: current,
    issues: issue("journal revision changed before claim", "expectedJournalRevision"),
  }
  const inspection = inspectFlowDocBackendCompositionWorkerStorageAttemptV1({
    mutation: current.mutation,
    state: current.state,
  })
  if (inspection.status === "blocked") return { status: "invalid", entry: current, issues: inspection.issues }
  if (Date.parse(input.claimedAt) < Date.parse(inspection.notBefore)) return {
    status: "deferred",
    entry: current,
    issues: issue("journal entry cannot be claimed before its exact state schedule", "claimedAt"),
  }
  const reclaimed = current.status === "claimed"
  const next = nextEntry(current, {
    journalRevision: current.journalRevision + 1,
    status: "claimed",
    claim: requested,
    lastRelease: null,
    terminal: null,
    updatedAt: input.claimedAt,
  })
  return next.status === "ready"
    ? { status: reclaimed ? "reclaimed" : "claimed", entry: next.entry, issues: [] }
    : { status: "invalid", entry: current, issues: next.issues }
}

function exactStateTransition(
  current: FlowDocBackendCompositionWorkerStorageAttemptStateV1,
  next: FlowDocBackendCompositionWorkerStorageAttemptStateV1,
): boolean {
  if (current.mutationFingerprint !== next.mutationFingerprint) return false
  if (current.phase === "reconcile" && next.phase === "reconcile") return (
    next.completedWriteAttemptCount === current.completedWriteAttemptCount
    && next.reconciliationFailureCount === current.reconciliationFailureCount + 1
    && next.unavailableAt === current.unavailableAt
    && exactCompositionValue(next.availability, current.availability)
  )
  if (current.phase === "reconcile" && next.phase === "retry-ready") return (
    next.completedWriteAttemptCount === current.completedWriteAttemptCount
    && next.reconciliationFailureCount === current.reconciliationFailureCount
    && next.unavailableAt === current.unavailableAt
    && next.nextWriteAttemptNumber === current.completedWriteAttemptCount + 1
    && exactCompositionValue(next.availability, current.availability)
  )
  return current.phase === "retry-ready" && next.phase === "reconcile"
    && next.completedWriteAttemptCount === current.nextWriteAttemptNumber
    && next.reconciliationFailureCount === 0
    && Date.parse(next.unavailableAt) >= Date.parse(current.retryNotBefore)
}

export function releaseFlowDocBackendCompositionWorkerJournalEntryV1(input: {
  entry: FlowDocBackendCompositionWorkerJournalEntryV1
  expectedJournalRevision: number
  claimToken: string
  releasedAt: string
  nextState: FlowDocBackendCompositionWorkerStorageAttemptStateV1
}): FlowDocBackendCompositionWorkerJournalReleaseTransitionResultV1 {
  const current = cloneCompositionJson(input.entry)
  if (
    !Number.isInteger(input.expectedJournalRevision)
    || input.expectedJournalRevision < 0
    || !validId(input.claimToken)
    || !exactIso(input.releasedAt)
  ) return {
    status: "invalid",
    entry: current,
    issues: issue("release identity, revision, and time must be valid", "claim"),
  }
  let nextInspection
  try {
    nextInspection = inspectFlowDocBackendCompositionWorkerStorageAttemptV1({
      mutation: current.mutation,
      state: input.nextState,
    })
  } catch {
    nextInspection = { status: "blocked" as const, issues: issue("next state is invalid", "nextState") }
  }
  if (nextInspection.status === "blocked") return {
    status: "invalid",
    entry: current,
    issues: nextInspection.issues,
  }
  if (
    current.status === "pending"
    && current.lastRelease?.claimToken === input.claimToken
    && current.lastRelease.releasedFromJournalRevision === input.expectedJournalRevision
    && current.lastRelease.releasedAt === input.releasedAt
    && current.lastRelease.stateFingerprint === input.nextState.fingerprint
  ) {
    return { status: "idempotent-replay", entry: current, issues: [] }
  }
  if (current.status === "completed") return {
    status: "terminal",
    entry: current,
    issues: issue("completed journal entry cannot return to pending", "status"),
  }
  if (!exactStateTransition(current.state, input.nextState)) return {
    status: "invalid",
    entry: current,
    issues: issue("release transition is invalid", "nextState"),
  }
  if (
    current.status !== "claimed"
    || current.claim == null
    || current.journalRevision !== input.expectedJournalRevision
    || current.claim.claimToken !== input.claimToken
    || Date.parse(input.releasedAt) < Date.parse(current.claim.claimedAt)
    || Date.parse(input.releasedAt) >= Date.parse(current.claim.expiresAt)
  ) return {
    status: "stale",
    entry: current,
    issues: issue("release requires the exact active claim revision and token", "claim"),
  }
  const next = nextEntry(current, {
    state: input.nextState,
    journalRevision: current.journalRevision + 1,
    status: "pending",
    claim: null,
    lastRelease: {
      claimToken: current.claim.claimToken,
      workerId: current.claim.workerId,
      releasedFromJournalRevision: current.journalRevision,
      releasedAt: input.releasedAt,
      stateFingerprint: input.nextState.fingerprint,
    },
    terminal: null,
    updatedAt: input.releasedAt,
  })
  return next.status === "ready"
    ? { status: "released", entry: next.entry, issues: [] }
    : { status: "invalid", entry: current, issues: next.issues }
}

export function completeFlowDocBackendCompositionWorkerJournalEntryV1(input: {
  entry: FlowDocBackendCompositionWorkerJournalEntryV1
  expectedJournalRevision: number
  claimToken: string
  completedAt: string
  terminalStatus: FlowDocBackendCompositionWorkerJournalTerminalStatusV1
  resultFingerprint: string
}): FlowDocBackendCompositionWorkerJournalCompleteTransitionResultV1 {
  const current = cloneCompositionJson(input.entry)
  if (
    !Number.isInteger(input.expectedJournalRevision)
    || input.expectedJournalRevision < 0
    || !validId(input.claimToken)
    || !exactIso(input.completedAt)
    || !terminalStatuses.has(input.terminalStatus)
    || !FINGERPRINT.test(input.resultFingerprint)
  ) return { status: "invalid", entry: current, issues: issue("terminal completion input is invalid", "terminal") }
  if (current.status === "completed" && current.terminal != null) {
    return current.terminal.status === input.terminalStatus
      && current.terminal.resultFingerprint === input.resultFingerprint
      && current.terminal.claimToken === input.claimToken
      ? { status: "idempotent-replay", entry: current, issues: [] }
      : { status: "stale", entry: current, issues: issue("terminal outcome already differs", "terminal") }
  }
  if (
    current.status !== "claimed"
    || current.claim == null
    || current.journalRevision !== input.expectedJournalRevision
    || current.claim.claimToken !== input.claimToken
    || Date.parse(input.completedAt) < Date.parse(current.claim.claimedAt)
    || Date.parse(input.completedAt) >= Date.parse(current.claim.expiresAt)
  ) return {
    status: "stale",
    entry: current,
    issues: issue("completion requires the exact active claim revision and token", "claim"),
  }
  const terminal: FlowDocBackendCompositionWorkerJournalTerminalV1 = {
    status: input.terminalStatus,
    resultFingerprint: input.resultFingerprint,
    claimToken: current.claim.claimToken,
    workerId: current.claim.workerId,
    completedAt: input.completedAt,
  }
  const next = nextEntry(current, {
    journalRevision: current.journalRevision + 1,
    status: "completed",
    claim: null,
    lastRelease: null,
    terminal,
    updatedAt: input.completedAt,
  })
  return next.status === "ready"
    ? { status: "completed", entry: next.entry, issues: [] }
    : { status: "invalid", entry: current, issues: next.issues }
}
