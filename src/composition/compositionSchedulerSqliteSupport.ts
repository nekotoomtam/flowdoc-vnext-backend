import type { DatabaseSync } from "node:sqlite"

export const FLOWDOC_BACKEND_COMPOSITION_SQLITE_CANDIDATE_SOURCE =
  "flowdoc-backend-composition-sqlite-candidate"
export const FLOWDOC_BACKEND_COMPOSITION_SQLITE_MINIMUM_NODE = "24.15.0"

export type FlowDocBackendCompositionSqliteTransactionKindV1 =
  | "immutable-write"
  | "head-create"
  | "head-cas"
  | "cleanup"

export type FlowDocBackendCompositionSqliteFaultPointV1 =
  | "before-commit"
  | "after-commit"

export interface FlowDocBackendCompositionSqliteFaultContextV1 {
  transactionKind: FlowDocBackendCompositionSqliteTransactionKindV1
  point: FlowDocBackendCompositionSqliteFaultPointV1
}

export interface FlowDocBackendCompositionSqliteCandidateOptionsV1 {
  databasePath: string
  busyTimeoutMs?: number
  faultInjector?: (context: FlowDocBackendCompositionSqliteFaultContextV1) => void
}

function parseNodeVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value)
  return match == null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function versionAtLeast(
  actual: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  for (let index = 0; index < actual.length; index += 1) {
    const current = actual[index] ?? 0
    const required = minimum[index] ?? 0
    if (current > required) return true
    if (current < required) return false
  }
  return true
}

export function supportsFlowDocBackendCompositionSqliteCandidateV1(
  nodeVersion = process.versions.node,
): boolean {
  const actual = parseNodeVersion(nodeVersion)
  const minimum = parseNodeVersion(FLOWDOC_BACKEND_COMPOSITION_SQLITE_MINIMUM_NODE)
  return actual != null && minimum != null && versionAtLeast(actual, minimum)
}

export async function openFlowDocBackendCompositionSqliteDatabaseV1(
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
): Promise<DatabaseSync> {
  if (!supportsFlowDocBackendCompositionSqliteCandidateV1()) {
    throw new Error(
      `composition SQLite candidate requires Node ${FLOWDOC_BACKEND_COMPOSITION_SQLITE_MINIMUM_NODE} or newer`,
    )
  }
  const { DatabaseSync } = await import("node:sqlite")
  const database = new DatabaseSync(options.databasePath, {
    timeout: options.busyTimeoutMs ?? 5_000,
    enableForeignKeyConstraints: true,
    allowExtension: false,
  })
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS composition_immutable_records (
      job_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      record_fingerprint TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      value_json TEXT NOT NULL,
      stored_at TEXT NOT NULL,
      PRIMARY KEY (job_id, record_id),
      UNIQUE (job_id, kind, record_fingerprint)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS composition_immutable_stored_at_idx
      ON composition_immutable_records (job_id, stored_at, record_id);
    CREATE TABLE IF NOT EXISTS composition_physical_usage (
      job_id TEXT PRIMARY KEY,
      record_count INTEGER NOT NULL CHECK (record_count >= 0),
      byte_count INTEGER NOT NULL CHECK (byte_count >= 0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS composition_job_heads (
      job_id TEXT PRIMARY KEY,
      context_json TEXT NOT NULL,
      head_json TEXT NOT NULL,
      head_revision INTEGER NOT NULL CHECK (head_revision >= 0),
      head_fingerprint TEXT NOT NULL,
      create_request_id TEXT NOT NULL,
      create_request_fingerprint TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS composition_committed_requests (
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      receipt_ref_json TEXT NOT NULL,
      head_json TEXT NOT NULL,
      PRIMARY KEY (job_id, request_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS composition_committed_finalizations (
      job_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      page_plan_ref_json TEXT NOT NULL,
      heading_page_map_ref_json TEXT NOT NULL,
      head_json TEXT NOT NULL,
      PRIMARY KEY (job_id, request_id)
    ) STRICT;
  `)
  return database
}

export function runFlowDocBackendCompositionSqliteTransactionV1<T>(
  database: DatabaseSync,
  transactionKind: FlowDocBackendCompositionSqliteTransactionKindV1,
  execute: () => T,
  faultInjector?: (context: FlowDocBackendCompositionSqliteFaultContextV1) => void,
): T {
  database.exec("BEGIN IMMEDIATE")
  try {
    const result = execute()
    faultInjector?.({ transactionKind, point: "before-commit" })
    database.exec("COMMIT")
    faultInjector?.({ transactionKind, point: "after-commit" })
    return result
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK")
    throw error
  }
}
