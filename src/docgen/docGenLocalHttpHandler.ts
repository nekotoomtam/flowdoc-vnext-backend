import type { IncomingMessage, ServerResponse } from "node:http"
import type { VNextPublishedStructureVersionRefV1 } from "@flowdoc/vnext-core"
import {
  FlowDocBackendDocGenLocalAdmissionRequestV1Schema,
  type FlowDocBackendDocGenLocalAdmissionIssueV1,
  type FlowDocBackendDocGenLocalAdmissionServiceV1,
} from "./docGenLocalAdmission.js"
import type {
  FlowDocBackendPdfExportAuthenticatedIdentityV1,
  FlowDocBackendPdfExportAuthenticationResultV1,
  FlowDocBackendPdfExportAuthenticatorV1,
  FlowDocBackendPdfExportAuthorizationResultV1,
} from "../pdfExport/pdfExportRoute.js"

export const FLOWDOC_BACKEND_DOCGEN_LOCAL_HTTP_PATH_V1 = "/docgen-local/admissions" as const
export const FLOWDOC_BACKEND_DOCGEN_LOCAL_HTTP_MAX_BODY_BYTES_V1 = 2 * 1024 * 1024

export interface FlowDocBackendDocGenLocalAuthorizerV1 {
  authorize(input: {
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    action: "docgen:admit"
    structure: VNextPublishedStructureVersionRefV1
  }): Promise<FlowDocBackendPdfExportAuthorizationResultV1>
}

export interface FlowDocBackendDocGenLocalHttpHandlerOptionsV1 {
  authenticator: FlowDocBackendPdfExportAuthenticatorV1
  authorizer: FlowDocBackendDocGenLocalAuthorizerV1
  admission: FlowDocBackendDocGenLocalAdmissionServiceV1
  maxBodyBytes?: number
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name]
  if (Array.isArray(value)) return value.length === 1 ? value[0]! : null
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function responseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extra,
  }
}

function write(response: ServerResponse, status: number, value: unknown, extraHeaders?: Record<string, string>): void {
  response.writeHead(status, responseHeaders(extraHeaders))
  response.end(JSON.stringify(value))
}

function problem(code: string, path: string, message: string): FlowDocBackendDocGenLocalAdmissionIssueV1 {
  return { severity: "error", code, path, message }
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
  if (exceeded) throw new Error("docgen-request-body-too-large")
  const raw = Buffer.concat(chunks).toString("utf8")
  if (raw.trim().length === 0) throw new Error("docgen-request-json-invalid")
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error("docgen-request-json-invalid")
  }
}

function authenticationResponse(
  response: ServerResponse,
  result: Exclude<FlowDocBackendPdfExportAuthenticationResultV1, { status: "authenticated" }>,
): void {
  const unavailable = result.status === "unavailable"
  write(response, unavailable ? 503 : 401, {
    status: unavailable ? "unavailable" : "unauthenticated",
    issues: [problem(
      unavailable ? "docgen-authentication-unavailable" : "docgen-authentication-required",
      "authorization",
      unavailable ? "authentication provider is unavailable" : "Bearer authentication is required",
    )],
  }, unavailable ? undefined : { "www-authenticate": "Bearer" })
}

function authorizationResponse(
  response: ServerResponse,
  result: Exclude<FlowDocBackendPdfExportAuthorizationResultV1, { status: "authorized" }>,
): void {
  const unavailable = result.status === "unavailable"
  write(response, unavailable ? 503 : 403, {
    status: unavailable ? "unavailable" : "forbidden",
    issues: [problem(
      unavailable ? "docgen-authorization-unavailable" : "docgen-authorization-denied",
      "structure",
      unavailable ? "authorization provider is unavailable" : "principal is not authorized for this Structure",
    )],
  })
}

