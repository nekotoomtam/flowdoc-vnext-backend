import {
  runVNextOperation,
  serializeFlowDocPackageV2DocumentVNext,
  type FlowDocPackageParseIssue,
} from "@flowdoc/vnext-core"
import {
  operationTargetNodeIds,
  toBackendMutationIssue,
  type BackendMutationIssue,
  type BackendMutationRequest,
  type BackendMutationResultEnvelope,
} from "../contracts/mutation.js"
import { toCoreOperationCommand } from "../core/coreOperationMapper.js"
import type { BackendPackageRepository } from "../storage/packageRepository.js"

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

function packageParseIssueToMutationIssue(issue: FlowDocPackageParseIssue): BackendMutationIssue {
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
  const coreResult = runVNextOperation(current.packageValue.document, command)
  if (!coreResult.ok) {
    return {
      ...base,
      core: null,
      issues: coreResult.issues.map(toBackendMutationIssue),
      revision: current.revision,
      status: "rejected",
      targetNodeIds: operationTargetNodeIds(request.operation),
    }
  }

  const updatedAt = new Date(receivedAt).toISOString()
  const packageValue = serializeFlowDocPackageV2DocumentVNext({
    ...current.packageValue,
    document: coreResult.document,
    meta: {
      ...current.packageValue.meta,
      updatedAt,
    },
  })
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
      targetNodeIds: coreResult.operation.targetNodeIds,
    }
  }

  if (writeResult.status !== "written") {
    return {
      ...base,
      core: null,
      issues: writeResult.issues.map(packageParseIssueToMutationIssue),
      revision: writeResult.currentRevision,
      status: "rejected",
      targetNodeIds: coreResult.operation.targetNodeIds,
    }
  }

  return {
    ...base,
    core: {
      historyIntent: coreResult.operation.historyPolicy.durableIntent,
      renderInvalidation: coreResult.operation.renderInvalidation,
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
    },
    revision: writeResult.record.revision,
    status: "applied",
    targetNodeIds: coreResult.operation.targetNodeIds,
  }
}
