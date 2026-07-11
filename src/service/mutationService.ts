import {
  runVNextOperation,
  runVNextDocumentV4Operation,
  runVNextTextBlockV4RichInlineReplace,
  serializeFlowDocPackageV2DocumentVNext,
  serializeFlowDocPackageV3DocumentV4,
  type VNextOperationCommitMetadata,
  type VNextTextBlockV4RichInlineReplaceCommit,
} from "@flowdoc/vnext-core"
import {
  operationTargetNodeIds,
  toBackendMutationIssue,
  type BackendMutationIssue,
  type BackendMutationRequest,
  type BackendMutationResultEnvelope,
} from "../contracts/mutation.js"
import {
  toCoreDocumentV4OperationCommand,
  toCoreOperationCommand,
} from "../core/coreOperationMapper.js"
import {
  isBackendActivePackage,
  type BackendPackageIssue,
  type BackendPackageRepository,
  type BackendStoredPackage,
} from "../storage/packageRepository.js"

export interface ExecuteBackendMutationOptions {
  now?: () => number
  repository: BackendPackageRepository
}

function transportIssue(
  code: string,
  message: string,
  options: { path?: string; nodeId?: string } = {},
): BackendMutationIssue {
  return {
    code,
    message,
    nodeId: options.nodeId,
    path: options.path ?? "",
    severity: "error",
  }
}

function packageParseIssueToMutationIssue(issue: BackendPackageIssue): BackendMutationIssue {
  return {
    code: issue.code,
    message: issue.message,
    path: issue.path,
    severity: issue.severity,
  }
}

function baseEnvelope(
  request: BackendMutationRequest,
  requestedAt: number,
  receivedAt: number,
): Omit<BackendMutationResultEnvelope, "core" | "issues" | "revision" | "status" | "targetNodeIds"> {
  return {
    baseRevision: request.baseRevision,
    documentId: request.documentId,
    idempotency: null,
    operationKind: request.operation.kind,
    receivedAt,
    requestId: request.requestId,
    requestedAt,
  }
}

function requestFingerprint(request: BackendMutationRequest): string {
  return JSON.stringify({
    baseRevision: request.baseRevision,
    documentId: request.documentId,
    operation: request.operation,
    reason: request.reason ?? null,
    requestId: request.requestId,
    source: request.source,
  })
}

