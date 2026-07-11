import {
  applyVNextPackageV2ToV3Migration,
  planVNextPackageV2ToV3Migration,
} from "@flowdoc/vnext-core"
import type {
  BackendMigrationIssue,
  BackendMigrationRequest,
  BackendMigrationResultEnvelope,
} from "../contracts/migration.js"
import type { BackendMigrationReceipt, BackendPackageRepository } from "../storage/packageRepository.js"
import { isBackendActivePackage } from "../storage/packageRepository.js"

export interface ExecuteBackendMigrationOptions {
  now?: () => number
  repository: BackendPackageRepository
}

function issue(code: string, message: string, path = ""): BackendMigrationIssue {
  return { code, message, path, severity: "error" }
}

function receiptResult(
  request: BackendMigrationRequest,
  receipt: BackendMigrationReceipt,
  requestedAt: number,
  receivedAt: number,
  idempotency: "new" | "replayed",
): BackendMigrationResultEnvelope {
  return {
    baseRevision: request.baseRevision,
    documentId: request.documentId,
    idempotency,
    issues: [],
    receivedAt,
    requestId: request.requestId,
    requestedAt,
    revision: receipt.record.revision,
    sourceSnapshot: {
      retainedAt: receipt.snapshot.retainedAt,
      sourceRevision: receipt.snapshot.sourceRevision,
      targetRevision: receipt.snapshot.targetRevision,
    },
    status: "applied",
    summary: {
      changeCount: receipt.changeCount,
      errorCount: receipt.summary.errorCount,
      normalizedTextBlockCount: receipt.summary.normalizedTextBlockCount,
      warningCount: receipt.summary.warningCount,
    },
    target: { packageVersion: 3, documentVersion: 4 },
  }
}

function requestFingerprint(request: BackendMigrationRequest): string {
  return JSON.stringify({
    baseRevision: request.baseRevision,
    documentId: request.documentId,
    reason: request.reason ?? null,
    requestId: request.requestId,
    source: request.source,
  })
}

export async function executeBackendMigration(
  request: BackendMigrationRequest,
  options: ExecuteBackendMigrationOptions,
): Promise<BackendMigrationResultEnvelope> {
  const requestedAt = options.now?.() ?? Date.now()
  const replay = await options.repository.readMigrationReceipt(request.documentId, request.requestId)
  const replayReceivedAt = options.now?.() ?? Date.now()
  if (replay) {
    if (replay.requestFingerprint !== requestFingerprint(request)) {
      return {
        baseRevision: request.baseRevision,
        documentId: request.documentId,
        idempotency: null,
        issues: [issue("idempotency-conflict", "requestId was already used with a different migration payload", "requestId")],
        receivedAt: replayReceivedAt,
        requestId: request.requestId,
        requestedAt,
        revision: replay.record.revision,
        sourceSnapshot: null,
        status: "rejected",
        summary: null,
        target: null,
      }
    }
    return receiptResult(request, replay, requestedAt, replayReceivedAt, "replayed")
  }

  const current = await options.repository.read(request.documentId)
  const receivedAt = options.now?.() ?? Date.now()
  const base = {
    baseRevision: request.baseRevision,
    documentId: request.documentId,
    idempotency: null,
    receivedAt,
    requestId: request.requestId,
    requestedAt,
    sourceSnapshot: null,
    summary: null,
    target: null,
  } as const
  if (!current) {
    return { ...base, issues: [issue("document-not-found", `document "${request.documentId}" was not found`)], revision: null, status: "rejected" }
  }
  if (current.revision !== request.baseRevision) {
    return { ...base, issues: [issue("revision-stale", `baseRevision ${request.baseRevision} does not match current revision ${current.revision}`, "baseRevision")], revision: current.revision, status: "stale" }
  }
  if (!isBackendActivePackage(current.packageValue)) {
    return { ...base, issues: [issue("unsupported-version", "migration source must be package 2/document 3", "packageValue")], revision: current.revision, status: "rejected" }
  }

  const plan = planVNextPackageV2ToV3Migration(current.packageValue)
  if (plan.status !== "ready") {
    return {
      ...base,
      issues: plan.issues.map((item) => ({ code: item.code, message: item.message, path: item.path, severity: item.severity })),
      revision: current.revision,
      status: "rejected",
      summary: {
        changeCount: plan.changes.length,
        errorCount: plan.summary.errorCount,
        normalizedTextBlockCount: plan.summary.normalizedTextBlockCount,
        warningCount: plan.summary.warningCount,
      },
    }
  }
  const applied = applyVNextPackageV2ToV3Migration(plan)
  if (applied.status !== "applied" || applied.package == null) {
    return { ...base, issues: applied.issues.map((item) => ({ code: item.code, message: item.message, path: item.path, severity: item.severity })), revision: current.revision, status: "rejected" }
  }

  const write = await options.repository.migrate({
    changeCount: plan.changes.length,
    documentId: request.documentId,
    expectedRevision: current.revision,
    packageValue: applied.package,
    requestId: request.requestId,
    requestFingerprint: requestFingerprint(request),
    summary: plan.summary,
    updatedAt: new Date(receivedAt).toISOString(),
  })
  if ("receipt" in write) {
    const result = receiptResult(request, write.receipt, requestedAt, receivedAt, write.status === "written" ? "new" : "replayed")
    return result
  }
  if (write.status === "revision-conflict") {
    return { ...base, issues: [issue("revision-stale", "migration lost the revision write race", "baseRevision")], revision: write.currentRevision, status: "stale" }
  }
  return {
    ...base,
    issues: write.issues.map((item) => ({ ...item })),
    revision: write.currentRevision,
    status: "rejected",
  }
}
