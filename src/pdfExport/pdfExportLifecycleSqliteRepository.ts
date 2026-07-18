import type { DatabaseSync } from "node:sqlite"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_TRANSITION_V1_SOURCE,
  FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION,
  applyFlowDocBackendPdfExportLifecycleTransitionV1,
  createFlowDocBackendPdfExportLifecycleHeadV1,
  inspectFlowDocBackendPdfExportLifecycleTransitionRequestV1,
  lifecycleOperationMatchesV1,
  parseFlowDocBackendPdfExportLifecycleHeadV1,
  type FlowDocBackendPdfExportLifecycleHeadV1,
  type FlowDocBackendPdfExportLifecycleTransitionReceiptV1,
} from "./pdfExportLifecycle.js"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_REPOSITORY_V1_SOURCE,
  type FlowDocBackendPdfExportLifecycleInitializeResultV1,
  type FlowDocBackendPdfExportLifecycleReadResultV1,
  type FlowDocBackendPdfExportLifecycleRepositoryV1,
  type FlowDocBackendPdfExportLifecycleTransitionResultV1,
} from "./pdfExportLifecycleRepository.js"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  isFlowDocBackendPdfExportRecordV1,
  parseFlowDocBackendPdfExportOperationV1,
} from "./pdfExportOperation.js"
import type { FlowDocBackendPdfExportOperationScopeV1 } from "./pdfExportOperationRepository.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_SQLITE_V1_SOURCE =
  "flowdoc-backend-pdf-export-lifecycle-sqlite" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_SQLITE_MINIMUM_NODE = "24.15.0"

export type FlowDocBackendPdfExportLifecycleSqliteFaultPointV1 = "before-commit" | "after-commit"

export interface FlowDocBackendPdfExportLifecycleSqliteFaultContextV1 {
  transactionKind: "lifecycle-initialize" | "lifecycle-transition"
  point: FlowDocBackendPdfExportLifecycleSqliteFaultPointV1
  operationId: string
  transitionId: string | null
}

export interface FlowDocBackendPdfExportLifecycleSqliteOptionsV1 {
  databasePath: string
  busyTimeoutMs?: number
  faultInjector?: (context: FlowDocBackendPdfExportLifecycleSqliteFaultContextV1) => void
}

export interface FlowDocBackendPdfExportLifecycleSqliteRepositoryV1
  extends FlowDocBackendPdfExportLifecycleRepositoryV1 {
  sqliteSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_SQLITE_V1_SOURCE
  databasePath: string
  close(): void
}

interface StoredHeadRowV1 {
  operation_id: string
  tenant_id: string
  principal_id: string
  operation_fingerprint: string
  admission_fingerprint: string
  payload_fingerprint: string
  head_revision: number
  status: string
  deadline_at: string
  head_fingerprint: string
  head_json: string
}

interface StoredTransitionRowV1 {
  operation_id: string
  transition_id: string
  request_fingerprint: string
  receipt_fingerprint: string
  result_head_fingerprint: string
  receipt_json: string
  result_head_json: string
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

export function supportsFlowDocBackendPdfExportLifecycleSqliteV1(
  nodeVersion = process.versions.node,
): boolean {
  const actual = parseNodeVersion(nodeVersion)
  const minimum = parseNodeVersion(FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_SQLITE_MINIMUM_NODE)
  return actual != null && minimum != null && versionAtLeast(actual, minimum)
}

function isBusyError(error: unknown): boolean {
  return error instanceof Error && /database(?: table)? is locked/iu.test(error.message)
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function fingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)
}

function validScope(input: FlowDocBackendPdfExportOperationScopeV1): boolean {
  return isFlowDocBackendPdfExportBoundedStringV1(input.tenantId)
    && isFlowDocBackendPdfExportBoundedStringV1(input.principalId)
}

function invalidRead(): FlowDocBackendPdfExportLifecycleReadResultV1 {
  return {
    status: "invalid",
    head: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-read-identity-invalid",
      "operationId",
      "lifecycle reads require bounded tenant, principal, and operation identities",
    )],
  }
}

