import type { Pool, PoolClient } from "pg"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_MAX_COUNT,
  FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
  type FlowDocBackendPdfExportDueWorkEntryV1,
  type FlowDocBackendPdfExportDueWorkListResultV1,
  type FlowDocBackendPdfExportDueWorkRepositoryV1,
} from "./pdfExportDueWork.js"
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
import {
  beginFlowDocBackendPdfExportPostgresTransactionV1,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
  isFlowDocBackendPdfExportPostgresUnavailableErrorV1,
  type FlowDocBackendPdfExportPostgresQueryableV1,
} from "./pdfExportLocalPostgresSupport.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_POSTGRES_V1_SOURCE =
  "flowdoc-backend-pdf-export-lifecycle-postgres" as const

export type FlowDocBackendPdfExportLifecyclePostgresFaultPointV1 = "before-commit" | "after-commit"

export interface FlowDocBackendPdfExportLifecyclePostgresFaultContextV1 {
  transactionKind: "lifecycle-initialize" | "lifecycle-transition"
  point: FlowDocBackendPdfExportLifecyclePostgresFaultPointV1
  operationId: string
  transitionId: string | null
}

export interface FlowDocBackendPdfExportLifecyclePostgresOptionsV1 {
  pool: Pool
  lockTimeoutMs: number
  faultInjector?: (context: FlowDocBackendPdfExportLifecyclePostgresFaultContextV1) => void | Promise<void>
}

export interface FlowDocBackendPdfExportLifecyclePostgresRepositoryV1
extends FlowDocBackendPdfExportLifecycleRepositoryV1, FlowDocBackendPdfExportDueWorkRepositoryV1 {
  postgresSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_POSTGRES_V1_SOURCE
  localPostgresSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE
  productionBinding: false
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
  checkpoint: string
  next_action_at: string
  deadline_at: string
  claim_expires_at: string | null
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

const SELECT_HEAD = `
  SELECT operation_id, tenant_id, principal_id, operation_fingerprint,
    admission_fingerprint, payload_fingerprint, head_revision, status,
    checkpoint, next_action_at, deadline_at, claim_expires_at,
    head_fingerprint, head_json
  FROM flowdoc_pdf_export_lifecycle_heads_v1
`

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

function nextActionAt(head: FlowDocBackendPdfExportLifecycleHeadV1): string {
  if (head.status === "pending") return head.retryAfter ?? head.updatedAt
  if (head.status === "claimed") return head.claim?.expiresAt ?? head.deadlineAt
  return head.updatedAt
}

function unavailableInitialize(): FlowDocBackendPdfExportLifecycleInitializeResultV1 {
  return {
    status: "storage-unavailable",
    head: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-postgres-unavailable",
      "repository",
      "local PostgreSQL lifecycle initialization is unavailable within its bounded wait",
    )],
  }
}

function unavailableRead(): FlowDocBackendPdfExportLifecycleReadResultV1 {
  return {
    status: "storage-unavailable",
    head: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-postgres-unavailable",
      "repository",
      "local PostgreSQL lifecycle read is unavailable within its bounded wait",
    )],
  }
}

function unavailableTransition(): FlowDocBackendPdfExportLifecycleTransitionResultV1 {
  return {
    status: "storage-unavailable",
    head: null,
    receipt: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-lifecycle-postgres-unavailable",
      "repository",
      "local PostgreSQL lifecycle transition is unavailable within its bounded wait",
    )],
  }
}

