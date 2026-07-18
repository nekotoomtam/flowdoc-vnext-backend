import type { IncomingMessage, ServerResponse } from "node:http"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_ROUTE_V1_SOURCE,
  handleFlowDocBackendPdfExportRouteV1,
  type FlowDocBackendPdfExportRouteOptionsV1,
  type FlowDocBackendPdfExportRouteResponseV1,
} from "./pdfExportRoute.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_HTTP_MAX_BODY_BYTES_V1 = 16 * 1024

export interface FlowDocBackendPdfExportHttpHandlerOptionsV1
extends FlowDocBackendPdfExportRouteOptionsV1 {
  maxBodyBytes?: number
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (Array.isArray(value)) return value.length === 1 ? value[0]! : null
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

async function readJsonBody(request: IncomingMessage, maximum: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  let exceeded = false
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    length += bytes.byteLength
    if (length > maximum) {
      exceeded = true
      continue
    }
    chunks.push(bytes)
  }
  if (exceeded) throw new Error("request-body-too-large")
  const raw = Buffer.concat(chunks).toString("utf8")
  if (raw.trim().length === 0) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error("request-json-invalid")
  }
}

function write(response: ServerResponse, result: FlowDocBackendPdfExportRouteResponseV1) {
  response.writeHead(result.httpStatus, result.headers)
  if (result.body.kind === "pdf") response.end(Buffer.from(result.body.bytes))
  else response.end(JSON.stringify(result.body.value))
}

function badRequest(code: string): FlowDocBackendPdfExportRouteResponseV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_ROUTE_V1_SOURCE,
    matched: true,
    httpStatus: code === "request-body-too-large" ? 413 : code === "content-type-unsupported" ? 415 : 400,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
    body: { kind: "json", value: { status: "invalid-request", issues: [{ severity: "error", code }] } },
    security: { authentication: "not-run", authorization: "not-run" },
    contracts: {
      concreteHttpAdapter: true,
      applicationServerMounted: false,
      authenticationRequired: true,
      authorizationRequiredPerAction: true,
      tenantPrincipalFromCredentialOnly: true,
      callerIdentityFieldsAccepted: false,
      scopedRepositoryAccess: true,
      terminalCompletionRequiredForDownload: true,
      physicalByteVerificationRequiredForDownload: true,
      automaticWorkerStart: false,
      concreteAuthenticationProviderSelected: false,
      concreteAuthorizationProviderSelected: false,
      productionBinding: false,
    },
  }
}

export function createFlowDocBackendPdfExportHttpHandlerV1(
  options: FlowDocBackendPdfExportHttpHandlerOptionsV1,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/pdf-exports" && !url.pathname.startsWith("/pdf-exports/")) return false
    if (
      request.method === "POST"
      && url.pathname === "/pdf-exports"
      && header(request, "content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    ) {
      write(response, badRequest("content-type-unsupported"))
      return true
    }
    let body: unknown = null
    if (request.method === "POST") {
      try {
        body = await readJsonBody(request, options.maxBodyBytes ?? FLOWDOC_BACKEND_PDF_EXPORT_HTTP_MAX_BODY_BYTES_V1)
      } catch (error) {
        write(response, badRequest(error instanceof Error ? error.message : "request-json-invalid"))
        return true
      }
    }
    const result = await handleFlowDocBackendPdfExportRouteV1({
      method: request.method ?? "GET",
      path: url.pathname,
      authorization: header(request, "authorization"),
      idempotencyKey: header(request, "idempotency-key"),
      body,
    }, options)
    write(response, result)
    return true
  }
}
