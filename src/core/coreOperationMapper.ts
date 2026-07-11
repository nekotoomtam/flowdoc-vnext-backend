import type {
  VNextDocumentV4OperationCommand,
  VNextOperationCommand,
  VNextOperationSource,
} from "@flowdoc/vnext-core"
import type {
  BackendMutationOperation,
  BackendMutationSource,
} from "../contracts/mutation.js"

type BackendNodeMutationOperation = Exclude<
  BackendMutationOperation,
  { kind: "text-block.rich-inline.replace" }
>

export function toCoreOperationSource(source: BackendMutationSource): VNextOperationSource {
  return source === "system" ? "system" : "user"
}

export function toCoreOperationCommand(
  operation: BackendNodeMutationOperation,
  source: BackendMutationSource,
): VNextOperationCommand {
  const coreSource = toCoreOperationSource(source)

  if (operation.kind === "node.reorder") {
    return {
      kind: operation.kind,
      nodeId: operation.nodeId,
      source: coreSource,
      toIndex: operation.toIndex,
    }
  }

  return {
    kind: operation.kind,
    nodeId: operation.nodeId,
    source: coreSource,
  }
}

export function toCoreDocumentV4OperationCommand(
  operation: BackendNodeMutationOperation,
  source: BackendMutationSource,
): VNextDocumentV4OperationCommand {
  const command = toCoreOperationCommand(operation, source)
  if (command.kind === "node.reorder") return command
  if (command.kind === "node.delete" || command.kind === "node.duplicate") return command
  throw new Error(`backend operation ${operation.kind} is not supported by document v4`)
}
