import { createHash } from "node:crypto"
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-postgres" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_SCHEMA_VERSION = 1
export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_MIGRATION_ID =
  "pdf-export-local-postgres-v1" as const

const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000
const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_MAXIMUM_POOL_SIZE = 6
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

const PDF_EXPORT_LOCAL_POSTGRES_V1_SQL = `
CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_schema_migrations (
  version integer PRIMARY KEY,
  migration_id text NOT NULL UNIQUE,
  checksum text NOT NULL,
  applied_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_operations_v1 (
  operation_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  caller_key text NOT NULL,
  payload_fingerprint text NOT NULL,
  admission_fingerprint text NOT NULL,
  operation_fingerprint text NOT NULL,
  accepted_at text NOT NULL,
  operation_json text NOT NULL,
  UNIQUE (tenant_id, principal_id, caller_key)
);
CREATE INDEX IF NOT EXISTS flowdoc_pdf_export_operations_v1_scope_idx
  ON flowdoc_pdf_export_operations_v1 (tenant_id, principal_id, operation_id);

CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_lifecycle_heads_v1 (
  operation_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  operation_fingerprint text NOT NULL,
  admission_fingerprint text NOT NULL,
  payload_fingerprint text NOT NULL,
  head_revision integer NOT NULL CHECK (head_revision >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'claimed', 'stopped')),
  checkpoint text NOT NULL,
  next_action_at text NOT NULL,
  deadline_at text NOT NULL,
  claim_expires_at text,
  head_fingerprint text NOT NULL,
  head_json text NOT NULL
);
CREATE INDEX IF NOT EXISTS flowdoc_pdf_export_lifecycle_heads_v1_scope_idx
  ON flowdoc_pdf_export_lifecycle_heads_v1 (tenant_id, principal_id, operation_id);
CREATE INDEX IF NOT EXISTS flowdoc_pdf_export_lifecycle_heads_v1_due_idx
  ON flowdoc_pdf_export_lifecycle_heads_v1 (status, next_action_at, operation_id);
CREATE INDEX IF NOT EXISTS flowdoc_pdf_export_lifecycle_heads_v1_claim_idx
  ON flowdoc_pdf_export_lifecycle_heads_v1 (status, claim_expires_at, operation_id);

CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_lifecycle_transitions_v1 (
  operation_id text NOT NULL,
  transition_id text NOT NULL,
  request_fingerprint text NOT NULL,
  receipt_fingerprint text NOT NULL,
  result_head_fingerprint text NOT NULL,
  receipt_json text NOT NULL,
  result_head_json text NOT NULL,
  PRIMARY KEY (operation_id, transition_id),
  FOREIGN KEY (operation_id)
    REFERENCES flowdoc_pdf_export_lifecycle_heads_v1(operation_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_artifact_manifests_v1 (
  artifact_id text PRIMARY KEY,
  operation_id text NOT NULL UNIQUE,
  revision integer NOT NULL CHECK (revision = 0),
  storage_key text NOT NULL,
  record_fingerprint text NOT NULL,
  record_json text NOT NULL
);

CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_artifact_jobs_v1 (
  job_id text PRIMARY KEY,
  operation_id text NOT NULL UNIQUE,
  revision integer NOT NULL CHECK (revision = 0),
  artifact_id text NOT NULL,
  record_fingerprint text NOT NULL,
  record_json text NOT NULL
);

CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_artifact_receipts_v1 (
  persistence_id text PRIMARY KEY,
  operation_id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  operation_fingerprint text NOT NULL,
  render_execution_fingerprint text NOT NULL,
  completion_fingerprint text NOT NULL,
  projection_fingerprint text NOT NULL,
  storage_key text NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length > 0),
  sha256 text NOT NULL,
  committed_at text NOT NULL,
  receipt_fingerprint text NOT NULL,
  receipt_json text NOT NULL
);
CREATE INDEX IF NOT EXISTS flowdoc_pdf_export_artifact_receipts_v1_scope_idx
  ON flowdoc_pdf_export_artifact_receipts_v1 (tenant_id, principal_id, operation_id);
CREATE INDEX IF NOT EXISTS flowdoc_pdf_export_artifact_receipts_v1_storage_idx
  ON flowdoc_pdf_export_artifact_receipts_v1 (storage_key);

CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_observability_events_v1 (
  event_id text PRIMARY KEY,
  operation_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  previous_event_fingerprint text,
  event_name text NOT NULL,
  occurred_at text NOT NULL,
  scope_fingerprint text NOT NULL,
  event_fingerprint text NOT NULL UNIQUE,
  event_json text NOT NULL,
  UNIQUE (operation_id, sequence)
);
CREATE INDEX IF NOT EXISTS flowdoc_pdf_export_observability_events_v1_operation_idx
  ON flowdoc_pdf_export_observability_events_v1 (operation_id, sequence);

CREATE TABLE IF NOT EXISTS flowdoc_pdf_export_workflow_completions_v1 (
  workflow_id text PRIMARY KEY,
  operation_id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  scope_fingerprint text NOT NULL,
  operation_fingerprint text NOT NULL,
  terminal_status text NOT NULL,
  stop_reason text NOT NULL,
  persistence_receipt_fingerprint text,
  lifecycle_fingerprint text NOT NULL,
  event_count integer NOT NULL CHECK (event_count > 0),
  first_event_fingerprint text NOT NULL,
  last_event_fingerprint text NOT NULL,
  completed_at text NOT NULL,
  completion_fingerprint text NOT NULL,
  completion_json text NOT NULL
);
CREATE INDEX IF NOT EXISTS flowdoc_pdf_export_workflow_completions_v1_scope_idx
  ON flowdoc_pdf_export_workflow_completions_v1 (tenant_id, principal_id, operation_id);
`

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_MIGRATION_CHECKSUM =
  `sha256:${createHash("sha256").update(PDF_EXPORT_LOCAL_POSTGRES_V1_SQL).digest("hex")}`

