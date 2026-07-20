import type { DatabaseSync } from "node:sqlite"
import {
  parseFlowDocBackendDocGenLocalProtectedAdmissionRecordV1,
  type FlowDocBackendDocGenLocalAdmissionRepositoryV1,
  type FlowDocBackendDocGenLocalProtectedAdmissionRecordV1,
} from "./docGenLocalAdmission.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_SQLITE_V1_SOURCE =
  "flowdoc-backend-docgen-local-admission-sqlite" as const
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_SQLITE_MINIMUM_NODE = "24.15.0"

export type FlowDocBackendDocGenLocalAdmissionSqliteFaultPointV1 = "before-commit" | "after-commit"

export interface FlowDocBackendDocGenLocalAdmissionSqliteFaultContextV1 {
  transactionKind: "protected-admission-insert"
  point: FlowDocBackendDocGenLocalAdmissionSqliteFaultPointV1
  admissionId: string
  instanceId: string
}

export interface FlowDocBackendDocGenLocalAdmissionSqliteOptionsV1 {
  databasePath: string
  busyTimeoutMs?: number
  faultInjector?: (context: FlowDocBackendDocGenLocalAdmissionSqliteFaultContextV1) => void
}

export interface FlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1
  extends FlowDocBackendDocGenLocalAdmissionRepositoryV1 {
  sqliteSource: typeof FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_SQLITE_V1_SOURCE
  databasePath: string
  close(): void
}

interface StoredAdmissionRow {
  admission_id: string
  tenant_id: string
  principal_id: string
  caller_key: string
  request_fingerprint: string
  instance_id: string
  receipt_fingerprint: string
  canonical_input_fingerprint: string
  canonical_content_fingerprint: string
  record_fingerprint: string
  accepted_at: string
  record_json: string
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

export function supportsFlowDocBackendDocGenLocalAdmissionSqliteV1(
  nodeVersion = process.versions.node,
): boolean {
  const actual = parseNodeVersion(nodeVersion)
  const minimum = parseNodeVersion(FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_SQLITE_MINIMUM_NODE)
  return actual != null && minimum != null && versionAtLeast(actual, minimum)
}

function parseStoredRow(row: StoredAdmissionRow): FlowDocBackendDocGenLocalProtectedAdmissionRecordV1 {
  let value: unknown
  try {
    value = JSON.parse(row.record_json) as unknown
  } catch {
    throw new Error("stored protected DocGen admission JSON is invalid")
  }
  const record = parseFlowDocBackendDocGenLocalProtectedAdmissionRecordV1(value)
  if (
    record.admissionId !== row.admission_id
    || record.scope.tenantId !== row.tenant_id
    || record.scope.principalId !== row.principal_id
    || record.idempotency.callerKey !== row.caller_key
    || record.idempotency.requestFingerprint !== row.request_fingerprint
    || record.receipt.instance.instanceId !== row.instance_id
    || record.receipt.receiptFingerprint !== row.receipt_fingerprint
    || record.receipt.canonicalInputFingerprint !== row.canonical_input_fingerprint
    || record.receipt.canonicalContentFingerprint !== row.canonical_content_fingerprint
    || record.recordFingerprint !== row.record_fingerprint
    || record.acceptedAt !== row.accepted_at
  ) throw new Error("stored protected DocGen admission columns do not match the record")
  return record
}

const SELECT_COLUMNS = `
  admission_id, tenant_id, principal_id, caller_key, request_fingerprint,
  instance_id, receipt_fingerprint, canonical_input_fingerprint,
  canonical_content_fingerprint, record_fingerprint, accepted_at, record_json
`

function rowByIdempotency(
  database: DatabaseSync,
  input: { tenantId: string; principalId: string; callerKey: string },
): StoredAdmissionRow | undefined {
  return database.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM docgen_local_admissions
    WHERE tenant_id = ? AND principal_id = ? AND caller_key = ?
  `).get(input.tenantId, input.principalId, input.callerKey) as StoredAdmissionRow | undefined
}

function rowByAdmissionId(database: DatabaseSync, admissionId: string): StoredAdmissionRow | undefined {
  return database.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM docgen_local_admissions
    WHERE admission_id = ?
  `).get(admissionId) as StoredAdmissionRow | undefined
}