export function createFlowDocBackendDocGenLocalHttpHandlerV1(
  options: FlowDocBackendDocGenLocalHttpHandlerOptionsV1,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  const maximum = options.maxBodyBytes ?? FLOWDOC_BACKEND_DOCGEN_LOCAL_HTTP_MAX_BODY_BYTES_V1
  if (
    !Number.isSafeInteger(maximum)
    || maximum < 1
    || maximum > FLOWDOC_BACKEND_DOCGEN_LOCAL_HTTP_MAX_BODY_BYTES_V1
  ) throw new Error("DocGen HTTP body limit must be positive and no greater than the E.3 maximum")

  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== FLOWDOC_BACKEND_DOCGEN_LOCAL_HTTP_PATH_V1) return false
    if (request.method !== "POST") {
      write(response, 405, {
        status: "method-not-allowed",
        issues: [problem("docgen-method-not-allowed", "method", "local DocGen admission requires POST")],
      }, { allow: "POST" })
      return true
    }
    if (header(request, "content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      write(response, 415, {
        status: "invalid-request",
        issues: [problem(
          "docgen-content-type-unsupported",
          "contentType",
          "local DocGen admission requires application/json",
        )],
      })
      return true
    }

    let body: unknown
    try {
      body = await readJsonBody(request, maximum)
    } catch (error) {
      const code = error instanceof Error ? error.message : "docgen-request-json-invalid"
      write(response, code === "docgen-request-body-too-large" ? 413 : 400, {
        status: "invalid-request",
        issues: [problem(
          code,
          "body",
          code === "docgen-request-body-too-large"
            ? "local DocGen request body exceeds the configured byte limit"
            : "local DocGen request body must contain valid JSON",
        )],
      })
      return true
    }

    let authentication: FlowDocBackendPdfExportAuthenticationResultV1
    try {
      authentication = await options.authenticator.authenticate({
        authorization: header(request, "authorization"),
      })
    } catch {
      write(response, 503, {
        status: "unavailable",
        issues: [problem(
          "docgen-authentication-unavailable",
          "authorization",
          "authentication provider is unavailable",
        )],
      })
      return true
    }
    if (authentication.status !== "authenticated") {
      authenticationResponse(response, authentication)
      return true
    }

    const parsed = FlowDocBackendDocGenLocalAdmissionRequestV1Schema.safeParse(body)
    if (!parsed.success) {
      write(response, 400, {
        status: "invalid-request",
        issues: [problem(
          "docgen-request-invalid",
          "body",
          "DocGen admission request does not match the strict local contract",
        )],
      })
      return true
    }
    const callerIdempotencyKey = header(request, "idempotency-key")
    if (callerIdempotencyKey == null) {
      write(response, 400, {
        status: "invalid-request",
        issues: [problem(
          "docgen-idempotency-key-required",
          "idempotencyKey",
          "Idempotency-Key is required",
        )],
      })
      return true
    }

    let authorization: FlowDocBackendPdfExportAuthorizationResultV1
    try {
      authorization = await options.authorizer.authorize({
        identity: authentication.identity,
        action: "docgen:admit",
        structure: parsed.data.structure,
      })
    } catch {
      write(response, 503, {
        status: "unavailable",
        issues: [problem(
          "docgen-authorization-unavailable",
          "structure",
          "authorization provider is unavailable",
        )],
      })
      return true
    }
    if (authorization.status !== "authorized") {
      authorizationResponse(response, authorization)
      return true
    }

    const result = await options.admission.admit({
      identity: authentication.identity,
      callerIdempotencyKey,
      request: parsed.data,
    })
    if (result.status === "created" || result.status === "replayed") {
      write(response, result.status === "created" ? 202 : 200, {
        status: result.status,
        admission: result.receipt,
      })
      return true
    }
    const status = result.status === "invalid-request"
      ? 400
      : result.status === "idempotency-conflict"
        ? 409
        : result.status === "blocked"
          ? 422
          : 503
    write(response, status, { status: result.status, issues: result.issues })
    return true
  }
}
