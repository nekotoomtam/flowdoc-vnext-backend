import { realpath } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  inspectFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1,
  type FlowDocBackendPdfExportLocalWorkerCommandRuntimeFactoryV1,
} from "../index.js"

function required(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

if (required("FLOWDOC_PDF_LOCAL_RUNTIME_PROFILE") !== "local-integration") {
  throw new Error("local PDF worker command requires local-integration runtime profile")
}
const root = await realpath(resolve(process.cwd()))
const factoryPath = await realpath(resolve(root, required("FLOWDOC_PDF_LOCAL_WORKER_FACTORY_MODULE")))
const relativeFactory = relative(root, factoryPath)
if (relativeFactory.startsWith("..") || resolve(root, relativeFactory) !== factoryPath) {
  throw new Error("local PDF worker factory module must stay inside the Backend checkout")
}
const loaded = await import(pathToFileURL(factoryPath).href) as {
  createFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1?:
    FlowDocBackendPdfExportLocalWorkerCommandRuntimeFactoryV1
}
if (typeof loaded.createFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1 !== "function") {
  throw new Error("local PDF worker factory module does not export the exact LOCAL-D runtime factory")
}
const candidateRuntime = await loaded.createFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1()
let runtime
try {
  runtime = inspectFlowDocBackendPdfExportLocalWorkerCommandRuntimeV1(candidateRuntime)
} catch (error) {
  await candidateRuntime.close().catch(() => undefined)
  throw error
}
let forceTimer: ReturnType<typeof setTimeout> | null = null
let shutdownStarted = false
const shutdown = () => {
  if (shutdownStarted) return
  shutdownStarted = true
  runtime.host.beginDrain()
  forceTimer = setTimeout(() => {
    void runtime.host.forceStop().catch(() => {
      process.stderr.write("Local PDF worker force-stop transition failed.\n")
    })
  }, runtime.shutdownTimeoutMs)
  forceTimer.unref()
}
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)

try {
  const report = await runtime.host.start()
  process.stdout.write(`${JSON.stringify({
    status: "stopped",
    runFingerprint: report.fingerprint,
    cycleCount: report.cycleCount,
    listedCount: report.listedCount,
    invokedCount: report.invokedCount,
    stopReason: report.drain.stopReason,
    productionBinding: false,
  })}\n`)
} finally {
  if (forceTimer != null) clearTimeout(forceTimer)
  process.removeListener("SIGINT", shutdown)
  process.removeListener("SIGTERM", shutdown)
  await runtime.close()
}
