import {
  createFlowDocBackendPdfExportLocalWorkerRuntimeV1,
  loadFlowDocBackendPdfExportLocalCompositionConfigV1,
  type FlowDocBackendPdfExportLocalWorkerCommandRuntimeV1,
} from "../index.js"

export async function createFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1():
Promise<FlowDocBackendPdfExportLocalWorkerCommandRuntimeV1> {
  const config = loadFlowDocBackendPdfExportLocalCompositionConfigV1()
  return createFlowDocBackendPdfExportLocalWorkerRuntimeV1({ config })
}
