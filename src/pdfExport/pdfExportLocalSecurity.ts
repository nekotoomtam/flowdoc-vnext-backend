import { createHash, timingSafeEqual } from "node:crypto"
import type {
  FlowDocBackendPdfExportAuthenticatedIdentityV1,
  FlowDocBackendPdfExportAuthenticatorV1,
  FlowDocBackendPdfExportAuthorizerV1,
} from "./pdfExportRoute.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_SECURITY_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-security" as const

export interface FlowDocBackendPdfExportLocalSecurityOptionsV1 {
  bearerToken: string
  documentId: string
  tenantId?: string
  principalId?: string
}

export interface FlowDocBackendPdfExportLocalSecurityV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_SECURITY_V1_SOURCE
    runtimeProfile: "local-integration"
    credentialMode: "local-bearer"
    credentialFingerprint: string
    identityFromCredentialOnly: true
    authorizationPerAction: true
    remoteIdentityProvider: false
    productionBinding: false
  }
  identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
  authenticator: FlowDocBackendPdfExportAuthenticatorV1
  authorizer: FlowDocBackendPdfExportAuthorizerV1
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function exactCredential(actual: string, expected: string): boolean {
  const actualDigest = Buffer.from(digest(actual), "hex")
  const expectedDigest = Buffer.from(digest(expected), "hex")
  return timingSafeEqual(actualDigest, expectedDigest)
}

export function createFlowDocBackendPdfExportLocalSecurityV1(
  options: FlowDocBackendPdfExportLocalSecurityOptionsV1,
): FlowDocBackendPdfExportLocalSecurityV1 {
  if (
    typeof options.bearerToken !== "string"
    || options.bearerToken.length < 32
    || options.bearerToken.length > 512
    || /\s/u.test(options.bearerToken)
  ) throw new Error("local PDF bearer token must contain 32 through 512 non-whitespace characters")
  if (typeof options.documentId !== "string" || options.documentId.trim().length === 0) {
    throw new Error("local PDF security requires one trusted document identity")
  }
  const credentialFingerprint = `sha256:${digest(options.bearerToken)}`
  const identity: FlowDocBackendPdfExportAuthenticatedIdentityV1 = {
    tenantId: options.tenantId ?? "tenant:flowdoc-pdf-local",
    principalId: options.principalId ?? "principal:flowdoc-pdf-local-operator",
    authenticationId: `authentication:pdf-local:${credentialFingerprint.slice("sha256:".length, 32)}`,
  }

  return {
    facts: {
      source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_SECURITY_V1_SOURCE,
      runtimeProfile: "local-integration",
      credentialMode: "local-bearer",
      credentialFingerprint,
      identityFromCredentialOnly: true,
      authorizationPerAction: true,
      remoteIdentityProvider: false,
      productionBinding: false,
    },
    identity,
    authenticator: {
      async authenticate({ authorization }) {
        const prefix = "Bearer "
        if (authorization == null || !authorization.startsWith(prefix)) {
          return { status: "unauthenticated", identity: null, issues: [] }
        }
        const token = authorization.slice(prefix.length)
        if (!exactCredential(token, options.bearerToken)) {
          return { status: "unauthenticated", identity: null, issues: [] }
        }
        return { status: "authenticated", identity: structuredClone(identity), issues: [] }
      },
    },
    authorizer: {
      async authorize(input) {
        const identityMatches = input.identity.tenantId === identity.tenantId
          && input.identity.principalId === identity.principalId
          && input.identity.authenticationId === identity.authenticationId
        if (!identityMatches || input.documentId !== options.documentId) {
          return { status: "denied", authorizationId: null, issues: [] }
        }
        return {
          status: "authorized",
          authorizationId: `authorization:pdf-local:${input.action}`,
          issues: [],
        }
      },
    },
  }
}
