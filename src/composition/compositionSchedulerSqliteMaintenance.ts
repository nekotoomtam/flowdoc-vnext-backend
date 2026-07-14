import type { DatabaseSync } from "node:sqlite"
import {
  compositionIssue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS,
  type FlowDocBackendCompositionCleanupResultV1,
} from "./compositionSchedulerProductionRepository.js"
import {
  parseFlowDocBackendCompositionContentRefV1,
  type FlowDocBackendCompositionContentRefV1,
} from "./compositionSchedulerSourcePin.js"
import {
  parseFlowDocBackendCompositionSqliteImmutableRowV1,
  type FlowDocBackendCompositionSqliteImmutableRowV1,
} from "./compositionSchedulerSqliteImmutableStore.js"
import { readFlowDocBackendCompositionSqliteHeadV1 } from "./compositionSchedulerSqliteHeadStore.js"
import {
  runFlowDocBackendCompositionSqliteTransactionV1,
  type FlowDocBackendCompositionSqliteCandidateOptionsV1,
} from "./compositionSchedulerSqliteSupport.js"

interface UsageRow {
  record_count: number
  byte_count: number
}

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u

export function cleanupFlowDocBackendCompositionSqliteUnreachableV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: {
    jobId: string
    expectedHeadFingerprint: string
    reachableRefs: readonly unknown[]
    storedBefore: string
    maximumDeleteCount: number
  },
): FlowDocBackendCompositionCleanupResultV1 {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  if (typeof input.jobId !== "string" || input.jobId.length === 0) issues.push(compositionIssue(
    "composition-cleanup-job-invalid",
    "jobId",
    "cleanup requires an exact job id",
  ))
  if (typeof input.expectedHeadFingerprint !== "string" || !FINGERPRINT.test(input.expectedHeadFingerprint)) {
    issues.push(compositionIssue(
      "composition-cleanup-head-fingerprint-invalid",
      "expectedHeadFingerprint",
      "cleanup requires an exact compact head fingerprint",
    ))
  }
  if (!Number.isFinite(Date.parse(input.storedBefore)) || new Date(input.storedBefore).toISOString() !== input.storedBefore) {
    issues.push(compositionIssue(
      "composition-cleanup-cutoff-invalid",
      "storedBefore",
      "cleanup cutoff must be an exact ISO date-time",
    ))
  }
  if (
    !Number.isInteger(input.maximumDeleteCount) || input.maximumDeleteCount < 1
    || input.maximumDeleteCount > FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS
  ) issues.push(compositionIssue(
    "composition-cleanup-budget-invalid",
    "maximumDeleteCount",
    `cleanup budget must be 1 through ${FLOWDOC_BACKEND_COMPOSITION_MAX_CLEANUP_RECORDS}`,
  ))
  if (!Array.isArray(input.reachableRefs)) issues.push(compositionIssue(
    "composition-cleanup-reachable-invalid",
    "reachableRefs",
    "cleanup requires an exact reachable ref array",
  ))
  const refs = Array.isArray(input.reachableRefs)
    ? input.reachableRefs.map((value, index) => parseFlowDocBackendCompositionContentRefV1(
      value,
      `reachableRefs[${index}]`,
      issues,
    ))
    : []
  if (refs.some((ref) => ref != null && ref.jobId !== input.jobId)) issues.push(compositionIssue(
    "composition-cleanup-reachable-owner-invalid",
    "reachableRefs",
    "every protected ref must belong to the exact cleanup job",
  ))
  if (issues.length > 0) return {
    status: "invalid",
    deletedRefs: null,
    usage: null,
    head: null,
    issues,
  }
  return runFlowDocBackendCompositionSqliteTransactionV1(
    database,
    "cleanup",
    () => {
      const head = readFlowDocBackendCompositionSqliteHeadV1(database, input.jobId)
      if (head.status === "not-found") return {
        status: "not-found" as const,
        deletedRefs: null,
        usage: null,
        head: null,
        issues: head.issues,
      }
      if (head.status === "invalid") return {
        status: "invalid" as const,
        deletedRefs: null,
        usage: null,
        head: null,
        issues: head.issues,
      }
      if (head.status !== "found" || head.head == null) return {
        status: "invalid" as const,
        deletedRefs: null,
        usage: null,
        head: null,
        issues: [compositionIssue(
          "composition-cleanup-head-invalid",
          "jobId",
          "cleanup requires one validated current head",
        )],
      }
      if (!["completed", "blocked", "cancelled", "expired"].includes(head.head.status)) return {
        status: "invalid" as const,
        deletedRefs: null,
        usage: null,
        head: head.head,
        issues: [compositionIssue(
          "composition-cleanup-active-job-blocked",
          "jobHead.status",
          "unreachable cleanup is limited to terminal composition jobs",
        )],
      }
      if (head.head.fingerprint !== input.expectedHeadFingerprint) return {
        status: "stale" as const,
        deletedRefs: null,
        usage: null,
        head: head.head,
        issues: [compositionIssue(
          "composition-cleanup-head-stale",
          "expectedHeadFingerprint",
          "job head changed before unreachable cleanup",
        )],
      }
      database.exec(`
        CREATE TEMP TABLE IF NOT EXISTS composition_cleanup_reachable (
          record_id TEXT PRIMARY KEY
        ) STRICT;
        DELETE FROM composition_cleanup_reachable;
      `)
      const protect = database.prepare(`
        INSERT OR IGNORE INTO composition_cleanup_reachable (record_id) VALUES (?)
      `)
      refs.forEach((ref) => {
        if (ref != null) protect.run(ref.recordId)
      })
      const candidates = database.prepare(`
        SELECT job_id, record_id, kind, record_fingerprint, byte_length, value_json, stored_at
        FROM composition_immutable_records AS item
        WHERE item.job_id = ? AND item.stored_at < ?
          AND NOT EXISTS (
            SELECT 1 FROM composition_cleanup_reachable AS reachable
            WHERE reachable.record_id = item.record_id
          )
        ORDER BY item.stored_at, item.record_id
        LIMIT ?
      `).all(
        input.jobId,
        input.storedBefore,
        input.maximumDeleteCount + 1,
      ) as unknown as FlowDocBackendCompositionSqliteImmutableRowV1[]
      const selected = candidates.slice(0, input.maximumDeleteCount)
      const deletedRefs: FlowDocBackendCompositionContentRefV1[] = []
      let deletedBytes = 0
      const remove = database.prepare(`
        DELETE FROM composition_immutable_records WHERE job_id = ? AND record_id = ?
      `)
      for (const candidate of selected) {
        const parsed = parseFlowDocBackendCompositionSqliteImmutableRowV1(candidate)
        if (parsed == null) throw new Error("cleanup candidate failed immutable record validation")
        const result = remove.run(input.jobId, candidate.record_id)
        if (Number(result.changes) !== 1) throw new Error("cleanup candidate changed during transaction")
        deletedRefs.push(parsed.ref)
        deletedBytes += parsed.ref.byteLength
      }
      if (deletedRefs.length > 0) {
        const usageUpdate = database.prepare(`
          UPDATE composition_physical_usage
          SET record_count = record_count - ?, byte_count = byte_count - ?
          WHERE job_id = ? AND record_count >= ? AND byte_count >= ?
        `).run(deletedRefs.length, deletedBytes, input.jobId, deletedRefs.length, deletedBytes)
        if (Number(usageUpdate.changes) !== 1) throw new Error("cleanup physical usage accounting is inconsistent")
      }
      const current = database.prepare(`
        SELECT record_count, byte_count FROM composition_physical_usage WHERE job_id = ?
      `).get(input.jobId) as UsageRow | undefined ?? { record_count: 0, byte_count: 0 }
      return {
        status: candidates.length > input.maximumDeleteCount ? "budget-exhausted" as const : "completed" as const,
        deletedRefs,
        usage: { recordCount: current.record_count, byteCount: current.byte_count },
        issues: [] as [],
      }
    },
    options.faultInjector,
  )
}
