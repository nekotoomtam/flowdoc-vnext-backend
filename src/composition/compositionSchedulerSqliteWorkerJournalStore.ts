import type { DatabaseSync } from "node:sqlite"
import { compositionIssue } from "./compositionSchedulerContractSupport.js"
import {
  claimFlowDocBackendCompositionWorkerJournalEntryV1,
  completeFlowDocBackendCompositionWorkerJournalEntryV1,
  createFlowDocBackendCompositionWorkerJournalEntryV1,
  isExactFlowDocBackendCompositionWorkerJournalCreationReplayV1,
  parseFlowDocBackendCompositionWorkerJournalEntryV1,
  releaseFlowDocBackendCompositionWorkerJournalEntryV1,
  type FlowDocBackendCompositionWorkerJournalEntryV1,
} from "./compositionSchedulerWorkerJournalContract.js"
import type {
  FlowDocBackendCompositionWorkerJournalClaimResultV1,
  FlowDocBackendCompositionWorkerJournalCompleteResultV1,
  FlowDocBackendCompositionWorkerJournalCreateInputV1,
  FlowDocBackendCompositionWorkerJournalCreateResultV1,
  FlowDocBackendCompositionWorkerJournalReadResultV1,
  FlowDocBackendCompositionWorkerJournalReleaseResultV1,
  FlowDocBackendCompositionWorkerJournalRepositoryV1,
} from "./compositionSchedulerWorkerJournalRepository.js"
import {
  runFlowDocBackendCompositionSqliteTransactionV1,
  type FlowDocBackendCompositionSqliteCandidateOptionsV1,
  type FlowDocBackendCompositionSqliteTransactionKindV1,
} from "./compositionSchedulerSqliteSupport.js"

interface WorkerJournalRow {
  attempt_id: string
  job_id: string
  mutation_fingerprint: string
  journal_revision: number
  status: string
  entry_fingerprint: string
  entry_json: string
}

function readRowByAttemptId(database: DatabaseSync, attemptId: string): WorkerJournalRow | null {
  return database.prepare(`
    SELECT attempt_id, job_id, mutation_fingerprint, journal_revision, status,
      entry_fingerprint, entry_json
    FROM composition_worker_attempts
    WHERE attempt_id = ?
  `).get(attemptId) as WorkerJournalRow | undefined ?? null
}

function readRowByMutationFingerprint(database: DatabaseSync, mutationFingerprint: string): WorkerJournalRow | null {
  return database.prepare(`
    SELECT attempt_id, job_id, mutation_fingerprint, journal_revision, status,
      entry_fingerprint, entry_json
    FROM composition_worker_attempts
    WHERE mutation_fingerprint = ?
  `).get(mutationFingerprint) as WorkerJournalRow | undefined ?? null
}

function invalidRead(message: string): FlowDocBackendCompositionWorkerJournalReadResultV1 {
  return {
    status: "invalid",
    entry: null,
    issues: [compositionIssue("composition-worker-journal-sqlite-row-invalid", "entry", message)],
  }
}

function parseRow(row: WorkerJournalRow): FlowDocBackendCompositionWorkerJournalReadResultV1 {
  try {
    const parsed = parseFlowDocBackendCompositionWorkerJournalEntryV1(JSON.parse(row.entry_json))
    if (parsed.status === "blocked") return invalidRead("SQLite journal JSON must satisfy the canonical entry contract")
    const entry = parsed.entry
    if (
      row.attempt_id !== entry.attemptId
      || row.job_id !== entry.jobId
      || row.mutation_fingerprint !== entry.mutationFingerprint
      || row.journal_revision !== entry.journalRevision
      || row.status !== entry.status
      || row.entry_fingerprint !== entry.fingerprint
    ) return invalidRead("SQLite journal index columns must match canonical entry JSON")
    return { status: "found", entry, issues: [] }
  } catch {
    return invalidRead("SQLite journal entry JSON must be parseable")
  }
}

function conflict(message: string): FlowDocBackendCompositionWorkerJournalCreateResultV1 {
  return {
    status: "conflict",
    entry: null,
    issues: [compositionIssue("composition-worker-journal-conflict", "attemptId", message)],
  }
}