function unavailableInitialize(): FlowDocBackendPdfExportLifecycleInitializeResultV1 {
  return {
    status: "storage-unavailable",
    head: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-sqlite-busy",
      "repository",
      "SQLite lifecycle initialization exceeded its bounded writer wait",
    )],
  }
}

function unavailableRead(): FlowDocBackendPdfExportLifecycleReadResultV1 {
  return {
    status: "storage-unavailable",
    head: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-sqlite-busy",
      "repository",
      "SQLite lifecycle read exceeded its bounded wait",
    )],
  }
}

function unavailableTransition(): FlowDocBackendPdfExportLifecycleTransitionResultV1 {
  return {
    status: "storage-unavailable",
    head: null,
    receipt: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-sqlite-busy",
      "repository",
      "SQLite lifecycle transition exceeded its bounded writer wait",
    )],
  }
}

function rowByOperationId(database: DatabaseSync, operationId: string): StoredHeadRowV1 | undefined {
  return database.prepare(`
    SELECT operation_id, tenant_id, principal_id, operation_fingerprint,
      admission_fingerprint, payload_fingerprint, head_revision, status,
      deadline_at, head_fingerprint, head_json
    FROM pdf_export_lifecycle_heads
    WHERE operation_id = ?
  `).get(operationId) as StoredHeadRowV1 | undefined
}

function rowByTransitionId(
  database: DatabaseSync,
  operationId: string,
  transitionId: string,
): StoredTransitionRowV1 | undefined {
  return database.prepare(`
    SELECT operation_id, transition_id, request_fingerprint, receipt_fingerprint,
      result_head_fingerprint, receipt_json, result_head_json
    FROM pdf_export_lifecycle_transitions
    WHERE operation_id = ? AND transition_id = ?
  `).get(operationId, transitionId) as StoredTransitionRowV1 | undefined
}

function parseStoredHead(row: StoredHeadRowV1): FlowDocBackendPdfExportLifecycleReadResultV1 {
  let value: unknown
  try {
    value = JSON.parse(row.head_json) as unknown
  } catch (error) {
    return {
      status: "invalid",
      head: null,
      issues: [flowDocBackendPdfExportOperationIssueV1(
        "pdf-export-lifecycle-storage-json-invalid",
        "headJson",
        error instanceof Error ? error.message : "stored lifecycle JSON is invalid",
      )],
    }
  }
  const parsed = parseFlowDocBackendPdfExportLifecycleHeadV1(value)
  if (parsed.status === "blocked") return { status: "invalid", head: null, issues: parsed.issues }
  const head = parsed.head
  if (
    head.operationId !== row.operation_id
    || head.scope.tenantId !== row.tenant_id
    || head.scope.principalId !== row.principal_id
    || head.operationFingerprint !== row.operation_fingerprint
    || head.admissionFingerprint !== row.admission_fingerprint
    || head.payloadFingerprint !== row.payload_fingerprint
    || head.headRevision !== row.head_revision
    || head.status !== row.status
    || head.deadlineAt !== row.deadline_at
    || head.lifecycleFingerprint !== row.head_fingerprint
  ) return {
    status: "invalid",
    head: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-storage-projection-mismatch",
      "repository",
      "stored lifecycle columns must match the exact retained head JSON",
    )],
  }
  return { status: "found", head: cloneFlowDocBackendPdfExportJsonV1(head), issues: [] }
}

