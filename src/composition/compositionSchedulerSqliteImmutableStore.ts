import type { DatabaseSync } from "node:sqlite"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_BYTES,
  cloneCompositionJson,
  compositionIssue,
  isCompositionRecord,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS,
  FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_WRITE_RECORDS,
  type FlowDocBackendCompositionImmutableBatchReadResultV1,
  type FlowDocBackendCompositionPhysicalAdmissionBatchWriteResultV1,
  type FlowDocBackendCompositionPhysicalAdmissionWriteResultV1,
  type FlowDocBackendCompositionPhysicalUsageResultV1,
} from "./compositionSchedulerProductionRepository.js"
import type {
  FlowDocBackendCompositionImmutableFingerprintReadResultV1,
  FlowDocBackendCompositionImmutableReadResultV1,
} from "./compositionSchedulerRepository.js"
import {
  parseFlowDocBackendCompositionContentRefV1,
  type FlowDocBackendCompositionContentRefV1,
} from "./compositionSchedulerSourcePin.js"
import {
  runFlowDocBackendCompositionSqliteTransactionV1,
  type FlowDocBackendCompositionSqliteCandidateOptionsV1,
} from "./compositionSchedulerSqliteSupport.js"

export interface FlowDocBackendCompositionSqliteImmutableRowV1 {
  job_id: string
  record_id: string
  kind: string
  record_fingerprint: string
  byte_length: number
  value_json: string
  stored_at: string
}

interface PhysicalUsageRow {
  record_count: number
  byte_count: number
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function parseRef(value: unknown): {
  ref: FlowDocBackendCompositionContentRefV1 | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const ref = parseFlowDocBackendCompositionContentRefV1(value, "ref", issues)
  return { ref, issues }
}

function validateImmutableInput(input: { ref: unknown; value: unknown }): {
  ref: FlowDocBackendCompositionContentRefV1 | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const parsed = parseRef(input.ref)
  if (parsed.ref == null) return parsed
  if (!isCompositionRecord(input.value) || input.value.fingerprint !== parsed.ref.recordFingerprint) return {
    ref: null,
    issues: [compositionIssue(
      "composition-immutable-fingerprint-mismatch",
      "value.fingerprint",
      "immutable value must expose the exact referenced fingerprint",
    )],
  }
  if (byteLength(input.value) !== parsed.ref.byteLength) return {
    ref: null,
    issues: [compositionIssue(
      "composition-immutable-byte-length-mismatch",
      "ref.byteLength",
      "immutable ref byte length must equal canonical JSON bytes",
    )],
  }
  return parsed
}

export function readFlowDocBackendCompositionSqliteImmutableRowV1(
  database: DatabaseSync,
  jobId: string,
  recordId: string,
): FlowDocBackendCompositionSqliteImmutableRowV1 | null {
  return database.prepare(`
    SELECT job_id, record_id, kind, record_fingerprint, byte_length, value_json, stored_at
    FROM composition_immutable_records
    WHERE job_id = ? AND record_id = ?
  `).get(jobId, recordId) as FlowDocBackendCompositionSqliteImmutableRowV1 | undefined ?? null
}

function readRowByFingerprint(
  database: DatabaseSync,
  jobId: string,
  kind: string,
  fingerprint: string,
): FlowDocBackendCompositionSqliteImmutableRowV1 | null {
  return database.prepare(`
    SELECT job_id, record_id, kind, record_fingerprint, byte_length, value_json, stored_at
    FROM composition_immutable_records
    WHERE job_id = ? AND kind = ? AND record_fingerprint = ?
  `).get(jobId, kind, fingerprint) as FlowDocBackendCompositionSqliteImmutableRowV1 | undefined ?? null
}

export function parseFlowDocBackendCompositionSqliteImmutableRowV1(
  row: FlowDocBackendCompositionSqliteImmutableRowV1,
): Extract<FlowDocBackendCompositionImmutableReadResultV1, { status: "found" }> | null {
  try {
    const value = JSON.parse(row.value_json) as unknown
    const issues: FlowDocBackendCompositionContractIssue[] = []
    const ref = parseFlowDocBackendCompositionContentRefV1({
      jobId: row.job_id,
      recordId: row.record_id,
      kind: row.kind,
      recordFingerprint: row.record_fingerprint,
      byteLength: row.byte_length,
    }, "ref", issues)
    if (
      ref == null || issues.length > 0 || !isCompositionRecord(value)
      || value.fingerprint !== ref.recordFingerprint || byteLength(value) !== ref.byteLength
    ) return null
    return { status: "found", ref, value: cloneCompositionJson(value), issues: [] }
  } catch {
    return null
  }
}

function usage(database: DatabaseSync, jobId: string): PhysicalUsageRow {
  return database.prepare(`
    SELECT record_count, byte_count FROM composition_physical_usage WHERE job_id = ?
  `).get(jobId) as PhysicalUsageRow | undefined ?? { record_count: 0, byte_count: 0 }
}

export function putFlowDocBackendCompositionSqliteImmutableV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: {
    ref: unknown
    value: unknown
    storedAt: string
    maximumPhysicalByteCount: number | null
  },
): FlowDocBackendCompositionPhysicalAdmissionWriteResultV1 {
  const result = putFlowDocBackendCompositionSqliteImmutableBatchV1(database, options, {
    records: [{ ref: input.ref, value: input.value }],
    storedAt: input.storedAt,
    maximumPhysicalByteCount: input.maximumPhysicalByteCount,
  })
  if (result.status === "written" || result.status === "idempotent-replay") return {
    status: result.status,
    ref: result.refs[0]!,
    issues: [],
  }
  if (result.status === "physical-quota-exceeded" || result.status === "storage-error") return {
    status: result.status,
    ref: null,
    usage: result.usage,
    issues: result.issues,
  }
  return { status: result.status, ref: null, issues: result.issues }
}

