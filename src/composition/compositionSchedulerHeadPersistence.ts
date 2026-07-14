import {
  createFlowDocBackendCompositionHeadUnavailableResultV1,
  isFlowDocBackendCompositionProductionRepositoryV1,
  type FlowDocBackendCompositionAvailableHeadCompareAndSwapResultV1,
  type FlowDocBackendCompositionAvailableHeadCreateResultV1,
} from "./compositionSchedulerProductionRepository.js"
import type { FlowDocBackendCompositionRepositoryV1 } from "./compositionSchedulerRepository.js"

export async function createFlowDocBackendCompositionHeadWithAvailabilityV1(
  repository: FlowDocBackendCompositionRepositoryV1,
  input: Parameters<FlowDocBackendCompositionRepositoryV1["createHead"]>[0],
): Promise<FlowDocBackendCompositionAvailableHeadCreateResultV1> {
  try {
    return isFlowDocBackendCompositionProductionRepositoryV1(repository)
      ? await repository.createHeadWithAvailability(input)
      : await repository.createHead(input)
  } catch {
    return createFlowDocBackendCompositionHeadUnavailableResultV1({
      operation: "head-create",
      reconcileWith: "create-request",
      message: "head creation ended with unknown transient storage availability",
      source: "adapter-exception",
    })
  }
}

export async function compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1(
  repository: FlowDocBackendCompositionRepositoryV1,
  input: Parameters<FlowDocBackendCompositionRepositoryV1["compareAndSwapHead"]>[0],
): Promise<FlowDocBackendCompositionAvailableHeadCompareAndSwapResultV1> {
  const reconcileWith = input.committedFinalization != null
    ? "committed-finalization"
    : input.committedRequest != null ? "committed-request" : "head-read"
  try {
    return isFlowDocBackendCompositionProductionRepositoryV1(repository)
      ? await repository.compareAndSwapHeadWithAvailability(input)
      : await repository.compareAndSwapHead(input)
  } catch {
    return createFlowDocBackendCompositionHeadUnavailableResultV1({
      operation: "head-compare-and-swap",
      reconcileWith,
      message: "head compare-and-swap ended with unknown transient storage availability",
      source: "adapter-exception",
    })
  }
}
