import {
  parseFlowDocPackageV2DocumentVNext,
  type FlowDocPackageV2DocumentVNext,
} from "@flowdoc/vnext-core"
import reorderBlockedTargetQa from "@flowdoc/vnext-core/fixtures/reorder-blocked-target-qa.flowdoc.json" with { type: "json" }

export const REORDER_BLOCKED_TARGET_QA_DOCUMENT_ID = "reorder-blocked-target-qa"
export const REORDER_BLOCKED_TARGET_QA_INITIAL_REVISION = 3

export function loadReorderBlockedTargetQaPackage(): FlowDocPackageV2DocumentVNext {
  return parseFlowDocPackageV2DocumentVNext(reorderBlockedTargetQa)
}
