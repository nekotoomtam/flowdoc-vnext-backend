import { compositionIssue, type FlowDocBackendCompositionContractIssue } from "./compositionSchedulerContractSupport.js"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_WRITE_RECORDS,
  isFlowDocBackendCompositionProductionRepositoryV1,
} from "./compositionSchedulerProductionRepository.js"
import type { FlowDocBackendCompositionRepositoryV1 } from "./compositionSchedulerRepository.js"
import type { FlowDocBackendCompositionContentRefV1 } from "./compositionSchedulerSourcePin.js"

export type FlowDocBackendCompositionImmutableStageResultV1 =
  | {
      status: "written" | "idempotent-replay"
      refs: FlowDocBackendCompositionContentRefV1[]
      writtenRecordCount: number
      issues: []
    }
  | {
      status: "conflict" | "invalid" | "physical-quota-exceeded" | "storage-error"
      refs: null
      writtenRecordCount: number
      issues: FlowDocBackendCompositionContractIssue[]
    }

/**
 * Production repositories stage one scheduler event atomically with physical
 * admission. Repository V1 test adapters retain their sequential behavior.
 */
export async function stageFlowDocBackendCompositionImmutableBatchV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  records: readonly { ref: FlowDocBackendCompositionContentRefV1; value: unknown }[]
  storedAt: string
  maximumPhysicalByteCount: number
}): Promise<FlowDocBackendCompositionImmutableStageResultV1> {
  if (
    input.records.length < 1
    || input.records.length > FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_WRITE_RECORDS
  ) return {
    status: "invalid",
    refs: null,
    writtenRecordCount: 0,
    issues: [compositionIssue(
      "composition-immutable-stage-batch-invalid",
      "records",
      `scheduler staging requires 1 through ${FLOWDOC_BACKEND_COMPOSITION_MAX_BATCH_WRITE_RECORDS} immutable records`,
    )],
  }
  if (isFlowDocBackendCompositionProductionRepositoryV1(input.repository)) {
    return input.repository.putImmutableBatchWithPhysicalAdmission({
      records: input.records,
      storedAt: input.storedAt,
      maximumPhysicalByteCount: input.maximumPhysicalByteCount,
    })
  }
  const refs: FlowDocBackendCompositionContentRefV1[] = []
  let writtenRecordCount = 0
  for (const record of input.records) {
    const result = await input.repository.putImmutable(record)
    if (result.status !== "written" && result.status !== "idempotent-replay") return {
      status: result.status,
      refs: null,
      writtenRecordCount,
      issues: result.issues,
    }
    refs.push(result.ref)
    if (result.status === "written") writtenRecordCount += 1
  }
  return {
    status: writtenRecordCount > 0 ? "written" : "idempotent-replay",
    refs,
    writtenRecordCount,
    issues: [],
  }
}
