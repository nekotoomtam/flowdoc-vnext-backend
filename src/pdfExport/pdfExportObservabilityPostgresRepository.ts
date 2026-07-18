import type { Pool, PoolClient } from "pg"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_REPOSITORY_V1_SOURCE,
  inspectFlowDocBackendPdfExportWorkflowCommitRequestV1,
  parseFlowDocBackendPdfExportObservabilityEventV1,
  parseFlowDocBackendPdfExportWorkflowCompletionV1,
  type FlowDocBackendPdfExportObservabilityEventV1,
  type FlowDocBackendPdfExportObservabilityRepositoryV1,
  type FlowDocBackendPdfExportWorkflowCommitRequestV1,
  type FlowDocBackendPdfExportWorkflowCommitResultV1,
  type FlowDocBackendPdfExportWorkflowReadResultV1,
} from "./pdfExportObservability.js"
import {
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
} from "./pdfExportOperation.js"
import {
  beginFlowDocBackendPdfExportPostgresTransactionV1,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
  isFlowDocBackendPdfExportPostgresUnavailableErrorV1,
  type FlowDocBackendPdfExportPostgresQueryableV1,
} from "./pdfExportLocalPostgresSupport.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_POSTGRES_V1_SOURCE =
  "flowdoc-backend-pdf-export-observability-postgres" as const

export type FlowDocBackendPdfExportObservabilityPostgresFaultPointV1 =
  | "after-event-batch"
  | "before-commit"
  | "after-commit"

export interface FlowDocBackendPdfExportObservabilityPostgresFaultContextV1 {
  transactionKind: "terminal-workflow"
  point: FlowDocBackendPdfExportObservabilityPostgresFaultPointV1
  workflowId: string
  operationId: string
}

export interface FlowDocBackendPdfExportObservabilityPostgresOptionsV1 {
  pool: Pool
  lockTimeoutMs: number
  faultInjector?: (context: FlowDocBackendPdfExportObservabilityPostgresFaultContextV1) => void | Promise<void>
}

export interface FlowDocBackendPdfExportObservabilityPostgresRepositoryV1
extends FlowDocBackendPdfExportObservabilityRepositoryV1 {
  postgresSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_POSTGRES_V1_SOURCE
  localPostgresSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE
  productionBinding: false
}

