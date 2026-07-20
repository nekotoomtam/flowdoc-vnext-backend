import type { IncomingMessage, ServerResponse } from "node:http"
import type { VNextStructureDefinitionDraftIdentityV1 } from "@flowdoc/vnext-core"
import type {
  FlowDocBackendPdfExportAuthenticatedIdentityV1,
  FlowDocBackendPdfExportAuthenticationResultV1,
  FlowDocBackendPdfExportAuthenticatorV1,
  FlowDocBackendPdfExportAuthorizationResultV1,
} from "../pdfExport/pdfExportRoute.js"
import { isFlowDocBackendPdfExportBoundedStringV1 } from "../pdfExport/pdfExportOperation.js"
import {
  FlowDocBackendDocGenLocalDraftPreviewAdmissionRequestV1Schema,
  type FlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1,
  type FlowDocBackendDocGenLocalDraftPreviewRegistryV1,
} from "./docGenLocalDraftPreview.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_CONTEXT_HTTP_PATH_V1 =
  "/docgen-local/draft-preview-context" as const
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_ADMISSION_HTTP_PATH_V1 =
  "/docgen-local/draft-preview-admissions" as const
const MAX_BODY_BYTES = 2 * 1024 * 1024

export interface FlowDocBackendDocGenLocalDraftPreviewAuthorizerV1 {
  authorize(input: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    action: "docgen:inspect-draft-preview" | "docgen:admit-draft-preview"
    documentId: string
    documentRevision: number
    draft: VNextStructureDefinitionDraftIdentityV1 | null
  }): Promise<FlowDocBackendPdfExportAuthorizationResultV1>
}

export interface FlowDocBackendDocGenLocalDraftPreviewHttpHandlerOptionsV1 {
  authenticator: FlowDocBackendPdfExportAuthenticatorV1
  authorizer: FlowDocBackendDocGenLocalDraftPreviewAuthorizerV1
  registry: FlowDocBackendDocGenLocalDraftPreviewRegistryV1
  admission: FlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1
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

async function authenticate(
  request: IncomingMessage,
  response: ServerResponse,
  authenticator: FlowDocBackendPdfExportAuthenticatorV1,
): Promise<FlowDocBackendPdfExportAuthenticatedIdentityV1 | null> {
  let result: FlowDocBackendPdfExportAuthenticationResultV1
  try {
    result = await authenticator.authenticate({ authorization: header(request, "authorization") })
  } catch {
    write(response, 503, { status: "unavailable" })
    return null
  }
  if (result.status !== "authenticated") {
    authenticationResponse(response, result)
    return null
  }
  return result.identity
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    length += bytes.byteLength
    if (length > MAX_BODY_BYTES) throw new Error("too-large")
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

function exactPin(url: URL): { documentId: string; documentRevision: number } | null {
  if ([...url.searchParams.keys()].sort().join("|") !== "documentId|documentRevision") return null
  const documentIds = url.searchParams.getAll("documentId")
  const revisions = url.searchParams.getAll("documentRevision")
  const revisionText = revisions[0] ?? ""
  const documentRevision = /^(0|[1-9][0-9]*)$/u.test(revisionText) ? Number(revisionText) : -1
  if (documentIds.length !== 1 || revisions.length !== 1
    || !isFlowDocBackendPdfExportBoundedStringV1(documentIds[0])
    || !Number.isSafeInteger(documentRevision) || documentRevision < 0) return null
  return { documentId: documentIds[0]!, documentRevision }
}

export function createFlowDocBackendDocGenLocalDraftPreviewHttpHandlerV1(
  options: FlowDocBackendDocGenLocalDraftPreviewHttpHandlerOptionsV1,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const isContext = url.pathname === FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_CONTEXT_HTTP_PATH_V1
    const isAdmission = url.pathname === FLOWDOC_BACKEND_DOCGEN_LOCAL_DRAFT_PREVIEW_ADMISSION_HTTP_PATH_V1
    if (!isContext && !isAdmission) return false
    if ((isContext && request.method !== "GET") || (isAdmission && request.method !== "POST")) {
      write(response, 405, { status: "method-not-allowed" }, { allow: isContext ? "GET" : "POST" })
      return true
    }
    const identity = await authenticate(request, response, options.authenticator)
    if (identity == null) return true

    if (isContext) {
      const pin = exactPin(url)
      if (pin == null) {
        write(response, 400, { status: "invalid-request" })
        return true
      }
      const context = options.registry.resolve(pin)
      let authorization: FlowDocBackendPdfExportAuthorizationResultV1
      try {
        authorization = await options.authorizer.authorize({
          identity,
          action: "docgen:inspect-draft-preview",
          ...pin,
          draft: context?.target.snapshot.draft ?? null,
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
      if (context == null) {
        write(response, 404, { status: "not-found" })
        return true
      }
      write(response, 200, { status: "ready", context })
      return true
    }

    if (header(request, "content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      write(response, 415, { status: "invalid-request" })
      return true
    }
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch (error) {
      write(response, error instanceof Error && error.message === "too-large" ? 413 : 400, { status: "invalid-request" })
      return true
    }
    const parsed = FlowDocBackendDocGenLocalDraftPreviewAdmissionRequestV1Schema.safeParse(body)
    const callerIdempotencyKey = header(request, "idempotency-key")
    if (!parsed.success || callerIdempotencyKey == null) {
      write(response, 400, { status: "invalid-request" })
      return true
    }
    const context = options.registry.resolveSnapshot(parsed.data.snapshot)
    let authorization: FlowDocBackendPdfExportAuthorizationResultV1
    try {
      authorization = await options.authorizer.authorize({
        identity,
        action: "docgen:admit-draft-preview",
        documentId: context?.authoring.documentId ?? "unknown",
        documentRevision: context?.authoring.documentRevision ?? -1,
        draft: context?.target.snapshot.draft ?? null,
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
    const result = await options.admission.admit({ identity, callerIdempotencyKey, request: parsed.data })
    if (result.status === "created" || result.status === "replayed") {
      write(response, result.status === "created" ? 202 : 200, { status: result.status, admission: result.receipt })
      return true
    }
    const status = result.status === "invalid-request" ? 400
      : result.status === "idempotency-conflict" ? 409
        : result.status === "blocked" ? 422 : 503
    write(response, status, { status: result.status, issues: result.issues })
    return true
  }
}