function unavailableDueWork(): FlowDocBackendPdfExportDueWorkListResultV1 {
  return {
    status: "storage-unavailable",
    observedAt: null,
    entries: [],
    nextCursor: null,
    issues: [flowDocBackendPdfExportOperationIssueV1(
      "pdf-export-due-work-postgres-unavailable",
      "repository",
      "local PostgreSQL due-work discovery is unavailable within its bounded wait",
    )],
  }
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
    || head.checkpoint !== row.checkpoint
    || nextActionAt(head) !== row.next_action_at
    || head.deadlineAt !== row.deadline_at
    || (head.claim?.expiresAt ?? null) !== row.claim_expires_at
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
  const valid = receipt.source === FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_TRANSITION_V1_SOURCE
    && receipt.contractVersion === FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_V1_VERSION
    && receipt.kind === "pdf-export-lifecycle-transition-receipt"
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

async function rowByOperationId(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  operationId: string,
  forUpdate = false,
): Promise<StoredHeadRowV1 | undefined> {
  const result = await queryable.query<StoredHeadRowV1>(`${SELECT_HEAD}
    WHERE operation_id = $1${forUpdate ? " FOR UPDATE" : ""}
  `, [operationId])
  return result.rows[0]
}

async function rowByTransitionId(
  queryable: FlowDocBackendPdfExportPostgresQueryableV1,
  operationId: string,
  transitionId: string,
): Promise<StoredTransitionRowV1 | undefined> {
  const result = await queryable.query<StoredTransitionRowV1>(`
    SELECT operation_id, transition_id, request_fingerprint, receipt_fingerprint,
      result_head_fingerprint, receipt_json, result_head_json
    FROM flowdoc_pdf_export_lifecycle_transitions_v1
    WHERE operation_id = $1 AND transition_id = $2
  `, [operationId, transitionId])
  return result.rows[0]
}

async function insertHead(client: PoolClient, head: FlowDocBackendPdfExportLifecycleHeadV1): Promise<boolean> {
  const inserted = await client.query<{ operation_id: string }>(`
    INSERT INTO flowdoc_pdf_export_lifecycle_heads_v1 (
      operation_id, tenant_id, principal_id, operation_fingerprint,
      admission_fingerprint, payload_fingerprint, head_revision, status,
      checkpoint, next_action_at, deadline_at, claim_expires_at,
      head_fingerprint, head_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (operation_id) DO NOTHING
    RETURNING operation_id
  `, [
    head.operationId,
    head.scope.tenantId,
    head.scope.principalId,
    head.operationFingerprint,
    head.admissionFingerprint,
    head.payloadFingerprint,
    head.headRevision,
    head.status,
    head.checkpoint,
    nextActionAt(head),
    head.deadlineAt,
    head.claim?.expiresAt ?? null,
    head.lifecycleFingerprint,
    JSON.stringify(head),
  ])
  return inserted.rowCount === 1
}

export function createFlowDocBackendPdfExportLifecyclePostgresRepositoryV1(
  options: FlowDocBackendPdfExportLifecyclePostgresOptionsV1,
): FlowDocBackendPdfExportLifecyclePostgresRepositoryV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_REPOSITORY_V1_SOURCE,
    dueWorkSource: FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
    postgresSource: FLOWDOC_BACKEND_PDF_EXPORT_LIFECYCLE_POSTGRES_V1_SOURCE,
    localPostgresSource: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_POSTGRES_V1_SOURCE,
    productionBinding: false,

    async listDueWork(input) {
      const cursorValid = input.cursor == null || (
        exactIso(input.cursor.dueAt)
        && isFlowDocBackendPdfExportBoundedStringV1(input.cursor.operationId)
      )
      if (
        !exactIso(input.observedAt)
        || !Number.isSafeInteger(input.maxCount)
        || input.maxCount < 1
        || input.maxCount > FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_MAX_COUNT
        || !cursorValid
      ) return {
        status: "invalid",
        observedAt: null,
        entries: [],
        nextCursor: null,
        issues: [flowDocBackendPdfExportOperationIssueV1(
          "pdf-export-due-work-input-invalid",
          "dueWork",
          "due-work discovery requires an exact time, bounded count, and exact keyset cursor",
        )],
      }
      try {
        const result = await options.pool.query<StoredHeadRowV1>(`
          SELECT h.operation_id, h.tenant_id, h.principal_id, h.operation_fingerprint,
            h.admission_fingerprint, h.payload_fingerprint, h.head_revision, h.status,
            h.checkpoint, h.next_action_at, h.deadline_at, h.claim_expires_at,
            h.head_fingerprint, h.head_json
          FROM flowdoc_pdf_export_lifecycle_heads_v1 h
          LEFT JOIN flowdoc_pdf_export_workflow_completions_v1 c
            ON c.operation_id = h.operation_id
          WHERE c.operation_id IS NULL
            AND h.status IN ('pending', 'claimed', 'stopped')
            AND h.next_action_at <= $1
            AND (
              $2::text IS NULL
              OR (h.next_action_at, h.operation_id) > ($2::text, $3::text)
            )
          ORDER BY h.next_action_at ASC, h.operation_id ASC
          LIMIT $4
        `, [
          input.observedAt,
          input.cursor?.dueAt ?? null,
          input.cursor?.operationId ?? null,
          input.maxCount + 1,
        ])
        const parsedEntries: FlowDocBackendPdfExportDueWorkEntryV1[] = []
        for (const row of result.rows.slice(0, input.maxCount)) {
          const parsed = parseStoredHead(row)
          if (parsed.status !== "found") return {
            status: "invalid",
            observedAt: null,
            entries: [],
            nextCursor: null,
            issues: parsed.issues,
          }
          const head = parsed.head
          parsedEntries.push({
            source: FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE,
            operationId: head.operationId,
            scope: cloneFlowDocBackendPdfExportJsonV1(head.scope),
            dueAt: row.next_action_at,
            lane: head.status === "pending"
              ? "claim-ready"
              : head.status === "claimed"
                ? "claim-expired"
                : "terminal-finalization",
            headRevision: head.headRevision,
            lifecycleFingerprint: head.lifecycleFingerprint,
            head,
          })
        }
        const last = parsedEntries.at(-1)
        return {
          status: "ready",
          observedAt: input.observedAt,
          entries: parsedEntries,
          nextCursor: result.rows.length > input.maxCount && last != null
            ? { dueAt: last.dueAt, operationId: last.operationId }
            : null,
          issues: [],
        }
      } catch (error) {
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableDueWork()
        throw error
      }
    },

    async initializeLifecycle(value) {
      const parsedOperation = parseFlowDocBackendPdfExportOperationV1(value)
      if (parsedOperation.status === "blocked") return {
        status: "invalid",
        head: null,
        issues: parsedOperation.issues,
      }
      const created = createFlowDocBackendPdfExportLifecycleHeadV1(parsedOperation.operation)
      if (created.status === "blocked") return { status: "invalid", head: null, issues: created.issues }
      let client: PoolClient | null = null
      let committed = false
      try {
        client = await options.pool.connect()
        await beginFlowDocBackendPdfExportPostgresTransactionV1(client, options.lockTimeoutMs)
        const inserted = await insertHead(client, created.head)
        let result: FlowDocBackendPdfExportLifecycleInitializeResultV1
        if (inserted) result = {
          status: "created",
          head: cloneFlowDocBackendPdfExportJsonV1(created.head),
          issues: [],
        }
        else {
          const existingRow = await rowByOperationId(client, parsedOperation.operation.operationId, true)
          if (existingRow == null) throw new Error("local PostgreSQL lifecycle conflict did not retain an owner")
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
        }
        if (inserted) await options.faultInjector?.({
          transactionKind: "lifecycle-initialize",
          point: "before-commit",
          operationId: parsedOperation.operation.operationId,
          transitionId: null,
        })
        await client.query("COMMIT")
        committed = true
        if (inserted) await options.faultInjector?.({
          transactionKind: "lifecycle-initialize",
          point: "after-commit",
          operationId: parsedOperation.operation.operationId,
          transitionId: null,
        })
        return result
      } catch (error) {
        if (!committed && client != null) await client.query("ROLLBACK").catch(() => undefined)
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableInitialize()
        throw error
      } finally {
        client?.release()
      }
    },

    async readLifecycle(input) {
      if (!validScope(input) || !isFlowDocBackendPdfExportBoundedStringV1(input.operationId)) return invalidRead()
      try {
        const row = await rowByOperationId(options.pool, input.operationId)
        if (row == null || row.tenant_id !== input.tenantId || row.principal_id !== input.principalId) {
          return { status: "not-found", head: null, issues: [] }
        }
        return parseStoredHead(row)
      } catch (error) {
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableRead()
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
      let client: PoolClient | null = null
      let committed = false
      try {
        client = await options.pool.connect()
        await beginFlowDocBackendPdfExportPostgresTransactionV1(client, options.lockTimeoutMs)
        const currentRow = await rowByOperationId(client, request.operationId, true)
        let changed = false
        let result: FlowDocBackendPdfExportLifecycleTransitionResultV1
        if (
          currentRow == null
          || currentRow.tenant_id !== request.tenantId
          || currentRow.principal_id !== request.principalId
        ) result = { status: "not-found", head: null, receipt: null, issues: [] }
        else {
          const current = parseStoredHead(currentRow)
          if (current.status !== "found") result = {
            status: "invalid",
            head: null,
            receipt: null,
            issues: current.issues,
          }
          else {
            const replayRow = await rowByTransitionId(client, request.operationId, request.transitionId)
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
                const update = await client.query(`
                  UPDATE flowdoc_pdf_export_lifecycle_heads_v1
                  SET head_revision = $1, status = $2, checkpoint = $3,
                    next_action_at = $4, deadline_at = $5, claim_expires_at = $6,
                    head_fingerprint = $7, head_json = $8
                  WHERE operation_id = $9 AND head_revision = $10 AND head_fingerprint = $11
                `, [
                  applied.head.headRevision,
                  applied.head.status,
                  applied.head.checkpoint,
                  nextActionAt(applied.head),
                  applied.head.deadlineAt,
                  applied.head.claim?.expiresAt ?? null,
                  applied.head.lifecycleFingerprint,
                  JSON.stringify(applied.head),
                  request.operationId,
                  current.head.headRevision,
                  current.head.lifecycleFingerprint,
                ])
                if (update.rowCount !== 1) throw new Error("local PostgreSQL lifecycle compare-and-swap lost ownership")
                await client.query(`
                  INSERT INTO flowdoc_pdf_export_lifecycle_transitions_v1 (
                    operation_id, transition_id, request_fingerprint, receipt_fingerprint,
                    result_head_fingerprint, receipt_json, result_head_json
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                  request.operationId,
                  request.transitionId,
                  inspected.requestFingerprint,
                  applied.receipt.receiptFingerprint,
                  applied.head.lifecycleFingerprint,
                  JSON.stringify(applied.receipt),
                  JSON.stringify(applied.head),
                ])
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
        if (changed) await options.faultInjector?.({
          transactionKind: "lifecycle-transition",
          point: "before-commit",
          operationId: request.operationId,
          transitionId: request.transitionId,
        })
        await client.query("COMMIT")
        committed = true
        if (changed) await options.faultInjector?.({
          transactionKind: "lifecycle-transition",
          point: "after-commit",
          operationId: request.operationId,
          transitionId: request.transitionId,
        })
        return result
      } catch (error) {
        if (!committed && client != null) await client.query("ROLLBACK").catch(() => undefined)
        if (isFlowDocBackendPdfExportPostgresUnavailableErrorV1(error)) return unavailableTransition()
        throw error
      } finally {
        client?.release()
      }
    },
  }
}
