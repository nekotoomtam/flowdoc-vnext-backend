import type { DatabaseSync } from "node:sqlite"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_REPOSITORY_V1_SOURCE,
  inspectFlowDocBackendPdfExportWorkflowCommitRequestV1,
  parseFlowDocBackendPdfExportObservabilityEventV1,
  parseFlowDocBackendPdfExportWorkflowCompletionV1,
  type FlowDocBackendPdfExportObservabilityEventV1,
  type FlowDocBackendPdfExportObservabilityRepositoryV1,
  type FlowDocBackendPdfExportWorkflowCommitResultV1,
  type FlowDocBackendPdfExportWorkflowCommitRequestV1,
  type FlowDocBackendPdfExportWorkflowReadResultV1,
} from "./pdfExportObservability.js"
import {
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
} from "./pdfExportOperation.js"
import { supportsFlowDocBackendPdfExportOperationSqliteV1 } from "./pdfExportOperationSqliteRepository.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_SQLITE_V1_SOURCE =
  "flowdoc-backend-pdf-export-observability-sqlite" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_SQLITE_MINIMUM_NODE = "24.15.0"

export type FlowDocBackendPdfExportObservabilitySqliteFaultPointV1 =
  | "after-event-batch"
  | "before-commit"
  | "after-commit"

export interface FlowDocBackendPdfExportObservabilitySqliteFaultContextV1 {
  transactionKind: "terminal-workflow"
  point: FlowDocBackendPdfExportObservabilitySqliteFaultPointV1
  workflowId: string
  operationId: string
}

export interface FlowDocBackendPdfExportObservabilitySqliteOptionsV1 {
  databasePath: string
  busyTimeoutMs?: number
  faultInjector?: (context: FlowDocBackendPdfExportObservabilitySqliteFaultContextV1) => void
}

export interface FlowDocBackendPdfExportObservabilitySqliteRepositoryV1
extends FlowDocBackendPdfExportObservabilityRepositoryV1 {
  sqliteSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_SQLITE_V1_SOURCE
  databasePath: string
  close(): void
}

interface StoredCompletionRow {
  workflow_id: string
  operation_id: string
  tenant_id: string
  principal_id: string
  scope_fingerprint: string
  operation_fingerprint: string
  terminal_status: string
  stop_reason: string
  persistence_receipt_fingerprint: string | null
  lifecycle_fingerprint: string
  event_count: number
  first_event_fingerprint: string
  last_event_fingerprint: string
  completed_at: string
  completion_fingerprint: string
  completion_json: string
}

interface StoredEventRow {
  event_id: string
  operation_id: string
  sequence: number
  previous_event_fingerprint: string | null
  event_name: string
  occurred_at: string
  scope_fingerprint: string
  event_fingerprint: string
  event_json: string
}