function writeNew(database: DatabaseSync, entry: FlowDocBackendCompositionWorkerJournalEntryV1): void {
  database.prepare(`
    INSERT INTO composition_worker_attempts (
      attempt_id, job_id, mutation_fingerprint, journal_revision, status,
      entry_fingerprint, entry_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.attemptId,
    entry.jobId,
    entry.mutationFingerprint,
    entry.journalRevision,
    entry.status,
    entry.fingerprint,
    JSON.stringify(entry),
  )
}

function replaceExact(
  database: DatabaseSync,
  before: FlowDocBackendCompositionWorkerJournalEntryV1,
  after: FlowDocBackendCompositionWorkerJournalEntryV1,
): void {
  const result = database.prepare(`
    UPDATE composition_worker_attempts
    SET journal_revision = ?, status = ?, entry_fingerprint = ?, entry_json = ?
    WHERE attempt_id = ? AND journal_revision = ? AND entry_fingerprint = ?
  `).run(
    after.journalRevision,
    after.status,
    after.fingerprint,
    JSON.stringify(after),
    before.attemptId,
    before.journalRevision,
    before.fingerprint,
  )
  if (result.changes !== 1) throw new Error("SQLite worker journal compare-and-swap lost its locked row")
}

function transactionalTransition<T>(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  transactionKind: FlowDocBackendCompositionSqliteTransactionKindV1,
  attemptId: string,
  transition: (entry: FlowDocBackendCompositionWorkerJournalEntryV1) => T,
  changed: (result: T) => FlowDocBackendCompositionWorkerJournalEntryV1 | null,
  notFound: T,
  storageInvalid: (issues: FlowDocBackendCompositionWorkerJournalReadResultV1["issues"]) => T,
): T {
  return runFlowDocBackendCompositionSqliteTransactionV1(database, transactionKind, () => {
    const row = readRowByAttemptId(database, attemptId)
    if (row == null) return notFound
    const parsed = parseRow(row)
    if (parsed.status !== "found") return storageInvalid(parsed.issues)
    const result = transition(parsed.entry)
    const next = changed(result)
    if (next != null) replaceExact(database, parsed.entry, next)
    return result
  }, options.faultInjector)
}

export function createFlowDocBackendCompositionSqliteWorkerAttemptV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: FlowDocBackendCompositionWorkerJournalCreateInputV1,
): FlowDocBackendCompositionWorkerJournalCreateResultV1 {
  const created = createFlowDocBackendCompositionWorkerJournalEntryV1(input)
  if (created.status === "blocked") return { status: "invalid", entry: null, issues: created.issues }
  return runFlowDocBackendCompositionSqliteTransactionV1(database, "worker-journal-create", () => {
    const existingRow = readRowByAttemptId(database, created.entry.attemptId)
    if (existingRow != null) {
      const existing = parseRow(existingRow)
      if (existing.status !== "found") return { status: "invalid", entry: null, issues: existing.issues }
      return isExactFlowDocBackendCompositionWorkerJournalCreationReplayV1(existing.entry, created.entry)
        ? { status: "idempotent-replay", entry: existing.entry, issues: [] }
        : conflict("attempt id already owns different journal facts")
    }
    if (readRowByMutationFingerprint(database, created.entry.mutationFingerprint) != null) {
      return conflict("worker mutation already belongs to another attempt id")
    }
    writeNew(database, created.entry)
    return { status: "created", entry: created.entry, issues: [] }
  }, options.faultInjector)
}

export function readFlowDocBackendCompositionSqliteWorkerAttemptV1(
  database: DatabaseSync,
  attemptId: string,
): FlowDocBackendCompositionWorkerJournalReadResultV1 {
  if (typeof attemptId !== "string" || attemptId.length === 0 || attemptId.length > 512) {
    return invalidRead("attempt id must be valid")
  }
  const row = readRowByAttemptId(database, attemptId)
  return row == null ? { status: "not-found", entry: null, issues: [] } : parseRow(row)
}

export function claimFlowDocBackendCompositionSqliteWorkerAttemptV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: Parameters<FlowDocBackendCompositionWorkerJournalRepositoryV1["claimWorkerAttempt"]>[0],
): FlowDocBackendCompositionWorkerJournalClaimResultV1 {
  return transactionalTransition<FlowDocBackendCompositionWorkerJournalClaimResultV1>(
    database,
    options,
    "worker-journal-claim",
    input.attemptId,
    (entry) => claimFlowDocBackendCompositionWorkerJournalEntryV1({ entry, ...input }),
    (result) => result.status === "claimed" || result.status === "reclaimed" ? result.entry : null,
    { status: "not-found", entry: null, issues: [] },
    (issues) => ({ status: "storage-invalid", entry: null, issues }),
  )
}

export function releaseFlowDocBackendCompositionSqliteWorkerAttemptV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: Parameters<FlowDocBackendCompositionWorkerJournalRepositoryV1["releaseWorkerAttempt"]>[0],
): FlowDocBackendCompositionWorkerJournalReleaseResultV1 {
  return transactionalTransition<FlowDocBackendCompositionWorkerJournalReleaseResultV1>(
    database,
    options,
    "worker-journal-release",
    input.attemptId,
    (entry) => releaseFlowDocBackendCompositionWorkerJournalEntryV1({ entry, ...input }),
    (result) => result.status === "released" ? result.entry : null,
    { status: "not-found", entry: null, issues: [] },
    (issues) => ({ status: "storage-invalid", entry: null, issues }),
  )
}

export function completeFlowDocBackendCompositionSqliteWorkerAttemptV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: Parameters<FlowDocBackendCompositionWorkerJournalRepositoryV1["completeWorkerAttempt"]>[0],
): FlowDocBackendCompositionWorkerJournalCompleteResultV1 {
  return transactionalTransition<FlowDocBackendCompositionWorkerJournalCompleteResultV1>(
    database,
    options,
    "worker-journal-complete",
    input.attemptId,
    (entry) => completeFlowDocBackendCompositionWorkerJournalEntryV1({ entry, ...input }),
    (result) => result.status === "completed" ? result.entry : null,
    { status: "not-found", entry: null, issues: [] },
    (issues) => ({ status: "storage-invalid", entry: null, issues }),
  )
}
