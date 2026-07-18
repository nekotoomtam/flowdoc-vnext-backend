import { createHash } from "node:crypto"
import {
  createFlowDocBackendPdfExportLocalHttpCompositionV1,
  createFlowDocBackendPdfExportLocalWorkerRuntimeV1,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
  loadFlowDocBackendPdfExportLocalHttpConfigV1,
} from "../../index.js"

type Mode = "execute" | "replay" | "cancel-before-handoff"

function required(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error(`${label} response was not an object`)
  }
  return value as Record<string, unknown>
}

async function json(response: Response, expectedStatus: number, label: string): Promise<Record<string, unknown>> {
  if (response.status !== expectedStatus) {
    throw new Error(`${label} returned HTTP ${response.status}: ${await response.text()}`)
  }
  return record(await response.json(), label)
}

const mode = process.argv[2] as Mode | undefined
if (mode !== "execute" && mode !== "replay" && mode !== "cancel-before-handoff") {
  throw new Error("LOCAL-G process evidence requires execute, replay, or cancel-before-handoff mode")
}

const token = required("FLOWDOC_PDF_LOCAL_BEARER_TOKEN")
const callerKey = required("FLOWDOC_PDF_LOCAL_CALLER_KEY")
const config = loadFlowDocBackendPdfExportLocalHttpConfigV1({
  cwd: process.cwd(),
  env: process.env,
})
const initialRssBytes = process.memoryUsage().rss
let peakRssBytes = initialRssBytes
const cpuStart = process.cpuUsage()
const wallStart = performance.now()
const rssSampler = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
}, 5)
let httpRequestCount = 0
const request = async (url: string, init?: RequestInit): Promise<Response> => {
  httpRequestCount += 1
  return fetch(url, init)
}

const http = await createFlowDocBackendPdfExportLocalHttpCompositionV1({
  config,
  listenerPortOverride: 0,
})
const worker = await createFlowDocBackendPdfExportLocalWorkerRuntimeV1({ config })
try {
  const mounted = await http.server.start()
  const origin = `http://127.0.0.1:${mounted.listenerPort}`
  const authorization = { authorization: `Bearer ${token}` }
  const requestHeaders = {
    ...authorization,
    "content-type": "application/json",
    "idempotency-key": callerKey,
  }
  let eligibility: Record<string, unknown> | null = null
  if (mode === "execute") {
    eligibility = await json(await request(
      `${origin}/pdf-export-local/eligibility?documentId=${encodeURIComponent(FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID)}&documentRevision=${FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION}`,
      { headers: authorization },
    ), 200, "eligibility")
  }
  const admission = await json(await request(`${origin}/pdf-exports`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
      documentRevision: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
    }),
  }), mode === "replay" ? 200 : 202, "admission")
  const exportRecord = record(admission.export, "admission export")
  const operationId = exportRecord.operationId
  if (typeof operationId !== "string") throw new Error("admission response omitted operationId")

  let cancellation: Record<string, unknown> | null = null
  if (mode === "cancel-before-handoff") {
    cancellation = await json(await request(
      `${origin}/pdf-exports/${encodeURIComponent(operationId)}/cancel`,
      {
        method: "POST",
        headers: {
          ...authorization,
          "idempotency-key": `${callerKey}:cancel`,
        },
      },
    ), 200, "cancellation")
  }

  const cycle = await worker.host.runCycle()
  const status = await json(await request(
    `${origin}/pdf-exports/${encodeURIComponent(operationId)}`,
    { headers: authorization },
  ), 200, "status")
  const publicExport = record(status.export, "public status export")

  let artifact: { byteLength: number; sha256: string } | null = null
  let downloadStatus: number
  const download = await request(
    `${origin}/pdf-exports/${encodeURIComponent(operationId)}/download`,
    { headers: authorization },
  )
  downloadStatus = download.status
  if (mode === "cancel-before-handoff") {
    if (download.status !== 409) throw new Error(`cancelled download returned HTTP ${download.status}`)
    await download.arrayBuffer()
  } else {
    if (download.status !== 200 || download.headers.get("content-type") !== "application/pdf") {
      throw new Error(`download returned HTTP ${download.status} without application/pdf`)
    }
    const bytes = new Uint8Array(await download.arrayBuffer())
    artifact = {
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  }

  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
  const cpu = process.cpuUsage(cpuStart)
  const output = {
    mode,
    mounted: {
      runtimeProfile: mounted.runtimeProfile,
      localServerMounted: mounted.localServerMounted,
      defaultApplicationServerMounted: mounted.defaultApplicationServerMounted,
      listenerScope: mounted.listenerScope,
      workerStart: mounted.workerStart,
      remoteProviderCallsAllowed: mounted.remoteProviderCallsAllowed,
      productionBinding: mounted.productionBinding,
    },
    eligibility,
    admission,
    cancellation,
    cycle,
    status,
    downloadStatus,
    artifact,
    metrics: {
      wallTimeMs: Math.ceil(performance.now() - wallStart),
      cpuTimeMs: Math.ceil((cpu.user + cpu.system) / 1_000),
      peakRssBytes,
      rssGrowthBytes: Math.max(0, peakRssBytes - initialRssBytes),
      httpRequestCount,
    },
    publicStatusKeys: Object.keys(publicExport).sort(),
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
} finally {
  clearInterval(rssSampler)
  await http.close()
  await worker.close()
}