function issue(code: string, path: string, message: string) {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function isBusyError(error: unknown): boolean {
  return error instanceof Error && /database(?: table)? is locked/iu.test(error.message)
}

function unavailableCommit(): FlowDocBackendPdfExportWorkflowCommitResultV1 {
  return {
    status: "storage-unavailable",
    completion: null,
    events: [],
    issues: [issue("pdf-export-observability-sqlite-busy", "repository", "SQLite terminal workflow exceeded its bounded writer wait")],
  }
}

function unavailableRead(): FlowDocBackendPdfExportWorkflowReadResultV1 {
  return {
    status: "storage-unavailable",
    completion: null,
    events: [],
    issues: [issue("pdf-export-observability-sqlite-busy", "repository", "SQLite terminal workflow read exceeded its bounded wait")],
  }
}

function conflict(message: string): FlowDocBackendPdfExportWorkflowCommitResultV1 {
  return {
    status: "conflict",
    completion: null,
    events: [],
    issues: [issue("pdf-export-workflow-conflict", "workflow", message)],
  }
}

function completionRowByOperationId(database: DatabaseSync, operationId: string): StoredCompletionRow | undefined {
  return database.prepare(`
    SELECT workflow_id, operation_id, tenant_id, principal_id, scope_fingerprint,
      operation_fingerprint, terminal_status, stop_reason,
      persistence_receipt_fingerprint, lifecycle_fingerprint, event_count,
      first_event_fingerprint, last_event_fingerprint, completed_at,
      completion_fingerprint, completion_json
    FROM pdf_export_workflow_completions
    WHERE operation_id = ?
  `).get(operationId) as StoredCompletionRow | undefined
}

function completionRowByWorkflowId(database: DatabaseSync, workflowId: string): StoredCompletionRow | undefined {
  return database.prepare(`
    SELECT workflow_id, operation_id, tenant_id, principal_id, scope_fingerprint,
      operation_fingerprint, terminal_status, stop_reason,
      persistence_receipt_fingerprint, lifecycle_fingerprint, event_count,
      first_event_fingerprint, last_event_fingerprint, completed_at,
      completion_fingerprint, completion_json
    FROM pdf_export_workflow_completions
    WHERE workflow_id = ?
  `).get(workflowId) as StoredCompletionRow | undefined
}

function eventRows(database: DatabaseSync, operationId: string): StoredEventRow[] {
  return database.prepare(`
    SELECT event_id, operation_id, sequence, previous_event_fingerprint,
      event_name, occurred_at, scope_fingerprint, event_fingerprint, event_json
    FROM pdf_export_observability_events
    WHERE operation_id = ?
    ORDER BY sequence ASC
  `).all(operationId) as unknown as StoredEventRow[]
}

function parseStoredEvents(rows: StoredEventRow[]):
  | { status: "ready"; events: FlowDocBackendPdfExportObservabilityEventV1[] }
  | { status: "invalid"; issues: ReturnType<typeof issue>[] } {
  const events: FlowDocBackendPdfExportObservabilityEventV1[] = []
  for (const row of rows) {
    let value: unknown
    try {
      value = JSON.parse(row.event_json) as unknown
    } catch (error) {
      return { status: "invalid", issues: [issue("pdf-export-observability-storage-json-invalid", "eventJson", error instanceof Error ? error.message : "stored event JSON is invalid")] }
    }
    const parsed = parseFlowDocBackendPdfExportObservabilityEventV1(value)
    if (parsed.status === "blocked") return { status: "invalid", issues: parsed.issues }
    const event = parsed.event
    if (
      event.eventId !== row.event_id
      || event.operationId !== row.operation_id
      || event.sequence !== row.sequence
      || event.previousEventFingerprint !== row.previous_event_fingerprint
      || event.eventName !== row.event_name
      || event.occurredAt !== row.occurred_at
      || event.scopeFingerprint !== row.scope_fingerprint
      || event.eventFingerprint !== row.event_fingerprint
    ) return { status: "invalid", issues: [issue("pdf-export-observability-storage-event-mismatch", "repository", "stored event columns must match exact event JSON")] }
    events.push(event)
  }
  return { status: "ready", events }
}

function parseStoredWorkflow(
  database: DatabaseSync,
  row: StoredCompletionRow,
): FlowDocBackendPdfExportWorkflowReadResultV1 {
  let value: unknown
  try {
    value = JSON.parse(row.completion_json) as unknown
  } catch (error) {
    return {
      status: "invalid",
      completion: null,
      events: [],
      issues: [issue("pdf-export-observability-storage-json-invalid", "completionJson", error instanceof Error ? error.message : "stored completion JSON is invalid")],
    }
  }
  const parsed = parseFlowDocBackendPdfExportWorkflowCompletionV1(value)
  if (parsed.status === "blocked") return { status: "invalid", completion: null, events: [], issues: parsed.issues }
  const completion = parsed.completion
  const events = parseStoredEvents(eventRows(database, row.operation_id))
  if (events.status === "invalid") return { status: "invalid", completion: null, events: [], issues: events.issues }
  const columnsMatch = completion.workflowId === row.workflow_id
    && completion.operationId === row.operation_id
    && completion.scope.tenantId === row.tenant_id
    && completion.scope.principalId === row.principal_id
    && completion.scopeFingerprint === row.scope_fingerprint
    && completion.operationFingerprint === row.operation_fingerprint
    && completion.terminalStatus === row.terminal_status
    && completion.stopReason === row.stop_reason
    && completion.persistenceReceiptFingerprint === row.persistence_receipt_fingerprint
    && completion.lifecycleFingerprint === row.lifecycle_fingerprint
    && completion.eventCount === row.event_count
    && completion.firstEventFingerprint === row.first_event_fingerprint
    && completion.lastEventFingerprint === row.last_event_fingerprint
    && completion.completedAt === row.completed_at
    && completion.completionFingerprint === row.completion_fingerprint
    && events.events.length === completion.eventCount
    && events.events[0]?.eventFingerprint === completion.firstEventFingerprint
    && events.events.at(-1)?.eventFingerprint === completion.lastEventFingerprint
  if (!columnsMatch) return {
    status: "invalid",
    completion: null,
    events: [],
    issues: [issue("pdf-export-observability-storage-projection-mismatch", "repository", "stored completion columns and event chain must match exact JSON")],
  }
  return { status: "found", completion, events: events.events, issues: [] }
}

async function openDatabase(options: FlowDocBackendPdfExportObservabilitySqliteOptionsV1): Promise<DatabaseSync> {
  if (!supportsFlowDocBackendPdfExportOperationSqliteV1()) {
    throw new Error(`PDF export observability SQLite requires Node ${FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_SQLITE_MINIMUM_NODE} or newer`)
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
    CREATE TABLE IF NOT EXISTS pdf_export_observability_events (
      event_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      previous_event_fingerprint TEXT,
      event_name TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      scope_fingerprint TEXT NOT NULL,
      event_fingerprint TEXT NOT NULL UNIQUE,
      event_json TEXT NOT NULL,
      UNIQUE (operation_id, sequence)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pdf_export_workflow_completions (
      workflow_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      scope_fingerprint TEXT NOT NULL,
      operation_fingerprint TEXT NOT NULL,
      terminal_status TEXT NOT NULL,
      stop_reason TEXT NOT NULL,
      persistence_receipt_fingerprint TEXT,
      lifecycle_fingerprint TEXT NOT NULL,
      event_count INTEGER NOT NULL CHECK (event_count > 0),
      first_event_fingerprint TEXT NOT NULL,
      last_event_fingerprint TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      completion_fingerprint TEXT NOT NULL,
      completion_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS pdf_export_observability_operation_idx
      ON pdf_export_observability_events (operation_id, sequence);
    CREATE INDEX IF NOT EXISTS pdf_export_workflow_scope_idx
      ON pdf_export_workflow_completions (tenant_id, principal_id, operation_id);
  `)
  return database
}

function createRepository(
  database: DatabaseSync,
  options: FlowDocBackendPdfExportObservabilitySqliteOptionsV1,
): FlowDocBackendPdfExportObservabilitySqliteRepositoryV1 {
  const fault = (point: FlowDocBackendPdfExportObservabilitySqliteFaultPointV1, request: FlowDocBackendPdfExportWorkflowCommitRequestV1) => options.faultInjector?.({
    transactionKind: "terminal-workflow",
    point,
    workflowId: request.workflowId,
    operationId: request.operation.operationId,
  })
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_REPOSITORY_V1_SOURCE,
    sqliteSource: FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_SQLITE_V1_SOURCE,
    databasePath: options.databasePath,

    async commitTerminalWorkflow(request) {
      const inspected = inspectFlowDocBackendPdfExportWorkflowCommitRequestV1(request)
      if (inspected.status === "blocked") return { status: "invalid", completion: null, events: [], issues: inspected.issues }
      try {
        database.exec("BEGIN IMMEDIATE")
        const workflowOwner = completionRowByWorkflowId(database, request.workflowId)
        if (workflowOwner != null && workflowOwner.operation_id !== request.operation.operationId) {
          database.exec("COMMIT")
          return conflict("workflow id belongs to another operation")
        }
        const existingRow = completionRowByOperationId(database, request.operation.operationId)
        if (existingRow != null) {
          const existing = parseStoredWorkflow(database, existingRow)
          database.exec("COMMIT")
          if (existing.status !== "found") return {
            status: "invalid",
            completion: null,
            events: [],
            issues: existing.issues,
          }
          if (existing.completion.completionFingerprint === inspected.completion.completionFingerprint) return {
            status: "idempotent-replay",
            completion: existing.completion,
            events: existing.events,
            issues: [],
          }
          return conflict("operation already owns another terminal workflow")
        }
        for (const event of request.events) {
          const owner = database.prepare(`
            SELECT operation_id FROM pdf_export_observability_events WHERE event_id = ?
          `).get(event.eventId) as { operation_id: string } | undefined
          if (owner != null && owner.operation_id !== request.operation.operationId) {
            database.exec("COMMIT")
            return conflict("event id belongs to another operation")
          }
        }
        const insertEvent = database.prepare(`
          INSERT INTO pdf_export_observability_events (
            event_id, operation_id, sequence, previous_event_fingerprint,
            event_name, occurred_at, scope_fingerprint, event_fingerprint, event_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        request.events.forEach((event) => insertEvent.run(
          event.eventId,
          event.operationId,
          event.sequence,
          event.previousEventFingerprint,
          event.eventName,
          event.occurredAt,
          event.scopeFingerprint,
          event.eventFingerprint,
          JSON.stringify(event),
        ))
        fault("after-event-batch", request)
        const completion = inspected.completion
        database.prepare(`
          INSERT INTO pdf_export_workflow_completions (
            workflow_id, operation_id, tenant_id, principal_id, scope_fingerprint,
            operation_fingerprint, terminal_status, stop_reason,
            persistence_receipt_fingerprint, lifecycle_fingerprint, event_count,
            first_event_fingerprint, last_event_fingerprint, completed_at,
            completion_fingerprint, completion_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          completion.workflowId,
          completion.operationId,
          completion.scope.tenantId,
          completion.scope.principalId,
          completion.scopeFingerprint,
          completion.operationFingerprint,
          completion.terminalStatus,
          completion.stopReason,
          completion.persistenceReceiptFingerprint,
          completion.lifecycleFingerprint,
          completion.eventCount,
          completion.firstEventFingerprint,
          completion.lastEventFingerprint,
          completion.completedAt,
          completion.completionFingerprint,
          JSON.stringify(completion),
        )
        fault("before-commit", request)
        database.exec("COMMIT")
        fault("after-commit", request)
        return { status: "committed", completion, events: request.events, issues: [] }
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK")
        if (isBusyError(error)) return unavailableCommit()
        throw error
      }
    },

    async readTerminalWorkflow(input) {
      if (
        !isFlowDocBackendPdfExportBoundedStringV1(input.tenantId)
        || !isFlowDocBackendPdfExportBoundedStringV1(input.principalId)
        || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)
      ) return {
        status: "invalid",
        completion: null,
        events: [],
        issues: [issue("pdf-export-workflow-read-invalid", "operationId", "workflow read scope must be bounded")],
      }
      try {
        const row = completionRowByOperationId(database, input.operationId)
        if (row == null || row.tenant_id !== input.tenantId || row.principal_id !== input.principalId) {
          return { status: "not-found", completion: null, events: [], issues: [] }
        }
        return parseStoredWorkflow(database, row)
      } catch (error) {
        if (isBusyError(error)) return unavailableRead()
        throw error
      }
    },

    close() {
      database.close()
    },
  }
}

export function supportsFlowDocBackendPdfExportObservabilitySqliteV1(
  nodeVersion = process.versions.node,
): boolean {
  return supportsFlowDocBackendPdfExportOperationSqliteV1(nodeVersion)
}

export async function createFlowDocBackendPdfExportObservabilitySqliteRepositoryV1(
  options: FlowDocBackendPdfExportObservabilitySqliteOptionsV1,
): Promise<FlowDocBackendPdfExportObservabilitySqliteRepositoryV1> {
  const database = await openDatabase(options)
  return createRepository(database, options)
}