function rowByInstanceId(database: DatabaseSync, instanceId: string): StoredAdmissionRow | undefined {
  return database.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM docgen_local_admissions
    WHERE instance_id = ?
  `).get(instanceId) as StoredAdmissionRow | undefined
}

async function openDatabase(
  options: FlowDocBackendDocGenLocalAdmissionSqliteOptionsV1,
): Promise<DatabaseSync> {
  if (!supportsFlowDocBackendDocGenLocalAdmissionSqliteV1()) {
    throw new Error(
      `DocGen admission SQLite requires Node ${FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_SQLITE_MINIMUM_NODE} or newer`,
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
    CREATE TABLE IF NOT EXISTS docgen_local_admissions (
      admission_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      caller_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      instance_id TEXT NOT NULL UNIQUE,
      receipt_fingerprint TEXT NOT NULL,
      canonical_input_fingerprint TEXT NOT NULL,
      canonical_content_fingerprint TEXT NOT NULL,
      record_fingerprint TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      record_json TEXT NOT NULL,
      UNIQUE (tenant_id, principal_id, caller_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS docgen_local_admissions_scope_instance_idx
      ON docgen_local_admissions (tenant_id, principal_id, instance_id);
  `)
  return database
}

function createRepository(
  database: DatabaseSync,
  options: FlowDocBackendDocGenLocalAdmissionSqliteOptionsV1,
): FlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1 {
  return {
    sqliteSource: FLOWDOC_BACKEND_DOCGEN_LOCAL_ADMISSION_SQLITE_V1_SOURCE,
    databasePath: options.databasePath,
    storage: {
      kind: "sqlite",
      durablePersistence: true,
      processRestartReplay: true,
      productionBinding: false,
    },

    async readByIdempotency(input) {
      const row = rowByIdempotency(database, input)
      return row == null ? null : parseStoredRow(row)
    },

    async insert(value) {
      const record = parseFlowDocBackendDocGenLocalProtectedAdmissionRecordV1(value)
      try {
        database.exec("BEGIN IMMEDIATE")
        const existing = rowByIdempotency(database, {
          tenantId: record.scope.tenantId,
          principalId: record.scope.principalId,
          callerKey: record.idempotency.callerKey,
        }) ?? rowByAdmissionId(database, record.admissionId)
          ?? rowByInstanceId(database, record.receipt.instance.instanceId)
        if (existing != null) {
          database.exec("COMMIT")
          return "already-exists"
        }
        database.prepare(`
          INSERT INTO docgen_local_admissions (
            admission_id, tenant_id, principal_id, caller_key, request_fingerprint,
            instance_id, receipt_fingerprint, canonical_input_fingerprint,
            canonical_content_fingerprint, record_fingerprint, accepted_at, record_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.admissionId,
          record.scope.tenantId,
          record.scope.principalId,
          record.idempotency.callerKey,
          record.idempotency.requestFingerprint,
          record.receipt.instance.instanceId,
          record.receipt.receiptFingerprint,
          record.receipt.canonicalInputFingerprint,
          record.receipt.canonicalContentFingerprint,
          record.recordFingerprint,
          record.acceptedAt,
          JSON.stringify(record),
        )
        options.faultInjector?.({
          transactionKind: "protected-admission-insert",
          point: "before-commit",
          admissionId: record.admissionId,
          instanceId: record.receipt.instance.instanceId,
        })
        database.exec("COMMIT")
        options.faultInjector?.({
          transactionKind: "protected-admission-insert",
          point: "after-commit",
          admissionId: record.admissionId,
          instanceId: record.receipt.instance.instanceId,
        })
        return "inserted"
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK")
        throw error
      }
    },

    async readByAdmissionId(admissionId) {
      const row = rowByAdmissionId(database, admissionId)
      return row == null ? null : parseStoredRow(row)
    },

    async readByInstanceId(instanceId) {
      const row = rowByInstanceId(database, instanceId)
      return row == null ? null : parseStoredRow(row)
    },

    close() {
      database.close()
    },
  }
}

export async function createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1(
  options: FlowDocBackendDocGenLocalAdmissionSqliteOptionsV1,
): Promise<FlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1> {
  const database = await openDatabase(options)
  return createRepository(database, options)
}
