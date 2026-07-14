import type { DatabaseSync } from "node:sqlite"
import { parseVNextDocumentCompositionManifestV1 } from "@flowdoc/vnext-core"
import {
  cloneCompositionJson,
  compositionIssue,
  exactCompositionValue,
  readCompositionRecord,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  parseFlowDocBackendCompositionJobHeadWithValidatedContextV1,
  type FlowDocBackendCompositionJobHeadV1,
} from "./compositionSchedulerJobHead.js"
import type {
  FlowDocBackendCompositionCommittedFinalizationReadResultV1,
  FlowDocBackendCompositionCommittedRequestReadResultV1,
  FlowDocBackendCompositionHeadCompareAndSwapResultV1,
  FlowDocBackendCompositionHeadCreateResultV1,
  FlowDocBackendCompositionHeadReadResultV1,
  FlowDocBackendCompositionRepositoryContextV1,
  FlowDocBackendCompositionRepositoryV1,
} from "./compositionSchedulerRepository.js"
import {
  parseFlowDocBackendCompositionContentRefV1,
  parseFlowDocBackendCompositionSourcePinV1,
  summarizeFlowDocBackendCompositionContentRefsV1,
  type FlowDocBackendCompositionContentRefV1,
} from "./compositionSchedulerSourcePin.js"
import {
  parseFlowDocBackendCompositionSqliteImmutableRowV1,
  readFlowDocBackendCompositionSqliteImmutableRowV1,
} from "./compositionSchedulerSqliteImmutableStore.js"
import {
  runFlowDocBackendCompositionSqliteTransactionV1,
  type FlowDocBackendCompositionSqliteCandidateOptionsV1,
} from "./compositionSchedulerSqliteSupport.js"
import { parseFlowDocBackendCompositionTransitionReceiptWithValidatedOwnersV1 } from "./compositionSchedulerTransitionRecords.js"

interface JobHeadRow {
  job_id: string
  context_json: string
  head_json: string
  head_revision: number
  head_fingerprint: string
  create_request_id: string
  create_request_fingerprint: string
}

interface CommittedRequestRow {
  request_fingerprint: string
  receipt_ref_json: string
  head_json: string
}

interface CommittedFinalizationRow {
  request_fingerprint: string
  page_plan_ref_json: string
  heading_page_map_ref_json: string
  head_json: string
}

interface ParsedOwner {
  context: FlowDocBackendCompositionRepositoryContextV1
  head: FlowDocBackendCompositionJobHeadV1
}

const terminalStatuses = new Set(["completed", "blocked", "cancelled", "expired"])

function readJobRow(database: DatabaseSync, jobId: string): JobHeadRow | null {
  return database.prepare(`
    SELECT job_id, context_json, head_json, head_revision, head_fingerprint,
      create_request_id, create_request_fingerprint
    FROM composition_job_heads
    WHERE job_id = ?
  `).get(jobId) as JobHeadRow | undefined ?? null
}

function parseRef(value: unknown, path: string): {
  ref: FlowDocBackendCompositionContentRefV1 | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const ref = parseFlowDocBackendCompositionContentRefV1(value, path, issues)
  return { ref, issues }
}

function parseOwner(contextValue: unknown, headValue: unknown): {
  owner: ParsedOwner | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const contextIssues: FlowDocBackendCompositionContractIssue[] = []
  const context = readCompositionRecord(contextValue, "context", ["sourcePin", "manifest"], contextIssues)
  const source = parseFlowDocBackendCompositionSourcePinV1(
    context?.sourcePin ?? null,
  )
  const manifest = parseVNextDocumentCompositionManifestV1(
    context?.manifest ?? null,
  )
  const issues: FlowDocBackendCompositionContractIssue[] = [
    ...contextIssues,
    ...(source.status === "blocked" ? source.issues : []),
    ...(manifest.status === "blocked"
      ? manifest.issues.map((item) => compositionIssue(item.code, item.path, item.message))
      : []),
  ]
  if (context == null || contextIssues.length > 0 || source.status === "blocked" || manifest.status === "blocked") {
    return { owner: null, issues }
  }
  const head = parseFlowDocBackendCompositionJobHeadWithValidatedContextV1({
    value: headValue,
    sourcePin: source.sourcePin,
    manifest: manifest.manifest,
  })
  if (head.status === "blocked") return { owner: null, issues: [...issues, ...head.issues] }
  return {
    owner: {
      context: { sourcePin: source.sourcePin, manifest: manifest.manifest },
      head: head.jobHead,
    },
    issues,
  }
}

