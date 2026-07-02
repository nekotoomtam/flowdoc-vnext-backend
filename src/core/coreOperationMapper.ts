import type {
  VNextOperationCommand,
  VNextOperationSource,
} from "@flowdoc/vnext-core"
import type {
  BackendMutationOperation,
  BackendMutationSource,
} from "../contracts/mutation.js"

export function toCoreOperationSource(source: BackendMutationSource): VNextOperationSource {
  return source === "system" ? "system" : "user"
}

export function toCoreOperationCommand(
  operation: BackendMutationOperation,
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
