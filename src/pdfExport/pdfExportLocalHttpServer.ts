import { createServer, type Server } from "node:http"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
} from "./pdfExportOperation.js"
import type { FlowDocBackendPdfExportHttpHandlerOptionsV1 } from "./pdfExportHttpHandler.js"
import { createFlowDocBackendPdfExportHttpHandlerV1 } from "./pdfExportHttpHandler.js"
import {
  createFlowDocBackendPdfExportLocalEligibilityHttpHandlerV1,
  type FlowDocBackendPdfExportLocalEligibilityHttpHandlerOptionsV1,
} from "./pdfExportLocalEligibilityHttpHandler.js"
import {
  createFlowDocBackendDocGenLocalHttpHandlerV1,
  type FlowDocBackendDocGenLocalHttpHandlerOptionsV1,
} from "../docgen/docGenLocalHttpHandler.js"
import {
  createFlowDocBackendDocGenLocalPublishedPreviewHttpHandlerV1,
  type FlowDocBackendDocGenLocalPublishedPreviewHttpHandlerOptionsV1,
} from "../docgen/docGenLocalPublishedPreviewHttpHandler.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_HTTP_SERVER_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-http-server" as const

export interface FlowDocBackendPdfExportLocalCompositionEvidenceV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_HTTP_SERVER_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-local-composition-evidence"
  runtimeProfile: "local-integration"
  localServerMounted: boolean
  defaultApplicationServerMounted: false
  listenerScope: "loopback-only"
  listenerHost: "127.0.0.1"
  listenerPort: number | null
  workerStart: "dedicated-command"
  remoteProviderCallsAllowed: false
  automaticListenerStart: false
  corsEnabled: false
  docGenAdmissionMounted: boolean
  publishedPreviewContextMounted: boolean
  productionBinding: false
  fingerprint: string
}

export interface FlowDocBackendPdfExportLocalHttpServerV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_HTTP_SERVER_V1_SOURCE
    runtimeProfile: "local-integration"
    configuredHost: "127.0.0.1"
    configuredPort: number
    automaticListenerStart: false
    defaultApplicationServerMounted: false
    remoteProviderCallsAllowed: false
    corsEnabled: false
    productionBinding: false
  }
  server: Server
  readEvidence(): FlowDocBackendPdfExportLocalCompositionEvidenceV1
  start(): Promise<FlowDocBackendPdfExportLocalCompositionEvidenceV1>
  close(): Promise<void>
}

function evidence(input: {
  mounted: boolean
  port: number | null
  docGenAdmissionMounted: boolean
  publishedPreviewContextMounted: boolean
}): FlowDocBackendPdfExportLocalCompositionEvidenceV1 {
  const facts = {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_HTTP_SERVER_V1_SOURCE,
    contractVersion: 1 as const,
    kind: "pdf-export-local-composition-evidence" as const,
    runtimeProfile: "local-integration" as const,
    localServerMounted: input.mounted,
    defaultApplicationServerMounted: false as const,
    listenerScope: "loopback-only" as const,
    listenerHost: "127.0.0.1" as const,
    listenerPort: input.port,
    workerStart: "dedicated-command" as const,
    remoteProviderCallsAllowed: false as const,
    automaticListenerStart: false as const,
    corsEnabled: false as const,
    docGenAdmissionMounted: input.docGenAdmissionMounted,
    publishedPreviewContextMounted: input.publishedPreviewContextMounted,
    productionBinding: false as const,
  }
  return { ...facts, fingerprint: flowDocBackendPdfExportFingerprintV1(facts) }
}

function writeJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
  response.end(JSON.stringify(value))
}