export async function executeBackendMutation(
  request: BackendMutationRequest,
  options: ExecuteBackendMutationOptions,
): Promise<BackendMutationResultEnvelope> {
  const requestedAt = options.now?.() ?? Date.now()
  const fingerprint = requestFingerprint(request)
  const replay = await options.repository.readMutationReceipt(request.documentId, request.requestId)
  if (replay) {
    const receivedAt = options.now?.() ?? Date.now()
    const base = baseEnvelope(request, requestedAt, receivedAt)
    if (replay.requestFingerprint !== fingerprint) {
      return {
        ...base,
        core: null,
        issues: [transportIssue("idempotency-conflict", "requestId was already used with a different mutation payload", { path: "requestId" })],
        revision: replay.record.revision,
        status: "rejected",
        targetNodeIds: operationTargetNodeIds(request.operation),
      }
    }
    return {
      ...base,
      core: replay.core,
      idempotency: "replayed",
      issues: [],
      readEnvelope: {
        baseRevision: replay.baseRevision,
        documentId: replay.documentId,
        envelopeId: `${request.requestId}:mutation-result`,
        packageValue: replay.record.packageValue,
        purpose: "mutation-result",
        receivedAt,
        requestedAt,
        sourceKind: "mutation-result",
        sourceRevision: replay.record.revision,
      },
      revision: replay.record.revision,
      status: "applied",
      targetNodeIds: replay.targetNodeIds,
    }
  }
  const current = await options.repository.read(request.documentId)
  const receivedAt = options.now?.() ?? Date.now()
  const base = baseEnvelope(request, requestedAt, receivedAt)

  if (!current) {
    return {
      ...base,
      core: null,
      issues: [transportIssue("document-not-found", `document "${request.documentId}" was not found`)],
      revision: null,
      status: "rejected",
      targetNodeIds: operationTargetNodeIds(request.operation),
    }
  }

  if (current.revision !== request.baseRevision) {
    return {
      ...base,
      core: null,
      issues: [
        transportIssue(
          "revision-stale",
          `baseRevision ${request.baseRevision} does not match current revision ${current.revision}`,
        ),
      ],
      revision: current.revision,
      status: "stale",
      targetNodeIds: operationTargetNodeIds(request.operation),
    }
  }

  const updatedAt = new Date(receivedAt).toISOString()
  let packageValue: BackendStoredPackage
  let operation: VNextOperationCommitMetadata | VNextTextBlockV4RichInlineReplaceCommit
  if (isBackendActivePackage(current.packageValue)) {
    if (request.operation.kind === "text-block.rich-inline.replace") {
      return {
        ...base,
        core: null,
        issues: [transportIssue("unsupported-version", "v4 rich-inline replacement requires package 3/document 4")],
        revision: current.revision,
        status: "rejected",
        targetNodeIds: operationTargetNodeIds(request.operation),
      }
    }
    const command = toCoreOperationCommand(request.operation, request.source)
    const coreResult = runVNextOperation(current.packageValue.document, command)
    if (!coreResult.ok) {
      return { ...base, core: null, issues: coreResult.issues.map(toBackendMutationIssue), revision: current.revision, status: "rejected", targetNodeIds: operationTargetNodeIds(request.operation) }
    }
    packageValue = serializeFlowDocPackageV2DocumentVNext({
        ...current.packageValue,
        document: coreResult.document,
        meta: { ...current.packageValue.meta, updatedAt },
      })
    operation = coreResult.operation
  } else {
    if (request.operation.kind === "text-block.rich-inline.replace") {
      if (current.authoringContext == null) {
        return {
          ...base,
          core: null,
          issues: [transportIssue("authoring-context-missing", "v4 rich-inline replacement requires backend-owned authoring context")],
          revision: current.revision,
          status: "rejected",
          targetNodeIds: operationTargetNodeIds(request.operation),
        }
      }
      const coreResult = runVNextTextBlockV4RichInlineReplace({
        contractVersion: 1,
        kind: "text-block-v4-rich-inline-replace-request",
        artifact: current.authoringContext.artifact,
        document: current.packageValue.document,
        fieldContract: current.authoringContext.fieldContract,
        policySet: current.authoringContext.policySet,
        sessionAllowedActions: ["content.edit", "field.place", "media.place", "style.override"],
        command: {
          kind: request.operation.kind,
          textBlockId: request.operation.textBlockId,
          children: request.operation.children,
          source: request.source === "system" ? "system" : "user",
        },
      })
      if (coreResult.status !== "committed") {
        return {
          ...base,
          core: null,
          issues: coreResult.issues.map((item) => ({ ...item })),
          revision: current.revision,
          status: "rejected",
          targetNodeIds: operationTargetNodeIds(request.operation),
        }
      }
      packageValue = serializeFlowDocPackageV3DocumentV4({
        ...current.packageValue,
        document: coreResult.document,
        meta: { ...current.packageValue.meta, updatedAt },
      })
      operation = coreResult.operation
    } else {
      const command = toCoreDocumentV4OperationCommand(request.operation, request.source)
      const coreResult = runVNextDocumentV4Operation(current.packageValue, command)
      if (!coreResult.ok) {
        return { ...base, core: null, issues: coreResult.issues.map(toBackendMutationIssue), revision: current.revision, status: "rejected", targetNodeIds: operationTargetNodeIds(request.operation) }
      }
      packageValue = serializeFlowDocPackageV3DocumentV4({
          ...coreResult.package,
          meta: { ...coreResult.package.meta, updatedAt },
        })
      operation = coreResult.operation
    }
  }
  const coreSummary = {
    historyIntent: operation.historyPolicy.durableIntent,
    renderInvalidation: operation.renderInvalidation,
  }
  const targetNodeIds = operation.kind === "text-block.rich-inline.replace"
    ? [operation.targetTextBlockId]
    : operation.targetNodeIds
  const writeResult = await options.repository.writeMutation({
    core: coreSummary,
    documentId: request.documentId,
    expectedRevision: current.revision,
    operationKind: request.operation.kind,
    packageValue,
    requestFingerprint: fingerprint,
    requestId: request.requestId,
    targetNodeIds,
    updatedAt,
  })

  if (writeResult.status === "revision-conflict") {
    return {
      ...base,
      core: null,
      issues: [
        transportIssue(
          "revision-stale",
          `baseRevision ${request.baseRevision} lost the write race to revision ${writeResult.currentRevision}`,
        ),
      ],
      revision: writeResult.currentRevision,
      status: "stale",
      targetNodeIds,
    }
  }

  if (!("receipt" in writeResult)) {
    return {
      ...base,
      core: null,
      issues: writeResult.issues.map(packageParseIssueToMutationIssue),
      revision: writeResult.currentRevision,
      status: "rejected",
      targetNodeIds,
    }
  }

  const writtenRecord = writeResult.receipt.record
  if (isBackendActivePackage(current.packageValue) !== isBackendActivePackage(writtenRecord.packageValue)) {
    return {
      ...base,
      core: null,
      issues: [transportIssue("unsupported-version", "mutation write returned a non-active package")],
      revision: writtenRecord.revision,
      status: "rejected",
      targetNodeIds,
    }
  }

  return {
    ...base,
    core: {
      ...coreSummary,
    },
    idempotency: writeResult.status === "idempotent-replay" ? "replayed" : "new",
    issues: [],
    readEnvelope: {
      baseRevision: request.baseRevision,
      documentId: request.documentId,
      envelopeId: `${request.requestId}:mutation-result`,
      packageValue: writtenRecord.packageValue,
      purpose: "mutation-result",
      receivedAt,
      requestedAt,
      sourceKind: "mutation-result",
      sourceRevision: writtenRecord.revision,
    },
    revision: writtenRecord.revision,
    status: "applied",
    targetNodeIds: writeResult.receipt.targetNodeIds,
  }
}
