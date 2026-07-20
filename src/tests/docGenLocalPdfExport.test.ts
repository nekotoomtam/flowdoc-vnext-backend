import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createVNextPdfMeasuredDrawContractV1,
  type VNextPdfMeasuredDrawContractRequestV1,
} from "@flowdoc/vnext-core"
import thaiOnePageRequest from "@flowdoc/vnext-core/fixtures/pdf-pilot-thai-one-page-request.v1.json" with { type: "json" }
import {
  createFlowDocBackendDocGenLocalArtifactBindingV1,
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  handleFlowDocBackendPdfExportRouteV1,
  runFlowDocBackendPdfExportEndToEndCandidateV1,
  type FlowDocBackendDocGenLocalArtifactMaterializerV1,
  type FlowDocBackendPdfExportAuthenticatedIdentityV1,
} from "../index.js"
import {
  DOCGEN_LOCAL_AUTHORIZATION,
  DOCGEN_LOCAL_IDENTITY,
  createDocGenLocalAdmissionFixture,
  docGenLocalDirectRequest,
} from "./helpers/docGenLocalFixture.js"
import { createInMemoryPdfExportWorkflowRepositories } from "./helpers/pdfExportWorkflowFixture.js"

interface SubsetManifestV1 {
  subsetId: string
  fontId: string
  postScriptName: string
  subsetPrefix: string
  source: { path: string }
  subset: { path: string; sha256: string }
}

const CORE_ROOT = resolve(process.cwd(), "../flowdoc-vnext-core")
const CALLER_KEY = "pdf-export:docgen-e4:test"

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(CORE_ROOT, path), "utf8")) as T
}

function materializer(onMaterialize?: () => void): FlowDocBackendDocGenLocalArtifactMaterializerV1 {
  const measuredRequest = structuredClone(thaiOnePageRequest) as VNextPdfMeasuredDrawContractRequestV1
  measuredRequest.rendererProfileId = "flowdoc-local-measured-document-v1"
  const measuredDrawContract = createVNextPdfMeasuredDrawContractV1(measuredRequest)
  if (measuredDrawContract.status !== "consumable") throw new Error(JSON.stringify(measuredDrawContract.issues))
  const manifest = readJson<SubsetManifestV1>(
    "packages/pdf-renderer-pilot/fixtures/font-subset-manifest.v1.json",
  )
  const sourceBytes = readFileSync(resolve(CORE_ROOT, manifest.source.path))
  const subsetBytes = readFileSync(resolve(CORE_ROOT, manifest.subset.path))
  const glyphCount = measuredDrawContract.pages.reduce((sum, page) => sum + page.commands.reduce(
    (pageSum, command) => pageSum + (command.kind === "glyph-run" ? command.glyphs.length : 0),
    0,
  ), 0)
  return {
    materializerId: "materializer:docgen-e4-test",
    materializerVersion: "1.0.0",
    implementationFingerprint: `sha256:${"6".repeat(64)}`,
    rendererProfileId: measuredDrawContract.rendererProfileId,
    measurementProfileId: measuredDrawContract.measurementProfileId,
    async materialize() {
      onMaterialize?.()
      return {
        status: "ready",
        materializationFingerprint: `sha256:${"1".repeat(64)}`,
        resolutionFingerprint: `sha256:${"2".repeat(64)}`,
        measuredPlanFingerprint: `sha256:${"3".repeat(64)}`,
        measuredBundleFingerprint: `sha256:${"4".repeat(64)}`,
        artifactInputFingerprint: `sha256:${"5".repeat(64)}`,
        measuredDrawContract: structuredClone(measuredDrawContract),
        fontResources: [{
          fontId: manifest.fontId,
          subsetId: manifest.subsetId,
          subsetPrefix: manifest.subsetPrefix,
          postScriptName: manifest.postScriptName,
          subsetSha256: manifest.subset.sha256,
          sourceBytes: new Uint8Array(sourceBytes),
          subsetBytes: new Uint8Array(subsetBytes),
        }],
        imageResources: [],
        summary: {
          pageCount: measuredDrawContract.summary.pageCount,
          paintCommandCount: measuredDrawContract.summary.paintCommandCount,
          glyphCount,
          imageAssetCount: 0,
        },
        issues: [],
      }
    },
  }
}