export interface FlowDocBackendPdfExportLocalPostgresOptionsV1 {
  runtimeProfile: "local-integration"
  connectionString: string
  maximumPoolSize?: number
  connectionTimeoutMs?: number
  statementTimeoutMs?: number
  lockTimeoutMs?: number
  applicationName?: string
}

export interface FlowDocBackendPdfExportLocalPostgresFactsV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE
  runtimeProfile: "local-integration"
  databaseIdentityFingerprint: string
  schemaVersion: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_SCHEMA_VERSION
  loopbackOnly: true
  migrationsAutomaticOnImport: false
  productionBinding: false
}

export interface FlowDocBackendPdfExportPostgresQueryableV1 {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>
}

interface ValidatedLocalPostgresOptionsV1 {
  connectionString: string
  maximumPoolSize: number
  connectionTimeoutMs: number
  statementTimeoutMs: number
  lockTimeoutMs: number
  applicationName: string
  facts: FlowDocBackendPdfExportLocalPostgresFactsV1
}

export interface FlowDocBackendPdfExportLocalPostgresPoolV1 {
  pool: Pool
  facts: FlowDocBackendPdfExportLocalPostgresFactsV1
  lockTimeoutMs: number
  close(): Promise<void>
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function validatedOptions(
  options: FlowDocBackendPdfExportLocalPostgresOptionsV1,
): ValidatedLocalPostgresOptionsV1 {
  if (options.runtimeProfile !== "local-integration") {
    throw new Error("local PostgreSQL requires runtimeProfile=local-integration")
  }
  let url: URL
  try {
    url = new URL(options.connectionString)
  } catch {
    throw new Error("local PostgreSQL connection string must be a valid URL")
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || !LOCAL_HOSTS.has(url.hostname.toLowerCase())
    || url.pathname.length <= 1
  ) throw new Error("local PostgreSQL connection must use a loopback host and named database")
  const databaseIdentityFingerprint = `sha256:${createHash("sha256").update(JSON.stringify({
    protocol: url.protocol,
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database: url.pathname.slice(1),
  })).digest("hex")}`
  return {
    connectionString: options.connectionString,
    maximumPoolSize: boundedInteger(options.maximumPoolSize ?? DEFAULT_MAXIMUM_POOL_SIZE, 1, 16, "maximumPoolSize"),
    connectionTimeoutMs: boundedInteger(options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS, 100, 60_000, "connectionTimeoutMs"),
    statementTimeoutMs: boundedInteger(options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS, 100, 120_000, "statementTimeoutMs"),
    lockTimeoutMs: boundedInteger(options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, 100, 60_000, "lockTimeoutMs"),
    applicationName: options.applicationName ?? "flowdoc-pdf-export-local",
    facts: {
      source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
      runtimeProfile: "local-integration",
      databaseIdentityFingerprint,
      schemaVersion: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_SCHEMA_VERSION,
      loopbackOnly: true,
      migrationsAutomaticOnImport: false,
      productionBinding: false,
    },
  }
}

function createPoolConfig(options: ValidatedLocalPostgresOptionsV1): PoolConfig {
  return {
    connectionString: options.connectionString,
    max: options.maximumPoolSize,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idleTimeoutMillis: 10_000,
    statement_timeout: options.statementTimeoutMs,
    application_name: options.applicationName,
    ssl: false,
  }
}

export function isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error: unknown): boolean {
  if (typeof error !== "object" || error == null) return false
  const code = "code" in error && typeof error.code === "string" ? error.code : ""
  return code.startsWith("08")
    || code === "53300"
    || code === "55P03"
    || code === "57014"
    || code === "57P01"
    || code === "57P02"
    || code === "57P03"
    || code === "ECONNREFUSED"
    || code === "ECONNRESET"
    || code === "ETIMEDOUT"
}