function parseStoredTransition(row: StoredTransitionRowV1): {
  status: "found"
  head: FlowDocBackendPdfExportLifecycleHeadV1
  receipt: FlowDocBackendPdfExportLifecycleTransitionReceiptV1
} | {
  status: "invalid"
  issues: ReturnType<typeof flowDocBackendPdfExportOperationIssueV1>[]
} {
  let receiptValue: unknown
  let headValue: unknown
  try {
    receiptValue = JSON.parse(row.receipt_json) as unknown
    headValue = JSON.parse(row.result_head_json) as unknown
  } catch (error) {
    return {
      status: "invalid",
      issues: [flowDocBackendPdfExportOperationIssueV1(
        "pdf-export-lifecycle-transition-storage-json-invalid",
        "transition",
        error instanceof Error ? error.message : "stored transition JSON is invalid",
      )],
    }
  }
  const parsedHead = parseFlowDocBackendPdfExportLifecycleHeadV1(headValue)
  if (parsedHead.status === "blocked") return { status: "invalid", issues: parsedHead.issues }
  if (!isFlowDocBackendPdfExportRecordV1(receiptValue)) return {
    status: "invalid",
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-transition-receipt-invalid",
      "receipt",
      "stored transition receipt must be an object",
    )],
  }
  const receipt = receiptValue
  const { receiptFingerprint: storedReceiptFingerprint, ...receiptFacts } = receipt
  const receiptKeys = [
    "source", "contractVersion", "kind", "transitionId", "operationId", "transitionKind",
    "requestFingerprint", "fromHeadRevision", "toHeadRevision", "resultHeadFingerprint",
    "appliedAt", "receiptFingerprint",
  ]
  const transitionKinds = new Set([
    "claim", "request-cancellation", "pass-checkpoint", "release-claim",
    "check-checkpoint", "enforce-deadline", "force-shutdown",
  ])
  const valid = Object.keys(receipt).sort().join("|") === receiptKeys.sort().join("|")
    && receipt.source === FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_TRANSITION_V1_SOURCE
    && receipt.contractVersion === FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION
    && receipt.kind === "pdf-export-lifecycle-transition-receipt"
    && typeof receipt.transitionKind === "string"
    && transitionKinds.has(receipt.transitionKind)
    && receipt.operationId === row.operation_id
    && receipt.transitionId === row.transition_id
    && receipt.requestFingerprint === row.request_fingerprint
    && receipt.resultHeadFingerprint === row.result_head_fingerprint
    && receipt.resultHeadFingerprint === parsedHead.head.lifecycleFingerprint
    && receipt.toHeadRevision === parsedHead.head.headRevision
    && Number.isInteger(receipt.fromHeadRevision)
    && Number.isInteger(receipt.toHeadRevision)
    && (receipt.toHeadRevision as number) === (receipt.fromHeadRevision as number) + 1
    && exactIso(receipt.appliedAt)
    && fingerprint(storedReceiptFingerprint)
    && storedReceiptFingerprint === row.receipt_fingerprint
    && flowDocBackendPdfExportFingerprintV1(receiptFacts) === storedReceiptFingerprint
  if (!valid) return {
    status: "invalid",
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-transition-storage-projection-mismatch",
      "transition",
      "stored transition columns, receipt, and result head must remain exact",
    )],
  }
  return {
    status: "found",
    head: cloneFlowDocBackendPdfExportJsonV1(parsedHead.head),
    receipt: cloneFlowDocBackendPdfExportJsonV1(receiptValue as unknown as FlowDocBackendPdfExportLifecycleTransitionReceiptV1),
  }
}

