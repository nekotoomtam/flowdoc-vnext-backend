import {
  runVNextOperation,
  runVNextDocumentV4Operation,
  serializeFlowDocPackageV2DocumentVNext,
  serializeFlowDocPackageV3DocumentV4,
  type VNextOperationCommitMetadata,
} from "@flowdoc/vnext-core"
import {
  operationTargetNodeIds,
  toBackendMutationIssue,
  type BackendMutationIssue,
  type BackendMutationRequest,
  type BackendMutationResultEnvelope,
} from "../contracts/mutation.js"
import { toCoreOperationCommand } from "../core/coreOperationMapper.js"
import {
  isBackendActivePackage,
  isBackendV4Package,
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
    operationKind: request.operation.kind,
    receivedAt,
    requestId: request.requestId,
    requestedAt,
  }
}

export async function executeBackendMutation(
  request: BackendMutationRequest,
  options: ExecuteBackendMutationOptions,
): Promise<BackendMutationResultEnvelope> {
  const requestedAt = options.now?.() ?? Date.now()
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

  const command = toCoreOperationCommand(request.operation, request.source)
  const updatedAt = new Date(receivedAt).toISOString()
  let packageValue: BackendStoredPackage
  let operation: VNextOperationCommitMetadata
  if (isBackendActivePackage(current.packageValue)) {
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
    const coreResult = runVNextDocumentV4Operation(
      current.packageValue,
      command as Extract<typeof command, { kind: "node.delete" | "node.duplicate" | "node.reorder" }>,
    )
    if (!coreResult.ok) {
      return { ...base, core: null, issues: coreResult.issues.map(toBackendMutationIssue), revision: current.revision, status: "rejected", targetNodeIds: operationTargetNodeIds(request.operation) }
    }
    packageValue = serializeFlowDocPackageV3DocumentV4({
        ...coreResult.package,
        meta: { ...coreResult.package.meta, updatedAt },
      })
    operation = coreResult.operation
  }
  const writeResult = await options.repository.write({
    documentId: request.documentId,
    expectedRevision: current.revision,
    packageValue,
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
      targetNodeIds: operation.targetNodeIds,
    }
  }

  if (writeResult.status !== "written") {
    return {
      ...base,
      core: null,
      issues: writeResult.issues.map(packageParseIssueToMutationIssue),
      revision: writeResult.currentRevision,
      status: "rejected",
      targetNodeIds: operation.targetNodeIds,
    }
  }

  if (isBackendActivePackage(current.packageValue) !== isBackendActivePackage(writeResult.record.packageValue)) {
    return {
      ...base,
      core: null,
      issues: [transportIssue("unsupported-version", "mutation write returned a non-active package")],
      revision: writeResult.record.revision,
      status: "rejected",
      targetNodeIds: operation.targetNodeIds,
    }
  }

  return {
    ...base,
    core: {
      historyIntent: operation.historyPolicy.durableIntent,
      renderInvalidation: operation.renderInvalidation,
    },
    issues: [],
    readEnvelope: {
      baseRevision: request.baseRevision,
      documentId: request.documentId,
      envelopeId: `${request.requestId}:mutation-result`,
      packageValue: writeResult.record.packageValue,
      purpose: "mutation-result",
      receivedAt,
      requestedAt,
      sourceKind: "mutation-result",
      sourceRevision: writeResult.record.revision,
    },
    revision: writeResult.record.revision,
    status: "applied",
    targetNodeIds: operation.targetNodeIds,
  }
}