export async function createFlowDocBackendPdfExportLocalPostgresPoolV1(
  options: FlowDocBackendPdfExportLocalPostgresOptionsV1,
): Promise<FlowDocBackendPdfExportLocalPostgresPoolV1> {
  const validated = validatedOptions(options)
  const pool = new Pool(createPoolConfig(validated))
  try {
    await pool.query("SELECT 1 AS ready")
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
  return {
    pool,
    facts: validated.facts,
    lockTimeoutMs: validated.lockTimeoutMs,
    close: () => pool.end(),
  }
}

export async function migrateFlowDocBackendPdfExportLocalPostgresV1(
  options: FlowDocBackendPdfExportLocalPostgresOptionsV1 & { appliedAt: string },
): Promise<FlowDocBackendPdfExportLocalPostgresFactsV1> {
  if (
    !Number.isFinite(Date.parse(options.appliedAt))
    || new Date(options.appliedAt).toISOString() !== options.appliedAt
  ) throw new Error("local PostgreSQL migration requires an exact ISO appliedAt")
  const local = await createFlowDocBackendPdfExportLocalPostgresPoolV1(options)
  const client = await local.pool.connect()
  let committed = false
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_MIGRATION_ID,
    ])
    await client.query(PDF_EXPORT_LOCAL_POSTGRES_V1_SQL)
    const existing = await client.query<{ checksum: string; migration_id: string }>(`
      SELECT checksum, migration_id
      FROM flowdoc_pdf_export_schema_migrations
      WHERE version = $1
      FOR UPDATE
    `, [FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_SCHEMA_VERSION])
    if (existing.rowCount === 0) {
      await client.query(`
        INSERT INTO flowdoc_pdf_export_schema_migrations (
          version, migration_id, checksum, applied_at
        ) VALUES ($1, $2, $3, $4)
      `, [
        FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_SCHEMA_VERSION,
        FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_MIGRATION_ID,
        FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_MIGRATION_CHECKSUM,
        options.appliedAt,
      ])
    } else if (
      existing.rows[0]!.migration_id !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_MIGRATION_ID
      || existing.rows[0]!.checksum !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_MIGRATION_CHECKSUM
    ) throw new Error("local PostgreSQL schema version exists with a different migration identity or checksum")
    await client.query("COMMIT")
    committed = true
    return local.facts
  } finally {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined)
    client.release()
    await local.close()
  }
}

export async function assertFlowDocBackendPdfExportLocalPostgresSchemaV1(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
): Promise<void> {
  let result: QueryResult<{ migration_id: string; checksum: string }>
  try {
    result = await queryable.query(`
      SELECT migration_id, checksum
      FROM flowdoc_pdf_export_schema_migrations
      WHERE version = $1
    `, [FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_SCHEMA_VERSION])
  } catch (error) {
    throw new Error("local PostgreSQL schema is unavailable; run the explicit LOCAL-C migration first", { cause: error })
  }
  if (
    result.rowCount !== 1
    || result.rows[0]!.migration_id !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_MIGRATION_ID
    || result.rows[0]!.checksum !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_MIGRATION_CHECKSUM
  ) throw new Error("local PostgreSQL schema migration identity or checksum is not accepted")
}

export async function beginFlowDocBackendPdfExportPostgresTransactionV1(
  client: PoolClient,
  lockTimeoutMs: number,
): Promise<void> {
  await client.query("BEGIN")
  await client.query("SELECT set_config('lock_timeout', $1, true)", [`${lockTimeoutMs}ms`])
}
