import {
  parseFlowDocPackageV2DocumentVNext,
  type FlowDocPackageV2DocumentVNext,
} from "@flowdoc/vnext-core"
import productReportBaseline from "@flowdoc/vnext-core/fixtures/product-report-vnext-baseline.flowdoc.json" with { type: "json" }

export const PRODUCT_REPORT_BASELINE_DOCUMENT_ID = "product-report-vnext-baseline"
export const PRODUCT_REPORT_BASELINE_INITIAL_REVISION = 1

export function loadProductReportBaselinePackage(): FlowDocPackageV2DocumentVNext {
  return parseFlowDocPackageV2DocumentVNext(productReportBaseline)
}
