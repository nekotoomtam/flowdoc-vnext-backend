import type { FlowDocBackendPdfExportLocalWorkerHostV1 } from "./pdfExportLocalWorkerHost.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_COMMAND_RUNTIME_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-worker-command-runtime" as const

export interface FlowDocBackendPdfExportLocalWorkerCommandRuntimeV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_COMMAND_RUNTIME_V1_SOURCE
  runtimeProfile: "local-integration"
  host: FlowDocBackendPdfExportLocalWorkerHostV1
  shutdownTimeoutMs: number
  productionBinding: false
  close(): Promise<void>
}

export type FlowDocBackendPdfExportLocalWorkerCommandRuntimeFactoryV1 =
  () => Promise<FlowDocBackendPdfExportLocalWorkerCommandRuntimeV1>

export function inspectFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1(
  value: FlowDocBackendPdfExportLocalWorkerCommandRuntimeV1,
): FlowDocBackendPdfExportLocalWorkerCommandRuntimeV1 {
  if (
    value.source !== FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_COMMAND_RUNTIME_V1_SOURCE
    || value.runtimeProfile !== "local-integration"
    || value.productionBinding !== false
    || !Number.isSafeInteger(value.shutdownTimeoutMs)
    || value.shutdownTimeoutMs < 1_000
    || value.shutdownTimeoutMs > 300_000
    || value.host.facts.runtimeProfile !== "local-integration"
    || value.host.facts.automaticStartOnImport !== false
    || value.host.facts.concurrency !== 1
    || value.host.facts.productionBinding !== false
    || typeof value.host.start !== "function"
    || typeof value.host.beginDrain !== "function"
    || typeof value.host.forceStop !== "function"
    || typeof value.close !== "function"
  ) throw new Error("local PDF worker command runtime does not satisfy the LOCAL-D host contract")
  return value
}