async function openDatabase(options: FlowDocBackendPdfExportLifecycleSqliteOptionsV1): Promise<DatabaseSync> {
  if (!supportsFlowDocBackendPdfExportLifecycleSqliteV1()) throw new Error(
    `PDF export lifecycle SQLite requires Node ${FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_SQLITE_MINIMUM_NODE} or newer`,
  )
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
    CREATE TABLE IF NOT EXISTS pdf_export_lifecycle_heads (
      operation_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      operation_fingerprint TEXT NOT NULL,
      admission_fingerprint TEXT NOT NULL,
      payload_fingerprint TEXT NOT NULL,
      head_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'stopped')),
      deadline_at TEXT NOT NULL,
      head_fingerprint TEXT NOT NULL,
      head_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS pdf_export_lifecycle_scope_idx
      ON pdf_export_lifecycle_heads (tenant_id, principal_id, operation_id);
    CREATE INDEX IF NOT EXISTS pdf_export_lifecycle_due_idx
      ON pdf_export_lifecycle_heads (status, deadline_at, operation_id);
    CREATE TABLE IF NOT EXISTS pdf_export_lifecycle_transitions (
      operation_id TEXT NOT NULL,
      transition_id TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      receipt_fingerprint TEXT NOT NULL,
      result_head_fingerprint TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      result_head_json TEXT NOT NULL,
      PRIMARY KEY (operation_id, transition_id),
      FOREIGN KEY (operation_id) REFERENCES pdf_export_lifecycle_heads(operation_id) ON DELETE RESTRICT
    ) STRICT;
  `)
  return database
}

function createRepository(
  database: DatabaseSync,
  options: FlowDocBackendPdfExportLifecycleSqliteOptionsV1,
): FlowDocBackendPdfExportLifecycleSqliteRepositoryV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_REPOSITORY_V1_SOURCE,
    sqliteSource: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_SQLITE_V1_SOURCE,
    databasePath: options.databasePath,

    async initializeLifecycle(value) {
      const parsedOperation = parseFlowDocBackendPdfExportOperationV1(value)
      if (parsedOperation.status === "blocked") return { status: "invalid", head: null, issues: parsedOperation.issues }
      const created = createFlowDocBackendPdfExportLifecycleHeadV1(parsedOperation.operation)
      if (created.status === "blocked") return { status: "invalid", head: null, issues: created.issues }
      try {
        database.exec("BEGIN IMMEDIATE")
        let inserted = false
        let result: FlowDocBackendPdfExportLifecycleInitializeResultV1
        const existingRow = rowByOperationId(database, parsedOperation.operation.operationId)
        if (existingRow != null) {
          const existing = parseStoredHead(existingRow)
          if (existing.status !== "found") result = { status: "invalid", head: null, issues: existing.issues }
          else if (
            existingRow.tenant_id === parsedOperation.operation.scope.tenantId
            && existingRow.principal_id === parsedOperation.operation.scope.principalId
            && lifecycleOperationMatchesV1({ operation: parsedOperation.operation, head: existing.head })
          ) result = { status: "idempotent-replay", head: existing.head, issues: [] }
          else result = {
            status: "conflict",
            head: null,
            issues: [flowDocBackendPdfExportOperationIssueV1(
              "pdf-export-lifecycle-operation-conflict",
              "operationId",
              "operation id already owns lifecycle facts from another immutable operation binding",
            )],
          }
        } else {
          database.prepare(`
            INSERT INTO pdf_export_lifecycle_heads (
              operation_id, tenant_id, principal_id, operation_fingerprint,
              admission_fingerprint, payload_fingerprint, head_revision, status,
              deadline_at, head_fingerprint, head_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            created.head.operationId,
            parsedOperation.operation.scope.tenantId,
            parsedOperation.operation.scope.principalId,
            created.head.operationFingerprint,
            created.head.admissionFingerprint,
            created.head.payloadFingerprint,
            created.head.headRevision,
            created.head.status,
            created.head.deadlineAt,
            created.head.lifecycleFingerprint,
            JSON.stringify(created.head),
          )
          inserted = true
          result = { status: "created", head: cloneFlowDocBackendPdfExportJsonV1(created.head), issues: [] }
        }
        if (inserted) options.faultInjector?.({
          transactionKind: "lifecycle-initialize",
          point: "before-commit",
          operationId: parsedOperation.operation.operationId,
          transitionId: null,
        })
        database.exec("COMMIT")
        if (inserted) options.faultInjector?.({
          transactionKind: "lifecycle-initialize",
          point: "after-commit",
          operationId: parsedOperation.operation.operationId,
          transitionId: null,
        })
        return result
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK")
        if (isBusyError(error)) return unavailableInitialize()
        throw error
      }
    },

    async readLifecycle(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)) return invalidRead()
      try {
        const row = rowByOperationId(database, input.operationId)
        if (row == null || row.tenant_id !== input.tenantId || row.principal_id !== input.principalId) {
          return { status: "not-found", head: null, issues: [] }
        }
        return parseStoredHead(row)
      } catch (error) {
        if (isBusyError(error)) return unavailableRead()
        throw error
      }
    },

    async applyLifecycleTransition(value) {
      const inspected = inspectFlowDocBackendPdfExportLifecycleTransitionRequestV1(value)
      if (inspected.status === "blocked") return {
        status: "invalid",
        head: null,
        receipt: null,
        issues: inspected.issues,
      }
      const request = inspected.request
      try {
        database.exec("BEGIN IMMEDIATE")
        let changed = false
        let result: FlowDocBackendPdfExportLifecycleTransitionResultV1
        const currentRow = rowByOperationId(database, request.operationId)
        if (currentRow == null
          || currentRow.tenant_id !== request.tenantId
          || currentRow.principal_id !== request.principalId) result = {
          status: "not-found",
          head: null,
          receipt: null,
          issues: [],
        }
        else {
          const current = parseStoredHead(currentRow)
          if (current.status !== "found") result = {
            status: "invalid",
            head: null,
            receipt: null,
            issues: current.issues,
          }
          else {
            const replayRow = rowByTransitionId(database, request.operationId, request.transitionId)
            if (replayRow != null) {
              const replay = parseStoredTransition(replayRow)
              if (replay.status === "invalid") result = {
                status: "invalid",
                head: null,
                receipt: null,
                issues: replay.issues,
              }
              else if (replayRow.request_fingerprint === inspected.requestFingerprint) result = {
                status: "idempotent-replay",
                head: replay.head,
                receipt: replay.receipt,
                issues: [],
              }
              else result = {
                status: "conflict",
                head: current.head,
                receipt: null,
                issues: [flowDocBackendPdfExportOperationIssueV1(
                  "pdf-export-lifecycle-transition-conflict",
                  "transitionId",
                  "transition id is already bound to a different request fingerprint",
                )],
              }
            } else if (request.expectedHeadRevision !== current.head.headRevision) result = {
              status: "stale",
              head: current.head,
              receipt: null,
              issues: [flowDocBackendPdfExportOperationIssueV1(
                "pdf-export-lifecycle-revision-stale",
                "expectedHeadRevision",
                "transition expected revision does not own the current head",
              )],
            }
            else {
              const applied = applyFlowDocBackendPdfExportLifecycleTransitionV1({ head: current.head, request })
              if (applied.status === "blocked") result = {
                status: "blocked",
                head: applied.head ?? current.head,
                receipt: null,
                issues: applied.issues,
              }
              else {
                const update = database.prepare(`
                  UPDATE pdf_export_lifecycle_heads
                  SET head_revision = ?, status = ?, head_fingerprint = ?, head_json = ?
                  WHERE operation_id = ? AND head_revision = ? AND head_fingerprint = ?
                `).run(
                  applied.head.headRevision,
                  applied.head.status,
                  applied.head.lifecycleFingerprint,
                  JSON.stringify(applied.head),
                  request.operationId,
                  current.head.headRevision,
                  current.head.lifecycleFingerprint,
                )
                if (update.changes !== 1) throw new Error("PDF export lifecycle compare-and-swap lost ownership")
                database.prepare(`
                  INSERT INTO pdf_export_lifecycle_transitions (
                    operation_id, transition_id, request_fingerprint, receipt_fingerprint,
                    result_head_fingerprint, receipt_json, result_head_json
                  ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                  request.operationId,
                  request.transitionId,
                  inspected.requestFingerprint,
                  applied.receipt.receiptFingerprint,
                  applied.head.lifecycleFingerprint,
                  JSON.stringify(applied.receipt),
                  JSON.stringify(applied.head),
                )
                changed = true
                result = {
                  status: "applied",
                  head: cloneFlowDocBackendPdfExportJsonV1(applied.head),
                  receipt: cloneFlowDocBackendPdfExportJsonV1(applied.receipt),
                  issues: [],
                }
              }
            }
          }
        }
        if (changed) options.faultInjector?.({
          transactionKind: "lifecycle-transition",
          point: "before-commit",
          operationId: request.operationId,
          transitionId: request.transitionId,
        })
        database.exec("COMMIT")
        if (changed) options.faultInjector?.({
          transactionKind: "lifecycle-transition",
          point: "after-commit",
          operationId: request.operationId,
          transitionId: request.transitionId,
        })
        return result
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK")
        if (isBusyError(error)) return unavailableTransition()
        throw error
      }
    },

    close() {
      database.close()
    },
  }
}

export async function createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1(
  options: FlowDocBackendPdfExportLifecycleSqliteOptionsV1,
): Promise<FlowDocBackendPdfExportLifecycleSqliteRepositoryV1> {
  const database = await openDatabase(options)
  return createRepository(database, options)
}