interface StoredCompletionRowV1 {
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

interface StoredEventRowV1 {
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

const SELECT_COMPLETION = `
  SELECT workflow_id, operation_id, tenant_id, principal_id, scope_fingerprint,
    operation_fingerprint, terminal_status, stop_reason,
    persistence_receipt_fingerprint, lifecycle_fingerprint, event_count,
    first_event_fingerprint, last_event_fingerprint, completed_at,
    completion_fingerprint, completion_json
  FROM flowdoc_pdf_export_workflow_completions_v1
`

function issue(code: string, path: string, message: string) {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function unavailableCommit(): FlowDocBackendPdfExportWorkflowCommitResultV1 {
  return {
    status: "storage-unavailable",
    completion: null,
    events: [],
    issues: [issue(
      "pdf-export-observability-postgres-unavailable",
      "repository",
      "local PostgreSQL terminal workflow is unavailable within its bounded wait",
    )],
  }
}

function unavailableRead(): FlowDocBackendPdfExportWorkflowReadResultV1 {
  return {
    status: "storage-unavailable",
    completion: null,
    events: [],
    issues: [issue(
      "pdf-export-observability-postgres-unavailable",
      "repository",
      "local PostgreSQL terminal workflow read is unavailable within its bounded wait",
    )],
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

async function completionRowByOperationId(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  operationId: string,
): Promise<StoredCompletionRowV1 | undefined> {
  const result = await queryable.query<StoredCompletionRowV1>(`${SELECT_COMPLETION}
    WHERE operation_id = $1
  `, [operationId])
  return result.rows[0]
}

async function completionRowByWorkflowId(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  workflowId: string,
): Promise<StoredCompletionRowV1 | undefined> {
  const result = await queryable.query<StoredCompletionRowV1>(`${SELECT_COMPLETION}
    WHERE workflow_id = $1
  `, [workflowId])
  return result.rows[0]
}

async function eventRows(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  operationId: string,
): Promise<StoredEventRowV1[]> {
  const result = await queryable.query<StoredEventRowV1>(`
    SELECT event_id, operation_id, sequence, previous_event_fingerprint,
      event_name, occurred_at, scope_fingerprint, event_fingerprint, event_json
    FROM flowdoc_pdf_export_observability_events_v1
    WHERE operation_id = $1
    ORDER BY sequence ASC
  `, [operationId])
  return result.rows
}

function parseStoredEvents(rows: StoredEventRowV1[]):
  | { status: "ready"; events: FlowDocBackendPdfExportObservabilityEventV1[] }
  | { status: "invalid"; issues: ReturnType<typeof issue>[] } {
  const events: FlowDocBackendPdfExportObservabilityEventV1[] = []
  for (const row of rows) {
    let value: unknown
    try {
      value = JSON.parse(row.event_json) as unknown
    } catch (error) {
      return {
        status: "invalid",
        issues: [issue(
          "pdf-export-observability-storage-json-invalid",
          "eventJson",
          error instanceof Error ? error.message : "stored event JSON is invalid",
        )],
      }
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
    ) return {
      status: "invalid",
      issues: [issue(
        "pdf-export-observability-storage-event-mismatch",
        "repository",
        "stored event columns must match exact event JSON",
      )],
    }
    events.push(event)
  }
  return { status: "ready", events }
}

async function parseStoredWorkflow(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  row: StoredCompletionRowV1,
): Promise<FlowDocBackendPdfExportWorkflowReadResultV1> {
  let value: unknown
  try {
    value = JSON.parse(row.completion_json) as unknown
  } catch (error) {
    return {
      status: "invalid",
      completion: null,
      events: [],
      issues: [issue(
        "pdf-export-observability-storage-json-invalid",
        "completionJson",
        error instanceof Error ? error.message : "stored completion JSON is invalid",
      )],
    }
  }
  const parsed = parseFlowDocBackendPdfExportWorkflowCompletionV1(value)
  if (parsed.status === "blocked") return {
    status: "invalid",
    completion: null,
    events: [],
    issues: parsed.issues,
  }
  const completion = parsed.completion
  const events = parseStoredEvents(await eventRows(queryable, row.operation_id))
  if (events.status === "invalid") return {
    status: "invalid",
    completion: null,
    events: [],
    issues: events.issues,
  }
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
    issues: [issue(
      "pdf-export-observability-storage-projection-mismatch",
      "repository",
      "stored completion columns and event chain must match exact JSON",
    )],
  }
  return { status: "found", completion, events: events.events, issues: [] }
}

async function lockWorkflowIdentities(
  client: PoolClient,
  request: FlowDocBackendPdfExportWorkflowCommitRequestV1,
): Promise<void> {
  const identities = [
    request.operation.operationId,
    request.workflowId,
    ...request.events.map((event) => event.eventId),
  ].sort()
  for (const identity of identities) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_POSTGRES_V1_SOURCE,
      identity,
    ])
  }
}

export function createFlowDocBackendPdfExportObservabilityPostgresRepositoryV1(
  options: FlowDocBackendPdfExportObservabilityPostgresOptionsV1,
): FlowDocBackendPdfExportObservabilityPostgresRepositoryV1 {
  const fault = async (
    point: FlowDocBackendPdfExportObservabilityPostgresFaultPointV1,
    request: FlowDocBackendPdfExportWorkflowCommitRequestV1,
  ) => options.faultInjector?.({
    transactionKind: "terminal-workflow",
    point,
    workflowId: request.workflowId,
    operationId: request.operation.operationId,
  })
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_REPOSITORY_V1_SOURCE,
    postgresSource: FLOWDOC_BACKEND_PDF_EXPORT_OBSERVABILITY_POSTGRES_V1_SOURCE,
    localPostgresSource: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
    productionBinding: false,

    async commitTerminalWorkflow(request) {
      const inspected = inspectFlowDocBackendPdfExportWorkflowCommitRequestV1(request)
      if (inspected.status === "blocked") return {
        status: "invalid",
        completion: null,
        events: [],
        issues: inspected.issues,
      }
      let client: PoolClient | null = null
      let committed = false
      try {
        client = await options.pool.connect()
        await beginFlowDocBackendPdfExportPostgresTransactionV1(client, options.lockTimeoutMs)
        await lockWorkflowIdentities(client, request)
        const workflowOwner = await completionRowByWorkflowId(client, request.workflowId)
        if (workflowOwner != null && workflowOwner.operation_id !== request.operation.operationId) {
          await client.query("COMMIT")
          committed = true
          return conflict("workflow id belongs to another operation")
        }
        const existingRow = await completionRowByOperationId(client, request.operation.operationId)
        if (existingRow != null) {
          const existing = await parseStoredWorkflow(client, existingRow)
          await client.query("COMMIT")
          committed = true
          if (existing.status !== "found") return {
            status: "invalid",
            completion: null,
            events: [],
            issues: existing.issues,
          }
          return existing.completion.completionFingerprint === inspected.completion.completionFingerprint
            ? {
                status: "idempotent-replay",
                completion: existing.completion,
                events: existing.events,
                issues: [],
              }
            : conflict("operation already owns another terminal workflow")
        }
        for (const event of request.events) {
          const owner = await client.query<{ operation_id: string }>(`
            SELECT operation_id FROM flowdoc_pdf_export_observability_events_v1 WHERE event_id = $1
          `, [event.eventId])
          if (owner.rowCount !== 0 && owner.rows[0]!.operation_id !== request.operation.operationId) {
            await client.query("COMMIT")
            committed = true
            return conflict("event id belongs to another operation")
          }
        }
        for (const event of request.events) {
          await client.query(`
            INSERT INTO flowdoc_pdf_export_observability_events_v1 (
              event_id, operation_id, sequence, previous_event_fingerprint,
              event_name, occurred_at, scope_fingerprint, event_fingerprint, event_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            event.eventId,
            event.operationId,
            event.sequence,
            event.previousEventFingerprint,
            event.eventName,
            event.occurredAt,
            event.scopeFingerprint,
            event.eventFingerprint,
            JSON.stringify(event),
          ])
        }
        await fault("after-event-batch", request)
        const completion = inspected.completion
        await client.query(`
          INSERT INTO flowdoc_pdf_export_workflow_completions_v1 (
            workflow_id, operation_id, tenant_id, principal_id, scope_fingerprint,
            operation_fingerprint, terminal_status, stop_reason,
            persistence_receipt_fingerprint, lifecycle_fingerprint, event_count,
            first_event_fingerprint, last_event_fingerprint, completed_at,
            completion_fingerprint, completion_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `, [
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
        ])
        await fault("before-commit", request)
        await client.query("COMMIT")
        committed = true
        await fault("after-commit", request)
        return { status: "committed", completion, events: request.events, issues: [] }
      } catch (error) {
        if (!committed && client != null) await client.query("ROLLBACK").catch(() => undefined)
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableCommit()
        throw error
      } finally {
        client?.release()
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
        const row = await completionRowByOperationId(options.pool, input.operationId)
        if (row == null || row.tenant_id !== input.tenantId || row.principal_id !== input.principalId) {
          return { status: "not-found", completion: null, events: [], issues: [] }
        }
        return parseStoredWorkflow(options.pool, row)
      } catch (error) {
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableRead()
        throw error
      }
    },
  }
}