export function createFlowDocBackendPdfExportLocalHttpServerV1(input: {
  host: "127.0.0.1"
  port: number
  routeOptions: FlowDocBackendPdfExportHttpHandlerOptionsV1
  eligibilityOptions?: FlowDocBackendPdfExportLocalEligibilityHttpHandlerOptionsV1
  docGenAdmissionOptions?: FlowDocBackendDocGenLocalHttpHandlerOptionsV1
  publishedPreviewContextOptions?: FlowDocBackendDocGenLocalPublishedPreviewHttpHandlerOptionsV1
}): FlowDocBackendPdfExportLocalHttpServerV1 {
  if (input.host !== "127.0.0.1") throw new Error("local PDF HTTP listener must use 127.0.0.1")
  if (!Number.isSafeInteger(input.port) || input.port < 0 || input.port > 65_535) {
    throw new Error("local PDF HTTP port must be an integer from 0 through 65535")
  }
  const handler = createFlowDocBackendPdfExportHttpHandlerV1(input.routeOptions)
  const eligibilityHandler = input.eligibilityOptions == null
    ? null
    : createFlowDocBackendPdfExportLocalEligibilityHttpHandlerV1(input.eligibilityOptions)
  const docGenAdmissionHandler = input.docGenAdmissionOptions == null
    ? null
    : createFlowDocBackendDocGenLocalHttpHandlerV1(input.docGenAdmissionOptions)
  const publishedPreviewContextHandler = input.publishedPreviewContextOptions == null
    ? null
    : createFlowDocBackendDocGenLocalPublishedPreviewHttpHandlerV1(input.publishedPreviewContextOptions)
  let mounted = false
  let mountedPort: number | null = null
  let startPromise: Promise<FlowDocBackendPdfExportLocalCompositionEvidenceV1> | null = null
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (request.method === "GET" && url.pathname === "/pdf-export-local/health") {
        writeJson(response, 200, {
          service: "flowdoc-pdf-export-local",
          status: "ready",
          composition: readEvidence(),
        })
        return
      }
      if (docGenAdmissionHandler != null && await docGenAdmissionHandler(request, response)) return
      if (publishedPreviewContextHandler != null && await publishedPreviewContextHandler(request, response)) return
      if (eligibilityHandler != null && await eligibilityHandler(request, response)) return
      if (await handler(request, response)) return
      writeJson(response, 404, { status: "not-found" })
    } catch {
      if (!response.headersSent) {
        writeJson(response, 503, { status: "unavailable" })
      } else response.destroy()
    }
  })

  const readEvidence = () => cloneFlowDocBackendPdfExportJsonV1(evidence({
    mounted,
    port: mountedPort,
    docGenAdmissionMounted: docGenAdmissionHandler != null,
    publishedPreviewContextMounted: publishedPreviewContextHandler != null,
  }))

  return {
    facts: {
      source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_HTTP_SERVER_V1_SOURCE,
      runtimeProfile: "local-integration",
      configuredHost: input.host,
      configuredPort: input.port,
      automaticListenerStart: false,
      defaultApplicationServerMounted: false,
      remoteProviderCallsAllowed: false,
      corsEnabled: false,
      productionBinding: false,
    },
    server,
    readEvidence,
    async start() {
      if (startPromise != null) return startPromise
      startPromise = new Promise((resolveStart, rejectStart) => {
        const onError = (error: Error) => {
          server.removeListener("listening", onListening)
          startPromise = null
          rejectStart(error)
        }
        const onListening = () => {
          server.removeListener("error", onError)
          const address = server.address()
          if (
            typeof address !== "object"
            || address == null
            || address.address !== "127.0.0.1"
            || address.family !== "IPv4"
          ) {
            server.close(() => rejectStart(new Error("local PDF HTTP listener did not bind to IPv4 loopback")))
            return
          }
          mounted = true
          mountedPort = address.port
          resolveStart(readEvidence())
        }
        server.once("error", onError)
        server.once("listening", onListening)
        server.listen(input.port, input.host)
      })
      return startPromise
    },
    async close() {
      if (!mounted && !server.listening) return
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error == null ? resolveClose() : rejectClose(error))
      })
      mounted = false
      mountedPort = null
      startPromise = null
    },
  }
}