function security() {
  return {
    authenticator: {
      async authenticate({ authorization }: { authorization: string | null }) {
        if (authorization !== DOCGEN_LOCAL_AUTHORIZATION) return {
          status: "unauthenticated" as const,
          identity: null,
          issues: [] as [],
        }
        return { status: "authenticated" as const, identity: DOCGEN_LOCAL_IDENTITY, issues: [] as [] }
      },
    },
    authorizer: {
      async authorize() {
        return { status: "authorized" as const, authorizationId: "authorization:docgen-e4-test", issues: [] as [] }
      },
    },
  }
}

describe("PDF export REALDOC-E.4 admitted DocGen artifact binding", () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  it("reuses the authenticated route, worker workflow, persistence, status, and verified download", async () => {
    let materializationCount = 0
    const docgen = createDocGenLocalAdmissionFixture()
    const admitted = await docgen.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:e4:source",
      request: docGenLocalDirectRequest(),
    })
    if (admitted.status !== "created") throw new Error(JSON.stringify(admitted.issues))
    const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
      repository: docgen.repository,
      assets: docgen.assets,
      materializer: materializer(() => { materializationCount += 1 }),
      operationIdFactory: () => "test-operation",
    })
    expect(binding.facts.durableGenerationPersistence).toBe(false)
    const repositories = createInMemoryPdfExportWorkflowRepositories()
    const root = mkdtempSync(join(tmpdir(), "flowdoc-docgen-e4-"))
    roots.push(root)
    const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
    const options = {
      ...security(),
      ...repositories,
      contentStore,
      admissionResolver: binding.admissionResolver,
      now: () => "2026-07-19T11:00:00.000Z",
    }
    const routeRequest = {
      method: "POST",
      path: "/pdf-exports",
      authorization: DOCGEN_LOCAL_AUTHORIZATION,
      idempotencyKey: CALLER_KEY,
      body: {
        documentId: admitted.receipt.instance.instanceId,
        documentRevision: admitted.receipt.instance.revision,
      },
    }
    const created = await handleFlowDocBackendPdfExportRouteV1(routeRequest, options)
    expect(created).toMatchObject({
      httpStatus: 202,
      body: { kind: "json", value: { status: "created", export: { state: "pending" } } },
    })
    expect(JSON.stringify(created.body)).not.toContain("Private report")
    expect(materializationCount).toBe(1)

    const replay = await handleFlowDocBackendPdfExportRouteV1(routeRequest, options)
    expect(replay).toMatchObject({ httpStatus: 200, body: { kind: "json", value: { status: "idempotent-replay" } } })
    expect(materializationCount).toBe(1)

    const found = await repositories.operationRepository.readByCallerKey({
      tenantId: DOCGEN_LOCAL_IDENTITY.tenantId,
      principalId: DOCGEN_LOCAL_IDENTITY.principalId,
      callerIdempotencyKey: CALLER_KEY,
    })
    if (found.status !== "found") throw new Error("DocGen PDF operation was not admitted")
    const operation = found.operation
    const claimToken = "claim:docgen-e4:test"
    await expect(repositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: `claim:${operation.operationId}:attempt:1`,
      ...operation.scope,
      operationId: operation.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-19T11:00:01.000Z",
      kind: "claim",
      claimToken,
      workerId: "worker:docgen-e4:test",
      claimExpiresAt: "2026-07-19T11:03:01.000Z",
    })).resolves.toMatchObject({ status: "applied" })
    await expect(repositories.lifecycleRepository.applyLifecycleTransition({
      transitionId: `before-handoff:${operation.operationId}:attempt:1`,
      ...operation.scope,
      operationId: operation.operationId,
      expectedHeadRevision: 1,
      transitionAt: "2026-07-19T11:00:02.000Z",
      kind: "pass-checkpoint",
      claimToken,
      nextCheckpoint: "before-render",
    })).resolves.toMatchObject({ status: "applied" })
    const lifecycle = await repositories.lifecycleRepository.readLifecycle({
      ...operation.scope,
      operationId: operation.operationId,
    })
    if (lifecycle.status !== "found") throw new Error("DocGen PDF lifecycle was not initialized")
    const workflowInput = await binding.createWorkflowInput({
      entry: {
        source: "flowdoc-backend-pdf-export-due-work",
        operationId: operation.operationId,
        scope: operation.scope,
        dueAt: "2026-07-19T11:00:00.000Z",
        lane: "claim-ready",
        headRevision: lifecycle.head.headRevision,
        lifecycleFingerprint: lifecycle.head.lifecycleFingerprint,
        head: lifecycle.head,
      },
      operation,
      lifecycleHead: lifecycle.head,
      workerId: "worker:docgen-e4:test",
      claimToken,
      ownsClaim: true,
      attemptNumber: 1,
      now: () => "2026-07-19T11:00:03.000Z",
    }, { ...repositories, contentStore })
    const completed = await runFlowDocBackendPdfExportEndToEndCandidateV1(workflowInput)
    if (completed.status !== "completed") throw new Error(JSON.stringify(completed))
    expect(materializationCount).toBe(1)

    const status = await handleFlowDocBackendPdfExportRouteV1({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operation.operationId)}`,
      authorization: DOCGEN_LOCAL_AUTHORIZATION,
      idempotencyKey: null,
      body: null,
    }, options)
    expect(status).toMatchObject({
      httpStatus: 200,
      body: { kind: "json", value: { export: { state: "completed", pageCount: 1 } } },
    })
    const download = await handleFlowDocBackendPdfExportRouteV1({
      method: "GET",
      path: `/pdf-exports/${encodeURIComponent(operation.operationId)}/download`,
      authorization: DOCGEN_LOCAL_AUTHORIZATION,
      idempotencyKey: null,
      body: null,
    }, options)
    expect(download).toMatchObject({ httpStatus: 200, body: { kind: "pdf" } })
    if (download.body.kind !== "pdf") throw new Error("DocGen PDF download did not return bytes")
    expect(Buffer.from(download.body.bytes).subarray(0, 5).toString("ascii")).toBe("%PDF-")
  })

  it("conceals other scopes and changes downstream source identity when canonical data changes", async () => {
    const first = createDocGenLocalAdmissionFixture()
    const second = createDocGenLocalAdmissionFixture()
    const firstAdmission = await first.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:e4:first",
      request: docGenLocalDirectRequest({ title: "First", name: "Item", amount: 1 }),
    })
    const secondAdmission = await second.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:e4:second",
      request: docGenLocalDirectRequest({ title: "Second", name: "Item", amount: 1 }),
    })
    if (firstAdmission.status !== "created" || secondAdmission.status !== "created") throw new Error("admission failed")
    const firstBinding = createFlowDocBackendDocGenLocalArtifactBindingV1({
      repository: first.repository,
      assets: first.assets,
      materializer: materializer(),
      operationIdFactory: () => "first",
    })
    const secondBinding = createFlowDocBackendDocGenLocalArtifactBindingV1({
      repository: second.repository,
      assets: second.assets,
      materializer: materializer(),
      operationIdFactory: () => "second",
    })
    const resolveFor = (binding: typeof firstBinding, identity: FlowDocBackendPdfExportAuthenticatedIdentityV1, documentId: string) => (
      binding.admissionResolver.resolve({ identity, documentId, documentRevision: 0, acceptedAt: "2026-07-19T12:00:00.000Z" })
    )
    const resolvedFirst = await resolveFor(firstBinding, DOCGEN_LOCAL_IDENTITY, firstAdmission.receipt.instance.instanceId)
    const resolvedSecond = await resolveFor(secondBinding, DOCGEN_LOCAL_IDENTITY, secondAdmission.receipt.instance.instanceId)
    expect(resolvedFirst.status).toBe("ready")
    expect(resolvedSecond.status).toBe("ready")
    if (resolvedFirst.status !== "ready" || resolvedSecond.status !== "ready") throw new Error("resolution failed")
    expect(resolvedSecond.currentSource.documentFingerprint).not.toBe(resolvedFirst.currentSource.documentFingerprint)
    expect(resolvedSecond.request.requestFingerprint).not.toBe(resolvedFirst.request.requestFingerprint)

    await expect(resolveFor(firstBinding, {
      ...DOCGEN_LOCAL_IDENTITY,
      principalId: "principal:other",
    }, firstAdmission.receipt.instance.instanceId)).resolves.toMatchObject({ status: "not-found" })
  })
})
