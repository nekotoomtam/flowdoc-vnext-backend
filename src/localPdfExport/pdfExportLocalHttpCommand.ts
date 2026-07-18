import {
  createFlowDocBackendPdfExportLocalHttpCompositionV1,
  loadFlowDocBackendPdfExportLocalHttpConfigV1,
} from "../index.js"

const config = loadFlowDocBackendPdfExportLocalHttpConfigV1()
const runtime = await createFlowDocBackendPdfExportLocalHttpCompositionV1({ config })
let shutdownStarted = false
let resolveShutdown: (() => void) | null = null
const shutdownRequested = new Promise<void>((resolve) => {
  resolveShutdown = resolve
})
const shutdown = () => {
  if (shutdownStarted) return
  shutdownStarted = true
  resolveShutdown?.()
}
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)

try {
  const evidence = await runtime.server.start()
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    runtimeProfile: evidence.runtimeProfile,
    listenerHost: evidence.listenerHost,
    listenerPort: evidence.listenerPort,
    localServerMounted: evidence.localServerMounted,
    defaultApplicationServerMounted: evidence.defaultApplicationServerMounted,
    workerStart: evidence.workerStart,
    remoteProviderCallsAllowed: evidence.remoteProviderCallsAllowed,
    productionBinding: evidence.productionBinding,
    compositionFingerprint: evidence.fingerprint,
  })}\n`)
  await shutdownRequested
} finally {
  process.removeListener("SIGINT", shutdown)
  process.removeListener("SIGTERM", shutdown)
  await runtime.close()
}
