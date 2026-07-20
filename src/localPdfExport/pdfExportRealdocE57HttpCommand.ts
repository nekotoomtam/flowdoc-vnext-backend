import { resolve } from "node:path"
import { createFlowDocBackendRealdocE56LocalRuntimeV1 } from "./pdfExportRealdocE56Runtime.js"

const semanticDirectory = process.env.FLOWDOC_REALDOC_E56_SEMANTIC_DIR
const bearerToken = process.env.FLOWDOC_PDF_LOCAL_BEARER_TOKEN
if (!semanticDirectory) throw new Error("FLOWDOC_REALDOC_E56_SEMANTIC_DIR is required")
if (!bearerToken) throw new Error("FLOWDOC_PDF_LOCAL_BEARER_TOKEN is required")
const port = Number(process.env.FLOWDOC_PDF_LOCAL_HTTP_PORT ?? "4012")
const runtime = createFlowDocBackendRealdocE56LocalRuntimeV1({
  semanticDirectory: resolve(semanticDirectory),
  bearerToken,
  port,
})
let stopping = false
let resolveStop: (() => void) | null = null
const stopRequested = new Promise<void>((resolveStopRequest) => {
  resolveStop = resolveStopRequest
})
const stop = () => {
  if (stopping) return
  stopping = true
  resolveStop?.()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)

try {
  const evidence = await runtime.start()
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    phaseId: "PDF-EXPORT-REALDOC-E.5.7",
    listenerHost: evidence.listenerHost,
    listenerPort: evidence.listenerPort,
    docGenAdmissionMounted: evidence.docGenAdmissionMounted,
    publishedPreviewContextMounted: evidence.publishedPreviewContextMounted,
    draftPreviewMounted: evidence.draftPreviewMounted,
    productionBinding: evidence.productionBinding,
  })}\n`)
  await stopRequested
} finally {
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
  await runtime.close()
}
