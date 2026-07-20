import type { IncomingMessage, ServerResponse } from "node:http"
import type {
  FlowDocBackendPdfExportAuthenticatedIdentityV1,
  FlowDocBackendPdfExportAuthenticationResultV1,
  FlowDocBackendPdfExportAuthenticatorV1,
  FlowDocBackendPdfExportAuthorizationResultV1,
} from "../pdfExport/pdfExportRoute.js"
import type { FlowDocBackendDocGenLocalPublishedPreviewRegistryV1 } from "./docGenLocalPublishedPreview.js"
import { isFlowDocBackendPdfExportBoundedStringV1 } from "../pdfExport/pdfExportOperation.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_PUBLISHED_PREVIEW_HTTP_PATH_V1 =
  "/docgen-local/published-preview-context" as const

export interface FlowDocBackendDocGenLocalPublishedPreviewAuthorizerV1 {
  authorize(input: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    action: "docgen:inspect-published-preview"
    documentId: string
    documentRevision: number
  }): Promise<FlowDocBackendPdfExportAuthorizationResultV1>
}

export interface FlowDocBackendDocGenLocalPublishedPreviewHttpHandlerOptionsV1 {
  authenticator: FlowDocBackendPdfExportAuthenticatorV1
  authorizer: FlowDocBackendDocGenLocalPublishedPreviewAuthorizerV1
  registry: FlowDocBackendDocGenLocalPublishedPreviewRegistryV1
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (Array.isArray(value)) return value.length === 1 ? value[0]! : null
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function write(response: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extra,
  })
  response.end(JSON.stringify(value))
}

function authenticationResponse(
  response: ServerResponse,
  result: Exclude<FlowDocBackendPdfExportAuthenticationResultV1, { status: "authenticated" }>,
): void {
  const unavailable = result.status === "unavailable"
  write(response, unavailable ? 503 : 401, {
    status: unavailable ? "unavailable" : "unauthenticated",
  }, unavailable ? {} : { "www-authenticate": "Bearer" })
}

export function createFlowDocBackendDocGenLocalPublishedPreviewHttpHandlerV1(
  options: FlowDocBackendDocGenLocalPublishedPreviewHttpHandlerOptionsV1,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== FLOWDOC_BACKEND_DOCGEN_LOCAL_PUBLISHED_PREVIEW_HTTP_PATH_V1) return false
    if (request.method !== "GET") {
      write(response, 405, { status: "method-not-allowed" }, { allow: "GET" })
      return true
    }

    let authentication: FlowDocBackendPdfExportAuthenticationResultV1
    try {
      authentication = await options.authenticator.authenticate({
        authorization: header(request, "authorization"),
      })
    } catch {
      write(response, 503, { status: "unavailable" })
      return true
    }
    if (authentication.status !== "authenticated") {
      authenticationResponse(response, authentication)
      return true
    }

    const documentIds = url.searchParams.getAll("documentId")
    const revisions = url.searchParams.getAll("documentRevision")
    const unexpectedQuery = [...url.searchParams.keys()].some((name) => (
      name !== "documentId" && name !== "documentRevision"
    ))
    const revisionText = revisions[0] ?? ""
    const documentRevision = /^(0|[1-9][0-9]*)$/u.test(revisionText) ? Number(revisionText) : -1
    if (
      documentIds.length !== 1
      || revisions.length !== 1
      || unexpectedQuery
      || !isFlowDocBackendPdfExportBoundedStringV1(documentIds[0])
      || !Number.isSafeInteger(documentRevision)
      || documentRevision < 0
    ) {
      write(response, 400, { status: "invalid-request" })
      return true
    }
    const documentId = documentIds[0]!

    let authorization: FlowDocBackendPdfExportAuthorizationResultV1
    try {
      authorization = await options.authorizer.authorize({
        identity: authentication.identity,
        action: "docgen:inspect-published-preview",
        documentId,
        documentRevision,
      })
    } catch {
      write(response, 503, { status: "unavailable" })
      return true
    }
    if (authorization.status !== "authorized") {
      write(response, authorization.status === "unavailable" ? 503 : 403, {
        status: authorization.status === "unavailable" ? "unavailable" : "forbidden",
      })
      return true
    }

    const context = options.registry.resolve({ documentId, documentRevision })
    if (context == null) {
      write(response, 404, { status: "not-found" })
      return true
    }
    write(response, 200, { status: "ready", context })
    return true
  }
}
