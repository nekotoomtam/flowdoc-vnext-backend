import {
  parseFlowDocPackageV2DocumentVNext,
  type FlowDocPackageV2DocumentVNext,
} from "@flowdoc/vnext-core"
import productReportMinimal from "@flowdoc/vnext-core/fixtures/product-report-vnext-minimal.flowdoc.json" with { type: "json" }

export const PRODUCT_REPORT_MINIMAL_DOCUMENT_ID = "product-report-vnext-minimal"
export const PRODUCT_REPORT_MINIMAL_INITIAL_REVISION = 3

export function loadProductReportMinimalPackage(): FlowDocPackageV2DocumentVNext {
  return parseFlowDocPackageV2DocumentVNext(productReportMinimal)
}
