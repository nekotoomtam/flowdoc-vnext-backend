import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportLocalCanonicalEvidenceV1,
  createFlowDocBackendPdfExportLocalHttpServerV1,
  createFlowDocBackendPdfExportLocalSecurityV1,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
  loadFlowDocBackendPdfExportLocalHttpConfigV1,
} from "../index.js"
import {
  PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
  createPdfExportRouteFixture,
  pdfExportRouteDocumentPin,
} from "./helpers/pdfExportRouteFixture.js"

const roots: string[] = []
const CORE_ROOT = resolve(process.cwd(), "../flowdoc-vnext-core")
const REPORT_ROOT = resolve(process.cwd(), "../ocr-benchmark-skeleton/reports/INV_9437125258")
const CANONICAL_AVAILABLE = existsSync(resolve(
  REPORT_ROOT,
  "assets/source_evidence.png",
))

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function contentStore() {
  const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-local-e-http-"))
  roots.push(root)
  return createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
}

describe("PDF export LOCAL-E composition", () => {
  it("mounts the V-G route only after explicit loopback start and exposes no CORS", async () => {
    const fixture = createPdfExportRouteFixture({ contentStore: contentStore() })
    const localServer = createFlowDocBackendPdfExportLocalHttpServerV1({
      host: "127.0.0.1",
      port: 0,
      routeOptions: fixture.options,
    })
    expect(localServer.server.address()).toBeNull()
    expect(localServer.readEvidence()).toMatchObject({
      runtimeProfile: "local-integration",
      localServerMounted: false,
      defaultApplicationServerMounted: false,
      listenerScope: "loopback-only",
      workerStart: "dedicated-command",
      remoteProviderCallsAllowed: false,
      automaticListenerStart: false,
      productionBinding: false,
    })

    try {
      const mounted = await localServer.start()
      expect(mounted).toMatchObject({
        localServerMounted: true,
        listenerHost: "127.0.0.1",
        listenerPort: expect.any(Number),
      })
      const origin = `http://127.0.0.1:${mounted.listenerPort}`
      const health = await fetch(`${origin}/pdf-export-local/health`)
      expect(health.status).toBe(200)
      expect(health.headers.get("access-control-allow-origin")).toBeNull()
      await expect(health.json()).resolves.toMatchObject({
        service: "flowdoc-pdf-export-local",
        status: "ready",
        composition: {
          localServerMounted: true,
          defaultApplicationServerMounted: false,
          productionBinding: false,
        },
      })

      const admitted = await fetch(`${origin}/pdf-exports`, {
        method: "POST",
        headers: {
          authorization: PDF_EXPORT_ROUTE_OWNER_AUTHORIZATION,
          "content-type": "application/json",
          "idempotency-key": "caller-key:local-e:http-explicit-start",
        },
        body: JSON.stringify(pdfExportRouteDocumentPin(fixture)),
      })
      expect(admitted.status).toBe(202)
      expect(admitted.headers.get("access-control-allow-origin")).toBeNull()
      await expect(admitted.json()).resolves.toMatchObject({
        status: "created",
        export: { state: "pending" },
      })
      expect(fixture.resolverCalls()).toBe(1)
    } finally {
      await localServer.close()
    }
    expect(localServer.server.address()).toBeNull()
  })

  it("derives the local scope only from the exact bearer and authorizes each action", async () => {
    const token = "local-e-unit-token-0123456789abcdef0123456789"
    const security = createFlowDocBackendPdfExportLocalSecurityV1({
      bearerToken: token,
      documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
    })
    await expect(security.authenticator.authenticate({ authorization: null })).resolves.toMatchObject({
      status: "unauthenticated",
      identity: null,
    })
    await expect(security.authenticator.authenticate({ authorization: "Bearer wrong-token" })).resolves
      .toMatchObject({ status: "unauthenticated", identity: null })
    const authenticated = await security.authenticator.authenticate({ authorization: `Bearer ${token}` })
    expect(authenticated).toMatchObject({ status: "authenticated", identity: security.identity })
    expect(JSON.stringify(security.facts)).not.toContain(token)
    if (authenticated.status !== "authenticated") throw new Error("local security fixture did not authenticate")
    for (const action of [
      "pdf-export:request",
      "pdf-export:read",
      "pdf-export:cancel",
      "pdf-export:download",
    ] as const) {
      await expect(security.authorizer.authorize({
        identity: authenticated.identity,
        action,
        documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
        operationId: action === "pdf-export:request" ? null : "operation:local-e",
      })).resolves.toMatchObject({ status: "authorized" })
    }
    await expect(security.authorizer.authorize({
      identity: authenticated.identity,
      action: "pdf-export:request",
      documentId: "document:other",
      operationId: null,
    })).resolves.toMatchObject({ status: "denied" })
  })

  ;(CANONICAL_AVAILABLE ? it : it.skip)(
    "loads only the digest-pinned canonical document revision for admission",
    async () => {
      const identity = {
        tenantId: "tenant:flowdoc-pdf-local",
        principalId: "principal:flowdoc-pdf-local-operator",
        authenticationId: "authentication:pdf-local:test",
      }
      const evidence = await createFlowDocBackendPdfExportLocalCanonicalEvidenceV1({
        coreRoot: CORE_ROOT,
        reportRoot: REPORT_ROOT,
        identity,
        operationIdFactory: () => "unit-canonical",
      })
      expect(evidence.facts).toMatchObject({
        runtimeProfile: "local-integration",
        lane: "canonical-evidence",
        documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
        documentRevision: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
        resourceDigestsVerifiedBeforeUse: true,
        fixtureSubstitutionAllowed: false,
        expectedPdfByteLength: 1_212_656,
        expectedPdfSha256: "c4d09f0dfd66e1e3983bc679602fdc7d397de30edcb4f93fac3a0fa0c422960b",
        productionBinding: false,
      })
      expect(evidence.qualification.profiles.measurementProfileId.length).toBeGreaterThan(512)
      const resolved = await evidence.admissionResolver.resolve({
        identity,
        documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
        documentRevision: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
        acceptedAt: "2026-07-18T10:00:00.000Z",
      })
      expect(resolved).toMatchObject({
        status: "ready",
        operationId: "operation:pdf-local-e:unit-canonical",
        request: {
          expectedSource: {
            documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
            documentRevision: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_REVISION,
            documentFingerprint: "sha256:96c48b7287fc0c5532059cf8ad4ff135df5f07fb63bfe6bf6054e150775a8b67",
            sourcePackageId: "body-display-list:ocr-benchmark-report-body-display-list-v1",
          },
          measuredDrawContract: { pageCount: 13 },
        },
      })
      if (resolved.status !== "ready") throw new Error("canonical admission fixture was not ready")
      expect(resolved.request.measuredDrawContract.measurementProfileId).toBe(
        evidence.qualification.profiles.measurementProfileId,
      )
      await expect(evidence.admissionResolver.resolve({
        identity,
        documentId: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CANONICAL_DOCUMENT_ID,
        documentRevision: 2,
        acceptedAt: "2026-07-18T10:00:00.000Z",
      })).resolves.toMatchObject({ status: "stale" })
      await expect(evidence.admissionResolver.resolve({
        identity,
        documentId: "document:product-substitution-forbidden",
        documentRevision: 1,
        acceptedAt: "2026-07-18T10:00:00.000Z",
      })).resolves.toMatchObject({ status: "not-found" })
    },
    20_000,
  )

  it("fails closed for a non-loopback or incomplete HTTP command profile", () => {
    const base = {
      FLOWDOC_PDF_LOCAL_RUNTIME_PROFILE: "local-integration",
      FLOWDOC_PDF_LOCAL_INTEGRATION: "1",
      FLOWDOC_PDF_LOCAL_POSTGRES_URL: "postgresql://local:secret@127.0.0.1:55432/local",
      FLOWDOC_PDF_LOCAL_S3_ENDPOINT: "http://127.0.0.1:59000",
      FLOWDOC_PDF_LOCAL_S3_REGION: "us-east-1",
      FLOWDOC_PDF_LOCAL_S3_BUCKET: "flowdoc-pdf-local",
      FLOWDOC_PDF_LOCAL_S3_ACCESS_KEY_ID: "local-access",
      FLOWDOC_PDF_LOCAL_S3_SECRET_ACCESS_KEY: "local-secret-value",
      FLOWDOC_PDF_LOCAL_HTTP_HOST: "0.0.0.0",
      FLOWDOC_PDF_LOCAL_HTTP_PORT: "4012",
      FLOWDOC_PDF_LOCAL_BEARER_TOKEN: "local-e-config-token-0123456789abcdef012345",
    }
    expect(() => loadFlowDocBackendPdfExportLocalHttpConfigV1({ env: base })).toThrow("exactly 127.0.0.1")
    expect(() => loadFlowDocBackendPdfExportLocalHttpConfigV1({
      env: { ...base, FLOWDOC_PDF_LOCAL_HTTP_HOST: "127.0.0.1", FLOWDOC_PDF_LOCAL_BEARER_TOKEN: "" },
    })).toThrow("FLOWDOC_PDF_LOCAL_BEARER_TOKEN is required")
  })
})
