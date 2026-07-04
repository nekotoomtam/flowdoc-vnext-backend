import {
  loadProductReportMinimalPackage,
  PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
} from "./fixtures/productReportMinimal.js"
import {
  loadReorderBlockedTargetQaPackage,
  REORDER_BLOCKED_TARGET_QA_INITIAL_REVISION,
} from "./fixtures/reorderBlockedTargetQa.js"
import { createFlowDocBackendServer } from "./http/server.js"
import { createInMemoryPackageRepository } from "./storage/packageRepository.js"

const port = Number.parseInt(process.env.FLOWDOC_BACKEND_PORT ?? "4011", 10)
const repository = createInMemoryPackageRepository([
  {
    packageValue: loadProductReportMinimalPackage(),
    revision: PRODUCT_REPORT_MINIMAL_INITIAL_REVISION,
    updatedAt: "2026-06-20T00:00:00.000Z",
  },
  {
    packageValue: loadReorderBlockedTargetQaPackage(),
    revision: REORDER_BLOCKED_TARGET_QA_INITIAL_REVISION,
    updatedAt: "2026-07-04T00:00:00.000Z",
  },
])
const server = createFlowDocBackendServer({
  repository,
})

server.listen(port, "127.0.0.1", () => {
  console.log(`FlowDoc vNext backend listening on http://127.0.0.1:${port}`)
})