function parseJobRow(row: JobHeadRow): {
  owner: ParsedOwner | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  try {
    const parsed = parseOwner(JSON.parse(row.context_json), JSON.parse(row.head_json))
    if (
      parsed.owner == null || parsed.owner.context.sourcePin.jobId !== row.job_id
      || parsed.owner.head.headRevision !== row.head_revision
      || parsed.owner.head.fingerprint !== row.head_fingerprint
    ) return {
      owner: null,
      issues: [
        ...parsed.issues,
        compositionIssue(
          "composition-sqlite-head-row-invalid",
          "jobId",
          "SQLite head columns must match the exact validated context and head JSON",
        ),
      ],
    }
    return parsed
  } catch {
    return {
      owner: null,
      issues: [compositionIssue(
        "composition-sqlite-head-json-invalid",
        "head",
        "SQLite context and head must contain parseable canonical JSON",
      )],
    }
  }
}

function invalidHeadRead(issues: FlowDocBackendCompositionContractIssue[]): FlowDocBackendCompositionHeadReadResultV1 {
  return { status: "invalid", context: null, head: null, issues }
}

export function createFlowDocBackendCompositionSqliteHeadV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: Parameters<FlowDocBackendCompositionRepositoryV1["createHead"]>[0],
): FlowDocBackendCompositionHeadCreateResultV1 {
  const source = parseFlowDocBackendCompositionSourcePinV1(input.sourcePin)
  const manifest = parseVNextDocumentCompositionManifestV1(input.manifest)
  if (source.status === "blocked" || manifest.status === "blocked") return {
    status: "invalid",
    head: null,
    issues: [
      ...(source.status === "blocked" ? source.issues : []),
      ...(manifest.status === "blocked"
        ? manifest.issues.map((item) => compositionIssue(item.code, item.path, item.message))
        : []),
    ],
  }
  const parsedHead = parseFlowDocBackendCompositionJobHeadWithValidatedContextV1({
    value: input.head,
    sourcePin: source.sourcePin,
    manifest: manifest.manifest,
  })
  if (parsedHead.status === "blocked") return { status: "invalid", head: null, issues: parsedHead.issues }
  if (
    parsedHead.jobHead.headRevision !== 0 || parsedHead.jobHead.transitionNumber !== 0
    || typeof input.createRequestId !== "string" || input.createRequestId.length === 0
    || typeof input.requestFingerprint !== "string" || !input.requestFingerprint.startsWith("sha256:")
  ) return {
    status: "invalid",
    head: null,
    issues: [compositionIssue(
      "composition-head-create-invalid",
      "head",
      "created head requires revision/transition zero and bounded request identity",
    )],
  }
  return runFlowDocBackendCompositionSqliteTransactionV1(
    database,
    "head-create",
    () => {
      const current = readJobRow(database, source.sourcePin.jobId)
      if (current != null) {
        const parsed = parseJobRow(current)
        if (parsed.owner == null) return { status: "invalid" as const, head: null, issues: parsed.issues }
        return current.create_request_id === input.createRequestId
          && current.create_request_fingerprint === input.requestFingerprint
          ? { status: "idempotent-replay" as const, head: cloneCompositionJson(parsed.owner.head), issues: [] as [] }
          : {
              status: "conflict" as const,
              head: null,
              issues: [compositionIssue(
                "composition-head-create-conflict",
                "jobId",
                "job already exists with different creation identity",
              )],
            }
      }
      const context = { sourcePin: source.sourcePin, manifest: manifest.manifest }
      database.prepare(`
        INSERT INTO composition_job_heads (
          job_id, context_json, head_json, head_revision, head_fingerprint,
          create_request_id, create_request_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        source.sourcePin.jobId,
        JSON.stringify(context),
        JSON.stringify(parsedHead.jobHead),
        parsedHead.jobHead.headRevision,
        parsedHead.jobHead.fingerprint,
        input.createRequestId,
        input.requestFingerprint,
      )
      return { status: "created" as const, head: cloneCompositionJson(parsedHead.jobHead), issues: [] as [] }
    },
    options.faultInjector,
  )
}

export function readFlowDocBackendCompositionSqliteHeadV1(
  database: DatabaseSync,
  jobId: string,
): FlowDocBackendCompositionHeadReadResultV1 {
  const row = readJobRow(database, jobId)
  if (row == null) return {
    status: "not-found",
    context: null,
    head: null,
    issues: [compositionIssue("composition-head-not-found", "jobId", "composition job head was not found")],
  }
  const parsed = parseJobRow(row)
  return parsed.owner == null
    ? invalidHeadRead(parsed.issues)
    : {
        status: "found",
        context: cloneCompositionJson(parsed.owner.context),
        head: cloneCompositionJson(parsed.owner.head),
        issues: [],
      }
}

export function readFlowDocBackendCompositionSqliteCommittedRequestV1(
  database: DatabaseSync,
  input: { jobId: string; requestId: string },
): FlowDocBackendCompositionCommittedRequestReadResultV1 {
  if (typeof input.jobId !== "string" || input.jobId.length === 0 || typeof input.requestId !== "string" || input.requestId.length === 0) {
    return {
      status: "invalid",
      requestFingerprint: null,
      receiptRef: null,
      head: null,
      issues: [compositionIssue("composition-committed-request-read-invalid", "", "jobId and requestId are required")],
    }
  }
  const row = database.prepare(`
    SELECT request_fingerprint, receipt_ref_json, head_json
    FROM composition_committed_requests WHERE job_id = ? AND request_id = ?
  `).get(input.jobId, input.requestId) as CommittedRequestRow | undefined
  if (row == null) return {
    status: "not-found",
    requestFingerprint: null,
    receiptRef: null,
    head: null,
    issues: [],
  }
  const ownerRow = readJobRow(database, input.jobId)
  try {
    const owner = ownerRow == null ? null : parseJobRow(ownerRow)
    const receiptRef = parseRef(JSON.parse(row.receipt_ref_json), "receiptRef")
    const snapshot = owner?.owner == null
      ? null
      : parseFlowDocBackendCompositionJobHeadWithValidatedContextV1({
          value: JSON.parse(row.head_json),
          sourcePin: owner.owner.context.sourcePin,
          manifest: owner.owner.context.manifest,
        })
    const retained = receiptRef.ref == null
      ? null
      : readFlowDocBackendCompositionSqliteImmutableRowV1(database, receiptRef.ref.jobId, receiptRef.ref.recordId)
    if (
      owner?.owner == null || receiptRef.ref == null || snapshot == null || snapshot.status === "blocked"
      || receiptRef.ref.jobId !== input.jobId || receiptRef.ref.kind !== "transition-receipt"
      || retained == null || retained.record_fingerprint !== receiptRef.ref.recordFingerprint
      || snapshot.jobHead.chain.transitionReceiptTipFingerprint !== receiptRef.ref.recordFingerprint
    ) return {
      status: "invalid",
      requestFingerprint: null,
      receiptRef: null,
      head: null,
      issues: [
        ...(owner?.issues ?? []),
        ...receiptRef.issues,
        ...(snapshot?.status === "blocked" ? snapshot.issues : []),
        compositionIssue(
          "composition-committed-request-invalid",
          "requestId",
          "committed request must retain a validated head snapshot and reachable exact receipt",
        ),
      ],
    }
    return {
      status: "found",
      requestFingerprint: row.request_fingerprint,
      receiptRef: cloneCompositionJson(receiptRef.ref),
      head: cloneCompositionJson(snapshot.jobHead),
      issues: [],
    }
  } catch {
    return {
      status: "invalid",
      requestFingerprint: null,
      receiptRef: null,
      head: null,
      issues: [compositionIssue("composition-committed-request-invalid", "requestId", "committed request JSON is invalid")],
    }
  }
}

export function readFlowDocBackendCompositionSqliteCommittedFinalizationV1(
  database: DatabaseSync,
  input: { jobId: string; requestId: string },
): FlowDocBackendCompositionCommittedFinalizationReadResultV1 {
  if (typeof input.jobId !== "string" || input.jobId.length === 0 || typeof input.requestId !== "string" || input.requestId.length === 0) {
    return {
      status: "invalid",
      requestFingerprint: null,
      pagePlanRef: null,
      headingPageMapRef: null,
      head: null,
      issues: [compositionIssue("composition-finalization-request-read-invalid", "", "jobId and requestId are required")],
    }
  }
  const row = database.prepare(`
    SELECT request_fingerprint, page_plan_ref_json, heading_page_map_ref_json, head_json
    FROM composition_committed_finalizations WHERE job_id = ? AND request_id = ?
  `).get(input.jobId, input.requestId) as CommittedFinalizationRow | undefined
  if (row == null) return {
    status: "not-found",
    requestFingerprint: null,
    pagePlanRef: null,
    headingPageMapRef: null,
    head: null,
    issues: [],
  }
  const ownerRow = readJobRow(database, input.jobId)
  try {
    const owner = ownerRow == null ? null : parseJobRow(ownerRow)
    const plan = parseRef(JSON.parse(row.page_plan_ref_json), "pagePlanRef")
    const map = parseRef(JSON.parse(row.heading_page_map_ref_json), "headingPageMapRef")
    const snapshot = owner?.owner == null
      ? null
      : parseFlowDocBackendCompositionJobHeadWithValidatedContextV1({
          value: JSON.parse(row.head_json),
          sourcePin: owner.owner.context.sourcePin,
          manifest: owner.owner.context.manifest,
        })
    const retainedPlan = plan.ref == null ? null : readFlowDocBackendCompositionSqliteImmutableRowV1(database, plan.ref.jobId, plan.ref.recordId)
    const retainedMap = map.ref == null ? null : readFlowDocBackendCompositionSqliteImmutableRowV1(database, map.ref.jobId, map.ref.recordId)
    if (
      owner?.owner == null || plan.ref == null || map.ref == null || snapshot == null || snapshot.status === "blocked"
      || plan.ref.jobId !== input.jobId || plan.ref.kind !== "page-plan" || retainedPlan == null
      || map.ref.jobId !== input.jobId || map.ref.kind !== "heading-page-map" || retainedMap == null
      || snapshot.jobHead.status !== "completed" || snapshot.jobHead.finalOutput == null
      || !exactCompositionValue(snapshot.jobHead.finalOutput.pagePlanRef, plan.ref)
      || !exactCompositionValue(snapshot.jobHead.finalOutput.headingPageMapRef, map.ref)
    ) return {
      status: "invalid",
      requestFingerprint: null,
      pagePlanRef: null,
      headingPageMapRef: null,
      head: null,
      issues: [
        ...(owner?.issues ?? []),
        ...plan.issues,
        ...map.issues,
        ...(snapshot?.status === "blocked" ? snapshot.issues : []),
        compositionIssue(
          "composition-finalization-request-invalid",
          "requestId",
          "finalization request must retain validated output refs and its completed head snapshot",
        ),
      ],
    }
    return {
      status: "found",
      requestFingerprint: row.request_fingerprint,
      pagePlanRef: cloneCompositionJson(plan.ref),
      headingPageMapRef: cloneCompositionJson(map.ref),
      head: cloneCompositionJson(snapshot.jobHead),
      issues: [],
    }
  } catch {
    return {
      status: "invalid",
      requestFingerprint: null,
      pagePlanRef: null,
      headingPageMapRef: null,
      head: null,
      issues: [compositionIssue("composition-finalization-request-invalid", "requestId", "finalization request JSON is invalid")],
    }
  }
}

export function compareAndSwapFlowDocBackendCompositionSqliteHeadV1(
  database: DatabaseSync,
  options: FlowDocBackendCompositionSqliteCandidateOptionsV1,
  input: Parameters<FlowDocBackendCompositionRepositoryV1["compareAndSwapHead"]>[0],
): FlowDocBackendCompositionHeadCompareAndSwapResultV1 {
  return runFlowDocBackendCompositionSqliteTransactionV1(
    database,
    "head-cas",
    () => {
      const row = readJobRow(database, input.jobId)
      if (row == null) return {
        status: "not-found" as const,
        head: null,
        issues: [compositionIssue("composition-head-not-found", "jobId", "composition job head was not found")],
      }
      const parsed = parseJobRow(row)
      if (parsed.owner == null) return { status: "invalid" as const, head: null, issues: parsed.issues }
      const stored = parsed.owner
      if (input.committedRequest != null && input.committedFinalization != null) return {
        status: "invalid" as const,
        head: null,
        issues: [compositionIssue(
          "composition-head-commit-kind-invalid",
          "",
          "one head commit cannot retain transition and finalization requests together",
        )],
      }
      if (input.committedRequest != null) {
        const replay = database.prepare(`
          SELECT request_fingerprint, head_json FROM composition_committed_requests
          WHERE job_id = ? AND request_id = ?
        `).get(input.jobId, input.committedRequest.requestId) as Pick<CommittedRequestRow, "request_fingerprint" | "head_json"> | undefined
        if (replay != null) {
          const replayHead = parseFlowDocBackendCompositionJobHeadWithValidatedContextV1({
            value: JSON.parse(replay.head_json),
            sourcePin: stored.context.sourcePin,
            manifest: stored.context.manifest,
          })
          if (replayHead.status === "blocked") return { status: "invalid" as const, head: null, issues: replayHead.issues }
          return replay.request_fingerprint === input.committedRequest.requestFingerprint
            ? { status: "idempotent-replay" as const, head: replayHead.jobHead, issues: [] as [] }
            : {
                status: "conflict" as const,
                head: null,
                issues: [compositionIssue(
                  "composition-transition-request-conflict",
                  "committedRequest.requestId",
                  "transition request id was already committed with different content",
                )],
              }
        }
      }
      if (input.committedFinalization != null) {
        const replay = database.prepare(`
          SELECT request_fingerprint, head_json FROM composition_committed_finalizations
          WHERE job_id = ? AND request_id = ?
        `).get(input.jobId, input.committedFinalization.requestId) as Pick<CommittedFinalizationRow, "request_fingerprint" | "head_json"> | undefined
        if (replay != null) {
          const replayHead = parseFlowDocBackendCompositionJobHeadWithValidatedContextV1({
            value: JSON.parse(replay.head_json),
            sourcePin: stored.context.sourcePin,
            manifest: stored.context.manifest,
          })
          if (replayHead.status === "blocked") return { status: "invalid" as const, head: null, issues: replayHead.issues }
          return replay.request_fingerprint === input.committedFinalization.requestFingerprint
            ? { status: "idempotent-replay" as const, head: replayHead.jobHead, issues: [] as [] }
            : {
                status: "conflict" as const,
                head: null,
                issues: [compositionIssue(
                  "composition-finalization-request-conflict",
                  "committedFinalization.requestId",
                  "finalization request id was already committed with different content",
                )],
              }
        }
      }
      if (
        stored.head.headRevision !== input.expectedHeadRevision
        || stored.head.fingerprint !== input.expectedHeadFingerprint
      ) return {
        status: "stale" as const,
        head: cloneCompositionJson(stored.head),
        issues: [compositionIssue("composition-head-stale", "expectedHeadRevision", "job head changed before compare-and-swap")],
      }
      const next = parseFlowDocBackendCompositionJobHeadWithValidatedContextV1({
        value: input.nextHead,
        sourcePin: stored.context.sourcePin,
        manifest: stored.context.manifest,
      })
      if (next.status === "blocked") return { status: "invalid" as const, head: null, issues: next.issues }
      if (
        next.jobHead.headRevision !== stored.head.headRevision + 1
        || next.jobHead.transitionNumber < stored.head.transitionNumber
        || next.jobHead.transitionNumber > stored.head.transitionNumber + 1
        || next.jobHead.sourcePinFingerprint !== stored.head.sourcePinFingerprint
        || next.jobHead.manifestFingerprint !== stored.head.manifestFingerprint
        || terminalStatuses.has(stored.head.status)
      ) return {
        status: "invalid" as const,
        head: null,
        issues: [compositionIssue(
          "composition-head-transition-invalid",
          "nextHead",
          "next head must advance one revision, preserve owners, and not leave a terminal state",
        )],
      }
      if (input.committedRequest != null) {
        const request = input.committedRequest
        const refResult = parseRef(request.receiptRef, "committedRequest.receiptRef")
        const retainedRow = refResult.ref == null
          ? null
          : readFlowDocBackendCompositionSqliteImmutableRowV1(database, refResult.ref.jobId, refResult.ref.recordId)
        const retained = retainedRow == null ? null : parseFlowDocBackendCompositionSqliteImmutableRowV1(retainedRow)
        const receipt = retained == null ? null : parseFlowDocBackendCompositionTransitionReceiptWithValidatedOwnersV1({
          value: retained.value,
          sourcePin: stored.context.sourcePin,
          manifest: stored.context.manifest,
        })
        if (
          refResult.ref == null || retained == null || refResult.ref.jobId !== input.jobId
          || refResult.ref.kind !== "transition-receipt"
          || next.jobHead.chain.transitionReceiptTipFingerprint !== refResult.ref.recordFingerprint
          || receipt == null || receipt.status === "blocked"
        ) return {
          status: "invalid" as const,
          head: null,
          issues: [compositionIssue(
            "composition-committed-receipt-invalid",
            "committedRequest.receiptRef",
            "committed request requires a retained exact receipt reachable from the next head",
          )],
        }
        const delta = summarizeFlowDocBackendCompositionContentRefsV1([
          refResult.ref,
          ...(receipt.receipt.windowRef == null ? [] : [receipt.receipt.windowRef]),
          ...(receipt.receipt.pageChunkRef == null ? [] : [receipt.receipt.pageChunkRef]),
        ])
        if (!exactCompositionValue(next.jobHead.retention, {
          recordCount: stored.head.retention.recordCount + delta.recordCount,
          byteCount: stored.head.retention.byteCount + delta.byteCount,
        })) return {
          status: "invalid" as const,
          head: null,
          issues: [compositionIssue(
            "composition-transition-retention-invalid",
            "nextHead.retention",
            "transition commit must add the exact retained receipt, window, and page chunk bytes",
          )],
        }
      }
      if (input.committedFinalization != null) {
        const request = input.committedFinalization
        const plan = parseRef(request.pagePlanRef, "committedFinalization.pagePlanRef")
        const map = parseRef(request.headingPageMapRef, "committedFinalization.headingPageMapRef")
        const retainedPlan = plan.ref == null ? null : readFlowDocBackendCompositionSqliteImmutableRowV1(database, plan.ref.jobId, plan.ref.recordId)
        const retainedMap = map.ref == null ? null : readFlowDocBackendCompositionSqliteImmutableRowV1(database, map.ref.jobId, map.ref.recordId)
        if (
          plan.ref == null || map.ref == null || retainedPlan == null || retainedMap == null
          || plan.ref.jobId !== input.jobId || plan.ref.kind !== "page-plan"
          || map.ref.jobId !== input.jobId || map.ref.kind !== "heading-page-map"
          || next.jobHead.status !== "completed" || next.jobHead.finalOutput == null
          || !exactCompositionValue(next.jobHead.finalOutput.pagePlanRef, plan.ref)
          || !exactCompositionValue(next.jobHead.finalOutput.headingPageMapRef, map.ref)
        ) return {
          status: "invalid" as const,
          head: null,
          issues: [compositionIssue(
            "composition-committed-finalization-invalid",
            "committedFinalization",
            "committed finalization requires retained exact outputs reachable from the completed head",
          )],
        }
        const delta = summarizeFlowDocBackendCompositionContentRefsV1([plan.ref, map.ref])
        if (!exactCompositionValue(next.jobHead.retention, {
          recordCount: stored.head.retention.recordCount + delta.recordCount,
          byteCount: stored.head.retention.byteCount + delta.byteCount,
        })) return {
          status: "invalid" as const,
          head: null,
          issues: [compositionIssue(
            "composition-finalization-retention-invalid",
            "nextHead.retention",
            "finalization commit must add the exact retained output bytes",
          )],
        }
      }
      if (
        input.committedRequest == null && input.committedFinalization == null
        && !exactCompositionValue(next.jobHead.retention, stored.head.retention)
      ) return {
        status: "invalid" as const,
        head: null,
        issues: [compositionIssue(
          "composition-head-retention-mutation-invalid",
          "nextHead.retention",
          "non-content head transitions must preserve exact retention accounting",
        )],
      }
      const updated = database.prepare(`
        UPDATE composition_job_heads
        SET head_json = ?, head_revision = ?, head_fingerprint = ?
        WHERE job_id = ? AND head_revision = ? AND head_fingerprint = ?
      `).run(
        JSON.stringify(next.jobHead),
        next.jobHead.headRevision,
        next.jobHead.fingerprint,
        input.jobId,
        input.expectedHeadRevision,
        input.expectedHeadFingerprint,
      )
      if (Number(updated.changes) !== 1) return {
        status: "stale" as const,
        head: cloneCompositionJson(stored.head),
        issues: [compositionIssue("composition-head-stale", "expectedHeadRevision", "job head changed before compare-and-swap")],
      }
      if (input.committedRequest != null) database.prepare(`
        INSERT INTO composition_committed_requests (
          job_id, request_id, request_fingerprint, receipt_ref_json, head_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        input.jobId,
        input.committedRequest.requestId,
        input.committedRequest.requestFingerprint,
        JSON.stringify(input.committedRequest.receiptRef),
        JSON.stringify(next.jobHead),
      )
      if (input.committedFinalization != null) database.prepare(`
        INSERT INTO composition_committed_finalizations (
          job_id, request_id, request_fingerprint, page_plan_ref_json,
          heading_page_map_ref_json, head_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.jobId,
        input.committedFinalization.requestId,
        input.committedFinalization.requestFingerprint,
        JSON.stringify(input.committedFinalization.pagePlanRef),
        JSON.stringify(input.committedFinalization.headingPageMapRef),
        JSON.stringify(next.jobHead),
      )
      return { status: "committed" as const, head: cloneCompositionJson(next.jobHead), issues: [] as [] }
    },
    options.faultInjector,
  )
}
