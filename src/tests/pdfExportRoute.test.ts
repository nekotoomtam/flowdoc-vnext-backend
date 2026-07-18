import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  handleFlowDocBackendPdfExportRouteV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
} from "../index.js"
import {
  PDF_EXPORT_ROUTE_OTHER_AUTHORIZATION,
  PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
  PDF_EXPORT_ROUTE_CALLER_KEY,
  createPdfExportRouteFixture,
  pdfExportRouteDocumentPin,
} from "./helpers/pdfExportRouteFixture.js"
import { pdfExportWorkflowInput } from "./helpers/pdfExportWorkflowFixture.js"

describe("PDF export V-G authenticated route candidate", () => {
  const roots: string[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  function routeFixture(input: { deniedActions?: Parameters<typeof createPdfExportRouteFixture>[0]["deniedActions"] } = {}) {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-route-"))
    roots.push(root)
    return createPdfExportRouteFixture({
      contentStore: createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root }),
      deniedActions: input.deniedActions,
    })
  }

  function request(input: {
    authorization?: string | null
    body?: unknown
    idempotencyKey?: string | null
    method?: string
    path?: string
  } = {}) {
    return {
      method: input.method ?? "POST",
      path: input.path ?? "/pdf-exports",
      authorization: input.authorization === undefined ? PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION : input.authorization,
      idempotencyKey: input.idempotencyKey === undefined ? PDF_EXPORT_ROUTE_CALLER_KEY : input.idempotencyKey,
      body: input.body ?? null,
    }
  }

  it("requires authentication, enforces per-action authorization, and rejects caller identity fields", async () => {
    const fixture = routeFixture({ deniedActions: ["pdf-export:request"] })
    const pin = pdfExportRouteDocumentPin(fixture)
    const unauthenticated = await handleFlowDocBackendPdfExportRouteV1(request({
      authorization: null,
      body: pin,
    }), fixture.options)
    expect(unauthenticated).toMatchObject({
      httpStatus: 401,
      security: { authentication: "failed", authorization: "not-run" },
      headers: { "www-authenticate": "Bearer" },
    })

    const denied = await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), fixture.options)
    expect(denied).toMatchObject({
      httpStatus: 403,
      security: { authentication: "authenticated", authorization: "denied" },
    })

    const spoofed = await handleFlowDocBackendPdfExportRouteV1(request({
      body: { ...pin, tenantId: "tenant:spoofed", principalId: "principal:spoofed" },
    }), fixture.options)
    expect(spoofed).toMatchObject({
      httpStatus: 400,
      contracts: {
        tenantPrincipalFromCredentialOnly: true,
        callerIdentityFieldsAccepted: false,
        productionBinding: false,
      },
    })
    expect(fixture.resolverCalls()).toBe(0)
  })

  it("fails closed when identity or authorization evidence is malformed", async () => {
    const fixture = routeFixture()
    const pin = pdfExportRouteDocumentPin(fixture)
    const invalidIdentity = await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), {
      ...fixture.options,
      authenticator: {
        async authenticate() {
          return {
            status: "authenticated",
            identity: { tenantId: "tenant:flowdoc", principalId: "", authenticationId: "authentication:invalid" },
            issues: [],
          }
        },
      },
    })
    expect(invalidIdentity).toMatchObject({
      httpStatus: 401,
      security: { authentication: "failed", authorization: "not-run" },
    })
    const invalidAuthorization = await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), {
      ...fixture.options,
      authorizer: {
        async authorize() {
          return { status: "authorized", authorizationId: "", issues: [] }
        },
      },
    })
    expect(invalidAuthorization).toMatchObject({
      httpStatus: 503,
      security: { authentication: "authenticated", authorization: "unavailable" },
    })
  })

  it("creates one scoped operation, initializes lifecycle, and exactly replays the caller key", async () => {
    const fixture = routeFixture()
    const pin = pdfExportRouteDocumentPin(fixture)
    const first = await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), fixture.options)
    expect(first).toMatchObject({
      httpStatus: 202,
      security: { authentication: "authenticated", authorization: "authorized" },
      body: { kind: "json", value: { status: "created", export: { state: "pending", ...pin } } },
      contracts: { applicationServerMounted: false, automaticWorkerStart: false },
    })
    const replay = await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), fixture.options)
    expect(replay).toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { status: "idempotent-replay", export: { state: "pending" } } },
    })
    expect(fixture.resolverCalls()).toBe(1)

    const conflict = await handleFlowDocBackendPdfExportRouteV1(request({
      body: { documentId: "document:different", documentRevision: pin.documentRevision },
    }), fixture.options)
    expect(conflict.httpStatus).toBe(409)
  })

  it("repairs a missing lifecycle when operation admission survived alone", async () => {
    const fixture = routeFixture()
    const pin = pdfExportRouteDocumentPin(fixture)
    await fixture.repositories.operationRepository.admitOperation(fixture.workflowFixture.fixture.operation)
    const replay = await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), fixture.options)
    expect(replay).toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { status: "idempotent-replay", export: { state: "pending" } } },
    })
    expect(fixture.resolverCalls()).toBe(0)
    await expect(fixture.repositories.lifecycleRepository.readLifecycle({
      ...fixture.workflowFixture.fixture.operation.scope,
      operationId: fixture.workflowFixture.fixture.operation.operationId,
    })).resolves.toMatchObject({ status: "found", head: { status: "pending" } })
  })

  it("conceals another principal's operation before authorization", async () => {
    const fixture = routeFixture()
    const pin = pdfExportRouteDocumentPin(fixture)
    await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), fixture.options)
    fixture.authorizationCalls.length = 0
    const response = await handleFlowDocBackendPdfExportRouteV1(request({
      authorization: PDF_EXPORT_ROUTE_OTHER_AUTHORIZATION,
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(fixture.workflowFixture.fixture.operation.operationId)}`,
      idempotencyKey: null,
    }), fixture.options)
    expect(response).toMatchObject({
      httpStatus: 404,
      security: { authentication: "authenticated", authorization: "not-run" },
    })
    expect(fixture.authorizationCalls).toHaveLength(0)
  })

  it("replays cancellation and never cancels a persisted or terminal export", async () => {
    const fixture = routeFixture()
    const pin = pdfExportRouteDocumentPin(fixture)
    const operationId = fixture.workflowFixture.fixture.operation.operationId
    await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), fixture.options)
    const cancelRequest = request({
      body: null,
      idempotencyKey: "cancel-key:route",
      path: `/pdf-exports/${encodeURIComponent(operationId)}/cancel`,
    })
    const cancelled = await handleFlowDocBackendPdfExportRouteV1(cancelRequest, fixture.options)
    expect(cancelled).toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { status: "applied", state: "cancelled" } },
    })
    await expect(handleFlowDocBackendPdfExportRouteV1(cancelRequest, fixture.options)).resolves.toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { status: "idempotent-replay", state: "cancelled" } },
    })
    await expect(handleFlowDocBackendPdfExportRouteV1(request({
      body: null,
      idempotencyKey: "cancel-key:different",
      path: `/pdf-exports/${encodeURIComponent(operationId)}/cancel`,
    }), fixture.options)).resolves.toMatchObject({ httpStatus: 409 })

    const completedFixture = routeFixture()
    const completedPin = pdfExportRouteDocumentPin(completedFixture)
    await handleFlowDocBackendPdfExportRouteV1(request({ body: completedPin }), completedFixture.options)
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture: completedFixture.workflowFixture,
      repositories: completedFixture.repositories,
      contentStore: completedFixture.options.contentStore,
    }))
    if (completed.status === "blocked") throw new Error(JSON.stringify(completed.issues))
    await expect(handleFlowDocBackendPdfExportRouteV1(request({
      body: null,
      idempotencyKey: "cancel-key:after-complete",
      path: `/pdf-exports/${encodeURIComponent(completedFixture.workflowFixture.fixture.operation.operationId)}/cancel`,
    }), completedFixture.options)).resolves.toMatchObject({
      httpStatus: 409,
      body: { kind: "json", value: { status: "completed" } },
    })
  })

  it("reports terminal status and returns bytes only after exact physical verification", async () => {
    const fixture = routeFixture()
    const pin = pdfExportRouteDocumentPin(fixture)
    const operationId = fixture.workflowFixture.fixture.operation.operationId
    await handleFlowDocBackendPdfExportRouteV1(request({ body: pin }), fixture.options)
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(pdfExportWorkflowInput({
      fixture: fixture.workflowFixture,
      repositories: fixture.repositories,
      contentStore: fixture.options.contentStore,
    }))
    if (completed.status === "blocked") throw new Error(JSON.stringify(completed.issues))
    const status = await handleFlowDocBackendPdfExportRouteV1(request({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operationId)}`,
      idempotencyKey: null,
    }), fixture.options)
    expect(status).toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { status: "found", export: { state: "completed", terminalStatus: "completed" } } },
    })
    expect(JSON.stringify(status.body)).not.toMatch(/tenant:|principal:|storageKey|Fingerprint/u)
    const download = await handleFlowDocBackendPdfExportRouteV1(request({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operationId)}/download`,
      idempotencyKey: null,
    }), fixture.options)
    expect(download).toMatchObject({
      httpStatus: 200,
      headers: { "content-type": "application/pdf", "x-content-type-options": "nosniff" },
      body: { kind: "pdf" },
      contracts: { terminalCompletionRequiredForDownload: true, physicalByteVerificationRequiredForDownload: true },
    })
    if (download.body.kind !== "pdf") throw new Error("download did not return PDF bytes")
    expect(Buffer.from(download.body.bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-")

    const failed = await handleFlowDocBackendPdfExportRouteV1(request({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operationId)}/download`,
      idempotencyKey: null,
    }), {
      ...fixture.options,
      contentStore: {
        ...fixture.options.contentStore,
        async read() {
          return { status: "digest-mismatch", content: null, bytes: null, issues: [] }
        },
      },
    })
    expect(failed).toMatchObject({
      httpStatus: 503,
      body: { kind: "json", value: { status: "integrity-failed" } },
    })
  })
})
