import type { IncomingMessage, ServerResponse } from "node:http"
import type {
  FlowDocBackendPdfExportLocalEligibilityInspectionV1,
} from "./pdfExportLocalCanonicalEvidence.js"
import type {
  FlowDocBackendPdfExportAuthenticatorV1,
  FlowDocBackendPdfExportAuthorizerV1,
} from "./pdfExportRoute.js"
import { isFlowDocBackendPdfExportBoundedStringV1 } from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ELIGIBILITY_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-eligibility" as const

export interface FlowDocBackendPdfExportLocalEligibilityResponseV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ELIGIBILITY_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-local-eligibility"
  status: FlowDocBackendPdfExportLocalEligibilityInspectionV1["status"]
  documentId: string
  documentRevision: number
  lane: "canonical-evidence" | null
  reason: "unsupported-document" | "revision-mismatch" | null
  contracts: {
    exactDocumentPin: true
    requestBodyIdentityFieldsForbidden: true
    sameOriginDevelopmentProxyRequired: true
    productionBinding: false
  }
}

export interface FlowDocBackendPdfExportLocalEligibilityHttpHandlerOptionsV1 {
  authenticator: FlowDocBackendPdfExportAuthenticatorV1
  authorizer: FlowDocBackendPdfExportAuthorizerV1
  inspectEligibility(input: {
    documentId: string
    documentRevision: number
  }): FlowDocBackendPdfExportLocalEligibilityInspectionV1
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (Array.isArray(value)) return value.length === 1 ? value[0]! : null
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function writeJson(response: ServerResponse, status: number, value: unknown, headers?: Record<string, string>): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  })
  response.end(JSON.stringify(value))
}

function exactQuery(url: URL): { documentId: string; documentRevision: number } | null {
  if ([...url.searchParams.keys()].sort().join("|") !== "documentId|documentRevision") return null
  const documentIds = url.searchParams.getAll("documentId")
  const revisions = url.searchParams.getAll("documentRevision")
  if (documentIds.length !== 1 || revisions.length !== 1) return null
  const documentId = documentIds[0]!.trim()
  const revisionText = revisions[0]!
  const documentRevision = Number(revisionText)
  if (
    documentId.length === 0
    || documentId.length > 2_048
    || documentId !== documentIds[0]
    || !/^(0|[1-9]\d*)$/u.test(revisionText)
    || !Number.isSafeInteger(documentRevision)
    || documentRevision < 0
  ) return null
  return { documentId, documentRevision }
}

function publicResponse(
  pin: { documentId: string; documentRevision: number },
  inspection: FlowDocBackendPdfExportLocalEligibilityInspectionV1,
): FlowDocBackendPdfExportLocalEligibilityResponseV1 {
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ELIGIBILITY_V1_SOURCE,
    contractVersion: 1,
    kind: "pdf-export-local-eligibility",
    status: inspection.status,
    documentId: pin.documentId,
    documentRevision: pin.documentRevision,
    lane: inspection.lane,
    reason: inspection.reason,
    contracts: {
      exactDocumentPin: true,
      requestBodyIdentityFieldsForbidden: true,
      sameOriginDevelopmentProxyRequired: true,
      productionBinding: false,
    },
  }
}

export function createFlowDocBackendPdfExportLocalEligibilityHttpHandlerV1(
  options: FlowDocBackendPdfExportLocalEligibilityHttpHandlerOptionsV1,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/pdf-export-local/eligibility") return false
    if (request.method !== "GET") {
      writeJson(response, 405, { status: "method-not-allowed" }, { allow: "GET" })
      return true
    }
    const pin = exactQuery(url)
    if (pin == null) {
      writeJson(response, 400, { status: "invalid-request" })
      return true
    }
    const authenticated = await options.authenticator.authenticate({
      authorization: header(request, "authorization"),
    })
    const validIdentity = authenticated.status === "authenticated"
      && isFlowDocBackendPdfExportBoundedStringV1(authenticated.identity.tenantId)
      && isFlowDocBackendPdfExportBoundedStringV1(authenticated.identity.principalId)
      && isFlowDocBackendPdfExportBoundedStringV1(authenticated.identity.authenticationId)
    if (!validIdentity) {
      const unavailable = authenticated.status === "unavailable"
      writeJson(
        response,
        unavailable ? 503 : 401,
        { status: unavailable ? "unavailable" : "unauthenticated" },
        unavailable ? undefined : { "www-authenticate": "Bearer" },
      )
      return true
    }
    const inspection = options.inspectEligibility(pin)
    if (inspection.status === "ineligible") {
      writeJson(response, 200, publicResponse(pin, inspection))
      return true
    }
    const authorized = await options.authorizer.authorize({
      identity: authenticated.identity,
      action: "pdf-export:request",
      documentId: pin.documentId,
      operationId: null,
    })
    if (
      authorized.status !== "authorized"
      || !isFlowDocBackendPdfExportBoundedStringV1(authorized.authorizationId)
    ) {
      const unavailable = authorized.status === "unavailable" || authorized.status === "authorized"
      writeJson(response, unavailable ? 503 : 403, {
        status: unavailable ? "unavailable" : "denied",
      })
      return true
    }
    writeJson(response, 200, publicResponse(pin, inspection))
    return true
  }
}
