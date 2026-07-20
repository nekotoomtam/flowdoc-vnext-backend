import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type {
  ImageAssetRegistryV1,
  VNextPublishedStructureGenerationDataContractV1,
  VNextPublishedStructureMappingProfileV1,
  VNextPublishedStructureMappingRuntimeV1,
  VNextPublishedStructureTestInputProjectionV1,
} from "@flowdoc/vnext-core"
import {
  createFlowDocBackendDocGenInMemoryAdmissionRepositoryV1,
  createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1,
  createFlowDocBackendDocGenLocalAdmissionServiceV1,
  createFlowDocBackendDocGenTrustedStructureRegistryV1,
  type FlowDocBackendDocGenLocalAdmissionRequestV1,
  type FlowDocBackendDocGenTrustedAssetBytesV1,
} from "../docgen/docGenLocalAdmission.js"
import { createFlowDocBackendDocGenLocalArtifactBindingV1 } from "../docgen/docGenLocalPdfExport.js"
import { createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1 } from "../docgen/docGenLocalPublishedPreview.js"
import { createFlowDocBackendDocGenLocalUatArtifactMaterializerV1 } from "../docgen/docGenLocalUatArtifact.js"
import { createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1 } from "../pdfExport/pdfExportArtifactPersistence.js"
import { createFlowDocBackendPdfExportFileContentAddressedStoreV1 } from "../pdfExport/pdfExportContentAddressedStore.js"
import { createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1 } from "../pdfExport/pdfExportLifecycleRepository.js"
import { createFlowDocBackendPdfExportLocalHttpServerV1 } from "../pdfExport/pdfExportLocalHttpServer.js"
import { createInMemoryFlowDocBackendPdfExportObservabilityRepositoryV1 } from "../pdfExport/pdfExportObservability.js"
import {
  createInMemoryFlowDocBackendPdfExportOperationRepositoryV1,
  type FlowDocBackendPdfExportOperationRepositoryV1,
} from "../pdfExport/pdfExportOperationRepository.js"
import type { FlowDocBackendPdfExportAuthenticatedIdentityV1 } from "../pdfExport/pdfExportRoute.js"
import { runFlowDocBackendPdfExportEndToEndCandidateV1 } from "../pdfExport/pdfExportWorkflow.js"

export const FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID =
  "realdoc-e5-6-published-preview" as const
export const FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION = 0 as const

export interface FlowDocBackendRealdocE56PreparedInputV1 {
  dataContract: VNextPublishedStructureGenerationDataContractV1
  mappingProfile: VNextPublishedStructureMappingProfileV1
  projection: VNextPublishedStructureTestInputProjectionV1
  adaptedPayloadText: string
  request: FlowDocBackendDocGenLocalAdmissionRequestV1
  trustedAssets: Array<{
    definition: FlowDocBackendDocGenTrustedAssetBytesV1["definition"]
    bytesBase64: string
  }>
  evidence: {
    sourceBundleFingerprint: string
    adapterBundleFingerprint: string
    selectedImageCanonicalDigest: string
    requirementCount: number
    screenshotCount: number
    adaptedPayloadByteLength: number
    projectionFingerprint: string
    mappingProfileFingerprint: string
  }
}

export interface FlowDocBackendRealdocE56LocalRuntimeV1 {
  prepared: FlowDocBackendRealdocE56PreparedInputV1
  origin: () => string | null
  start(): Promise<ReturnType<ReturnType<typeof createFlowDocBackendPdfExportLocalHttpServerV1>["readEvidence"]>>
  close(): Promise<void>
}