export function putFlowDocBackendCompositionSqliteImmutableBatchV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: {
    records: readonly { ref: unknown; value: unknown }[]
    storedAt: string
    maximumPhysicalByteCount: number | null
  },
): FlowDocBackendCompositionPhysicalAdmissionBatchWriteResultV1 {
  if (
    !Array.isArray(input.records) || input.records.length < 1
    || input.records.length > FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_WRITE_RECORDS
  ) return {
    status: "invalid",
    refs: null,
    writtenRecordCount: 0,
    usage: null,
    issues: [compositionIssue(
      "composition-immutable-batch-write-invalid",
      "records",
      `batch writes require 1 through ${FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_WRITE_RECORDS} immutable records`,
    )],
  }
  if (!Number.isFinite(Date.parse(input.storedAt)) || new Date(input.storedAt).toISOString() !== input.storedAt) return {
    status: "invalid",
    refs: null,
    writtenRecordCount: 0,
    usage: null,
    issues: [compositionIssue("composition-immutable-stored-at-invalid", "storedAt", "storedAt must be an exact ISO date-time")],
  }
  if (input.maximumPhysicalByteCount != null && (
    !Number.isInteger(input.maximumPhysicalByteCount) || input.maximumPhysicalByteCount < 1
    || input.maximumPhysicalByteCount > FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_BYTES
  )) return {
    status: "invalid",
    refs: null,
    writtenRecordCount: 0,
    usage: null,
    issues: [compositionIssue(
      "composition-physical-quota-invalid",
      "maximumPhysicalByteCount",
      "physical byte limit must be a positive bounded integer",
    )],
  }
  const refs: FlowDocBackendCompositionContentRefV1[] = []
  const recordIds = new Set<string>()
  const fingerprints = new Set<string>()
  let jobId: string | null = null
  for (let index = 0; index < input.records.length; index += 1) {
    const record = input.records[index]!
    const parsed = validateImmutableInput(record)
    if (parsed.ref == null) return {
      status: "invalid",
      refs: null,
      writtenRecordCount: 0,
      usage: null,
      issues: parsed.issues.map((issue) => ({ ...issue, path: `records[${index}].${issue.path}` })),
    }
    const ref = parsed.ref
    if (jobId == null) jobId = ref.jobId
    if (ref.jobId !== jobId) return {
      status: "invalid",
      refs: null,
      writtenRecordCount: 0,
      usage: null,
      issues: [compositionIssue(
        "composition-immutable-batch-write-owner-invalid",
        `records[${index}].ref.jobId`,
        "every atomic immutable batch record must belong to the same job",
      )],
    }
    const fingerprintKey = `${ref.kind}\u0000${ref.recordFingerprint}`
    if (recordIds.has(ref.recordId) || fingerprints.has(fingerprintKey)) return {
      status: "invalid",
      refs: null,
      writtenRecordCount: 0,
      usage: null,
      issues: [compositionIssue(
        "composition-immutable-batch-write-duplicate",
        `records[${index}].ref`,
        "an atomic immutable batch cannot repeat a record id or kind fingerprint",
      )],
    }
    recordIds.add(ref.recordId)
    fingerprints.add(fingerprintKey)
    refs.push(ref)
  }
  if (jobId == null) throw new Error("validated immutable batch lost its job owner")
  return runFlowDocBackendCompositionSqliteTransactionV1(
    database,
    "immutable-write",
    () => {
      const pending: Array<{ ref: FlowDocBackendCompositionContentRefV1; value: unknown }> = []
      for (let index = 0; index < refs.length; index += 1) {
        const ref = refs[index]!
        const value = input.records[index]!.value
        const current = readFlowDocBackendCompositionSqliteImmutableRowV1(database, ref.jobId, ref.recordId)
        if (current != null) {
          const retained = parseFlowDocBackendCompositionSqliteImmutableRowV1(current)
          if (retained != null && same(retained.ref, ref) && same(retained.value, value)) continue
          return {
            status: "conflict" as const,
            refs: null,
            writtenRecordCount: 0 as const,
            usage: null,
            issues: [compositionIssue(
              "composition-immutable-conflict",
              `records[${index}].ref.recordId`,
              "immutable record id was already used with different content",
            )],
          }
        }
        const fingerprintOwner = readRowByFingerprint(database, ref.jobId, ref.kind, ref.recordFingerprint)
        if (fingerprintOwner != null) return {
          status: "conflict" as const,
          refs: null,
          writtenRecordCount: 0 as const,
          usage: null,
          issues: [compositionIssue(
            "composition-immutable-fingerprint-conflict",
            `records[${index}].ref.recordFingerprint`,
            "immutable fingerprint was already retained under another record id",
          )],
        }
        pending.push({ ref, value })
      }
      const currentUsage = usage(database, jobId)
      const pendingByteCount = pending.reduce((total, record) => total + record.ref.byteLength, 0)
      if (
        input.maximumPhysicalByteCount != null
        && currentUsage.byte_count + pendingByteCount > input.maximumPhysicalByteCount
      ) return {
        status: "physical-quota-exceeded" as const,
        refs: null,
        writtenRecordCount: 0 as const,
        usage: { recordCount: currentUsage.record_count, byteCount: currentUsage.byte_count },
        issues: [compositionIssue(
          "composition-physical-quota-exceeded",
          "maximumPhysicalByteCount",
          "atomic immutable batch would exceed the exact physical byte limit",
        )],
      }
      const insert = database.prepare(`
        INSERT INTO composition_immutable_records (
          job_id, record_id, kind, record_fingerprint, byte_length, value_json, stored_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const record of pending) insert.run(
        record.ref.jobId,
        record.ref.recordId,
        record.ref.kind,
        record.ref.recordFingerprint,
        record.ref.byteLength,
        JSON.stringify(record.value),
        input.storedAt,
      )
      if (pending.length > 0) database.prepare(`
          INSERT INTO composition_physical_usage (job_id, record_count, byte_count)
          VALUES (?, ?, ?)
          ON CONFLICT (job_id) DO UPDATE SET
            record_count = record_count + excluded.record_count,
            byte_count = byte_count + excluded.byte_count
        `).run(jobId, pending.length, pendingByteCount)
      return {
        status: pending.length > 0 ? "written" as const : "idempotent-replay" as const,
        refs: cloneCompositionJson(refs),
        writtenRecordCount: pending.length,
        usage: {
          recordCount: currentUsage.record_count + pending.length,
          byteCount: currentUsage.byte_count + pendingByteCount,
        },
        issues: [] as [],
      }
    },
    options.faultInjector,
  )
}

export function readFlowDocBackendCompositionSqliteImmutableV1(
  database: DatabaseSync,
  input: { jobId: string; recordId: string },
): FlowDocBackendCompositionImmutableReadResultV1 {
  if (typeof input.jobId !== "string" || input.jobId.length === 0 || typeof input.recordId !== "string" || input.recordId.length === 0) {
    return {
      status: "invalid",
      ref: null,
      value: null,
      issues: [compositionIssue("composition-immutable-read-invalid", "", "jobId and recordId are required")],
    }
  }
  const row = readFlowDocBackendCompositionSqliteImmutableRowV1(database, input.jobId, input.recordId)
  if (row == null) return {
    status: "not-found",
    ref: null,
    value: null,
    issues: [compositionIssue("composition-immutable-not-found", "recordId", "immutable record was not found")],
  }
  const parsed = parseFlowDocBackendCompositionSqliteImmutableRowV1(row)
  return parsed ?? {
    status: "invalid",
    ref: null,
    value: null,
    issues: [compositionIssue(
      "composition-immutable-record-invalid",
      "recordId",
      "retained immutable record failed exact ref, fingerprint, or byte validation",
    )],
  }
}

export function readFlowDocBackendCompositionSqliteImmutableByFingerprintV1(
  database: DatabaseSync,
  input: { jobId: string; kind: FlowDocBackendCompositionContentRefV1["kind"]; recordFingerprint: string },
): FlowDocBackendCompositionImmutableFingerprintReadResultV1 {
  const probe = parseRef({
    jobId: input.jobId,
    kind: input.kind,
    recordId: "fingerprint-probe",
    recordFingerprint: input.recordFingerprint,
    byteLength: 1,
  })
  if (probe.ref == null) return { status: "invalid", ref: null, value: null, issues: probe.issues }
  const row = readRowByFingerprint(database, input.jobId, input.kind, input.recordFingerprint)
  if (row == null) return {
    status: "not-found",
    ref: null,
    value: null,
    issues: [compositionIssue(
      "composition-immutable-fingerprint-not-found",
      "recordFingerprint",
      "immutable record fingerprint was not found for the exact job and kind",
    )],
  }
  const parsed = parseFlowDocBackendCompositionSqliteImmutableRowV1(row)
  return parsed ?? {
    status: "invalid",
    ref: null,
    value: null,
    issues: [compositionIssue(
      "composition-immutable-fingerprint-index-invalid",
      "recordFingerprint",
      "immutable fingerprint index does not resolve to an exact retained record",
    )],
  }
}

export function readFlowDocBackendCompositionSqliteImmutableBatchV1(
  database: DatabaseSync,
  input: { jobId: string; refs: readonly unknown[] },
): FlowDocBackendCompositionImmutableBatchReadResultV1 {
  if (
    typeof input.jobId !== "string" || input.jobId.length === 0 || !Array.isArray(input.refs)
    || input.refs.length < 1 || input.refs.length > FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS
  ) return {
    status: "invalid",
    records: null,
    issues: [compositionIssue(
      "composition-immutable-batch-invalid",
      "refs",
      `batch reads require 1 through ${FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_READ_RECORDS} exact refs`,
    )],
  }
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const refs = input.refs.map((value, index) => parseFlowDocBackendCompositionContentRefV1(value, `refs[${index}]`, issues))
  if (issues.length > 0 || refs.some((ref) => ref == null || ref.jobId !== input.jobId)) return {
    status: "invalid",
    records: null,
    issues: issues.length > 0 ? issues : [compositionIssue(
      "composition-immutable-batch-owner-invalid",
      "refs",
      "every batch ref must belong to the exact requested job",
    )],
  }
  const records: Array<Extract<FlowDocBackendCompositionImmutableReadResultV1, { status: "found" }>> = []
  for (const ref of refs) {
    if (ref == null) continue
    const result = readFlowDocBackendCompositionSqliteImmutableV1(database, {
      jobId: ref.jobId,
      recordId: ref.recordId,
    })
    if (result.status !== "found" || !same(result.ref, ref)) return {
      status: result.status === "not-found" ? "not-found" : "invalid",
      records: null,
      issues: result.issues.length > 0 ? result.issues : [compositionIssue(
        "composition-immutable-batch-ref-mismatch",
        "refs",
        "batch result must match each exact requested ref in order",
      )],
    }
    records.push(result)
  }
  return { status: "found", records, issues: [] }
}

export function inspectFlowDocBackendCompositionSqlitePhysicalUsageV1(
  database: DatabaseSync,
  jobId: string,
): FlowDocBackendCompositionPhysicalUsageResultV1 {
  if (typeof jobId !== "string" || jobId.length === 0) return {
    status: "invalid",
    usage: null,
    issues: [compositionIssue("composition-physical-usage-read-invalid", "jobId", "jobId is required")],
  }
  const row = database.prepare(`
    SELECT record_count, byte_count FROM composition_physical_usage WHERE job_id = ?
  `).get(jobId) as PhysicalUsageRow | undefined
  return row == null
    ? {
        status: "not-found",
        usage: null,
        issues: [compositionIssue("composition-physical-usage-not-found", "jobId", "physical usage was not found")],
      }
    : { status: "ready", usage: { recordCount: row.record_count, byteCount: row.byte_count }, issues: [] }
}
