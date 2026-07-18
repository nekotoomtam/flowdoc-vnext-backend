import type {
  FlowDocBackendPdfExportAuthenticatedIdentityV1,
  FlowDocBackendPdfExportRouteActionV1,
  FlowDocBackendPdfExportRouteOptionsV1,
} from "../../index.js"
import {
  createInMemoryPdfExportWorkflowRepositories,
  createPdfExportWorkflowFixture,
} from "./pdfExportWorkflowFixture.js"

export const PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION = "Bearer pdf-export-owner"
export const PDF_EXPORT_ROUTE_OTHER_AUTHORIZATION = "Bearer pdf-export-other"
export const PDF_EXPORT_ROUTE_CALLER_KEY = "caller-key:operation:pdf-export-route"

export function createPdfExportRouteFixture(input: {
  contentStore: FlowDocBackendPdfExportRouteOptionsV1["contentStore"]
  deniedActions?: FlowDocBackendPdfExportRouteActionV1[]
  operationId?: string
}): {
  workflowFixture: ReturnType<typeof createPdfExportWorkflowFixture>
  repositories: ReturnType<typeof createInMemoryPdfExportWorkflowRepositories>
  options: FlowDocBackendPdfExportRouteOptionsV1
  authorizationCalls: Array<{
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    action: FlowDocBackendPdfExportRouteActionV1
    documentId: string
    operationId: string | null
  }>
  resolverCalls: () => number
} {
  const workflowFixture = createPdfExportWorkflowFixture({
    operationId: input.operationId ?? "operation:pdf-export-route",
  })
  const repositories = createInMemoryPdfExportWorkflowRepositories()
  const authorizationCalls: Array<{
    identity: FlowDocBackendPdfExportAuthenticatedIdentityV1
    action: FlowDocBackendPdfExportRouteActionV1
    documentId: string
    operationId: string | null
  }> = []
  const denied = new Set(input.deniedActions ?? [])
  let resolved = 0
  const owner: FlowDocBackendPdfExportAuthenticatedIdentityV1 = {
    tenantId: workflowFixture.fixture.operation.scope.tenantId,
    principalId: workflowFixture.fixture.operation.scope.principalId,
    authenticationId: "authentication:pdf-export-owner",
  }
  const other: FlowDocBackendPdfExportAuthenticatedIdentityV1 = {
    tenantId: workflowFixture.fixture.operation.scope.tenantId,
    principalId: "principal:other",
    authenticationId: "authentication:pdf-export-other",
  }
  const options: FlowDocBackendPdfExportRouteOptionsV1 = {
    ...repositories,
    contentStore: input.contentStore,
    now: () => "2026-07-18T09:00:01.000Z",
    authenticator: {
      async authenticate({ authorization }) {
        if (authorization === PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION) return {
          status: "authenticated",
          identity: owner,
          issues: [],
        }
        if (authorization === PDF_EXPORT_ROUTE_OTHER_AUTHORIZATION) return {
          status: "authenticated",
          identity: other,
          issues: [],
        }
        if (authorization === "Bearer unavailable") return {
          status: "unavailable",
          identity: null,
          issues: [],
        }
        return { status: "unauthenticated", identity: null, issues: [] }
      },
    },
    authorizer: {
      async authorize(value) {
        authorizationCalls.push(structuredClone(value))
        if (denied.has(value.action)) return {
          status: "denied",
          authorizationId: null,
          issues: [],
        }
        return {
          status: "authorized",
          authorizationId: `authorization:${value.action}`,
          issues: [],
        }
      },
    },
    admissionResolver: {
      async resolve({ documentId, documentRevision }) {
        resolved += 1
        const fixture = workflowFixture.fixture
        const source = fixture.operation.admission.exportIdentity.sourceIdentity
        if (documentId !== source.documentId) return {
          status: "not-found",
          operationId: null,
          request: null,
          currentSource: null,
          measuredDrawContract: null,
          policy: null,
          issues: [],
        }
        if (documentRevision !== source.documentRevision) return {
          status: "stale",
          operationId: null,
          request: null,
          currentSource: null,
          measuredDrawContract: null,
          policy: null,
          issues: [],
        }
        return {
          status: "ready",
          operationId: fixture.operation.operationId,
          request: fixture.request,
          currentSource: fixture.currentSource,
          measuredDrawContract: fixture.measuredDrawContract,
          policy: fixture.operation.admission.policy,
          issues: [],
        }
      },
    },
  }
  return {
    workflowFixture,
    repositories,
    options,
    authorizationCalls,
    resolverCalls: () => resolved,
  }
}

export function pdfExportRouteDocumentPin(
  fixture: ReturnType<typeof createPdfExportRouteFixture>,
) {
  const source = fixture.workflowFixture.fixture.operation.admission.exportIdentity.sourceIdentity
  return { documentId: source.documentId, documentRevision: source.documentRevision }
}