function prepare(coreRoot: string, semanticDirectory: string): FlowDocBackendRealdocE56PreparedInputV1 {
  const command = resolve(
    coreRoot,
    "packages/uat-realdoc/local-runtime/prepare-69c-docgen-local-input.mjs",
  )
  const result = spawnSync(process.execPath, [command, semanticDirectory], {
    cwd: coreRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error("69C E.5.6 input preparation failed")
  const prepared = JSON.parse(result.stdout.replace(/^\uFEFF/u, "")) as FlowDocBackendRealdocE56PreparedInputV1
  if (
    prepared.projection.status !== "ready"
    || prepared.adaptedPayloadText.trim().length === 0
    || Buffer.byteLength(prepared.adaptedPayloadText, "utf8") > 1024 * 1024
    || prepared.mappingProfile.profileFingerprint !== prepared.evidence.mappingProfileFingerprint
    || prepared.projection.projectionFingerprint !== prepared.evidence.projectionFingerprint
  ) throw new Error("69C E.5.6 prepared input is outside the accepted Published Preview envelope")
  JSON.parse(prepared.adaptedPayloadText) as unknown
  return prepared
}

function createUatMapper(
  coreRoot: string,
  profile: VNextPublishedStructureMappingProfileV1,
): VNextPublishedStructureMappingRuntimeV1 {
  if (profile.execution.kind !== "named-adapter") {
    throw new Error("69C E.5.6 requires the named UAT adapter")
  }
  const command = resolve(coreRoot, "packages/uat-realdoc/local-runtime/map-docgen-local.mjs")
  return {
    execution: structuredClone(profile.execution),
    map(payload, context) {
      const result = spawnSync(process.execPath, [command], {
        cwd: coreRoot,
        input: JSON.stringify({ payload, context }),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 300_000,
        windowsHide: true,
      })
      if (result.status !== 0) return {
        status: "blocked",
        canonicalInput: null,
        issues: [{ code: "uat-mapper-process-failed", path: "$" }],
      }
      try {
        return JSON.parse(result.stdout.replace(/^\uFEFF/u, "")) as ReturnType<
          VNextPublishedStructureMappingRuntimeV1["map"]
        >
      } catch {
        return {
          status: "blocked",
          canonicalInput: null,
          issues: [{ code: "uat-mapper-process-invalid", path: "$" }],
        }
      }
    },
  }
}

function clock(): () => string {
  let previous = Date.now() - 1
  return () => {
    previous = Math.max(Date.now(), previous + 1)
    return new Date(previous).toISOString()
  }
}

export function createFlowDocBackendRealdocE56LocalRuntimeV1(input: {
  semanticDirectory: string
  bearerToken: string
  port?: number
  coreRoot?: string
}): FlowDocBackendRealdocE56LocalRuntimeV1 {
  if (input.bearerToken.length < 32 || input.bearerToken.length > 512 || /\s/u.test(input.bearerToken)) {
    throw new Error("REALDOC-E.5.6 local runtime requires a bounded bearer token")
  }
  const coreRoot = resolve(input.coreRoot ?? resolve(process.cwd(), "../flowdoc-vnext-core"))
  const prepared = prepare(coreRoot, resolve(input.semanticDirectory))
  const identity: FlowDocBackendPdfExportAuthenticatedIdentityV1 = {
    tenantId: "tenant:pdf-export-realdoc-e56-local",
    principalId: "principal:pdf-export-realdoc-e56-local",
    authenticationId: "authentication:pdf-export-realdoc-e56-local",
  }
  const authenticator = {
    async authenticate({ authorization }: { authorization: string | null }) {
      return authorization === `Bearer ${input.bearerToken}`
        ? { status: "authenticated" as const, identity, issues: [] as [] }
        : { status: "unauthenticated" as const, identity: null, issues: [] as [] }
    },
  }
  const authorize = async () => ({
    status: "authorized" as const,
    authorizationId: "authorization:pdf-export-realdoc-e56-local",
    issues: [] as [],
  })

  const admissionRepository = createFlowDocBackendDocGenInMemoryAdmissionRepositoryV1()
  const trustedAssetBytes = prepared.trustedAssets.map((asset) => ({
    definition: asset.definition,
    bytes: new Uint8Array(Buffer.from(asset.bytesBase64, "base64")),
  }))
  const assets = createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1(trustedAssetBytes)
  const structures = createFlowDocBackendDocGenTrustedStructureRegistryV1([{
    dataContract: prepared.dataContract,
    mappings: [{
      profile: prepared.mappingProfile,
      mapper: createUatMapper(coreRoot, prepared.mappingProfile),
    }],
  }])
  const admission = createFlowDocBackendDocGenLocalAdmissionServiceV1({
    structures,
    assets,
    repository: admissionRepository,
  })
  const previewContexts = createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1([{
    authoring: {
      documentId: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_ID,
      documentRevision: FLOWDOC_BACKEND_REALDOC_E56_AUTHORING_DOCUMENT_REVISION,
    },
    projection: prepared.projection,
    mappingProfiles: [{ label: "69C semantic JSON", profile: prepared.mappingProfile }],
    assets: prepared.request.assets as ImageAssetRegistryV1,
  }])
  const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
    repository: admissionRepository,
    assets,
    materializer: createFlowDocBackendDocGenLocalUatArtifactMaterializerV1({ coreRoot }),
    operationIdFactory: () => `realdoc-e56-${randomUUID()}`,
  })
  const baseOperationRepository = createInMemoryFlowDocBackendPdfExportOperationRepositoryV1()
  const lifecycleRepository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
  const persistenceRepository = createInMemoryFlowDocBackendPdfExportArtifactPersistenceRepositoryV1()
  const observabilityRepository = createInMemoryFlowDocBackendPdfExportObservabilityRepositoryV1()
  const storageRoot = mkdtempSync(join(tmpdir(), "flowdoc-realdoc-e56-"))
  const contentStore = createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: storageRoot })
  const now = clock()
  const activeWork = new Set<Promise<void>>()
  let closing = false

  const executeOperation = async (operationId: string) => {
    let found = await baseOperationRepository.readByOperationId({ ...identity, operationId })
    if (found.status !== "found") return
    const operation = found.operation
    let lifecycle = await lifecycleRepository.readLifecycle({ ...operation.scope, operationId })
    for (let attempt = 0; lifecycle.status === "not-found" && attempt < 20; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10))
      lifecycle = await lifecycleRepository.readLifecycle({ ...operation.scope, operationId })
    }
    if (lifecycle.status !== "found" || lifecycle.head.status !== "pending") return
    const claimedAt = now()
    const claimToken = `claim:${operationId}`
    const claimed = await lifecycleRepository.applyLifecycleTransition({
      transitionId: `claim:${operationId}:attempt:1`,
      ...operation.scope,
      operationId,
      expectedHeadRevision: lifecycle.head.headRevision,
      transitionAt: claimedAt,
      kind: "claim",
      claimToken,
      workerId: "worker:pdf-export-realdoc-e56-local",
      claimExpiresAt: new Date(Date.parse(claimedAt) + 180_000).toISOString(),
    })
    if (claimed.status !== "applied") return
    const handoff = await lifecycleRepository.applyLifecycleTransition({
      transitionId: `before-handoff:${operationId}:attempt:1`,
      ...operation.scope,
      operationId,
      expectedHeadRevision: claimed.head.headRevision,
      transitionAt: now(),
      kind: "pass-checkpoint",
      claimToken,
      nextCheckpoint: "before-render",
    })
    if (handoff.status !== "applied") return
    const workflowInput = await binding.createWorkflowInput({
      entry: {
        source: "flowdoc-backend-pdf-export-due-work",
        operationId,
        scope: operation.scope,
        dueAt: operation.acceptedAt,
        lane: "claim-ready",
        headRevision: handoff.head.headRevision,
        lifecycleFingerprint: handoff.head.lifecycleFingerprint,
        head: handoff.head,
      },
      operation,
      lifecycleHead: handoff.head,
      workerId: "worker:pdf-export-realdoc-e56-local",
      claimToken,
      ownsClaim: true,
      attemptNumber: 1,
      now,
    }, {
      operationRepository,
      lifecycleRepository,
      persistenceRepository,
      observabilityRepository,
      contentStore,
    })
    await runFlowDocBackendPdfExportEndToEndCandidateV1(workflowInput)
  }

  const schedule = (operationId: string) => {
    if (closing) return
    const work = new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 0))
      .then(() => executeOperation(operationId))
      .finally(() => activeWork.delete(work))
    activeWork.add(work)
  }
  const operationRepository: FlowDocBackendPdfExportOperationRepositoryV1 = {
    source: baseOperationRepository.source,
    async admitOperation(value) {
      const result = await baseOperationRepository.admitOperation(value)
      if (result.status === "created") schedule(result.operation.operationId)
      return result
    },
    readByOperationId: (lookup) => baseOperationRepository.readByOperationId(lookup),
    readByCallerKey: (lookup) => baseOperationRepository.readByCallerKey(lookup),
  }

  const server = createFlowDocBackendPdfExportLocalHttpServerV1({
    host: "127.0.0.1",
    port: input.port ?? 4012,
    routeOptions: {
      authenticator,
      authorizer: { authorize },
      admissionResolver: binding.admissionResolver,
      operationRepository,
      lifecycleRepository,
      persistenceRepository,
      observabilityRepository,
      contentStore,
      now,
    },
    docGenAdmissionOptions: {
      authenticator,
      authorizer: { authorize },
      admission,
    },
    publishedPreviewContextOptions: {
      authenticator,
      authorizer: { authorize },
      registry: previewContexts,
    },
  })
  let listenerOrigin: string | null = null
  let closed = false

  return {
    prepared,
    origin: () => listenerOrigin,
    async start() {
      const evidence = await server.start()
      listenerOrigin = `http://${evidence.listenerHost}:${evidence.listenerPort}`
      return evidence
    },
    async close() {
      if (closed) return
      closed = true
      closing = true
      await Promise.allSettled([...activeWork])
      await server.close()
      rmSync(storageRoot, { recursive: true, force: true })
      listenerOrigin = null
    },
  }
}
