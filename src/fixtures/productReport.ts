import {
  parseFlowDocPackageV2DocumentVNext,
  type FlowDocPackageV2DocumentVNext,
} from "@flowdoc/vnext-core"
import productReport from "@flowdoc/vnext-core/fixtures/product-report-vnext.flowdoc.json" with { type: "json" }

export const PRODUCT_REPORT_DOCUMENT_ID = "product-report-vnext"
export const PRODUCT_REPORT_INITIAL_REVISION = 3

export function loadProductReportPackage(): FlowDocPackageV2DocumentVNext {
  return parseFlowDocPackageV2DocumentVNext(productReport)
}
