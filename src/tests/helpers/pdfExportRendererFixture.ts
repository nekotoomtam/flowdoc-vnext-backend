import { createHash } from "node:crypto"
import {
  createVNextPdfExportRequestV1,
  createVNextPdfMeasuredDrawContractV1,
  type VNextPdfExportProductionPolicyV1,
  type VNextPdfMeasuredDrawContractRequestV1,
} from "@flowdoc/vnext-core"
import thaiOnePageRequest from "@flowdoc/vnext-core/fixtures/pdf-pilot-thai-one-page-request.v1.json" with { type: "json" }
import {
  createFlowDocBackendPdfExportRendererQualificationV1,
  flowDocBackendPdfExportCurrentRuntimeIdentityV1,
  type FlowDocBackendPdfExportLifecycleRepositoryV1,
  type FlowDocBackendPdfExportRendererQualificationV1,
  type FlowDocBackendPdfExportRendererV1,
} from "../../index.js"
import {
  createPdfExportOperationFixture,
  pdfExportOperationPolicy,
  pdfExportOperationSource,
} from "./pdfExportOperationFixture.js"

export const PDF_EXPORT_RENDERER_IMPLEMENTATION_FINGERPRINT = `sha256:${"8".repeat(64)}`
export const PDF_EXPORT_RENDERER_SUITE_FINGERPRINT = `sha256:${"9".repeat(64)}`
export const PDF_EXPORT_RENDERER_CLAIM_TOKEN = "claim:pdf-renderer:1"

export function createPdfExportRendererFixture(input: {
  operationId?: string
  policy?: VNextPdfExportProductionPolicyV1
} = {}) {
  const policy = input.policy ?? pdfExportOperationPolicy()
  const operation = createPdfExportOperationFixture({
    operationId: input.operationId ?? "operation:pdf-renderer-attempt",
    callerIdempotencyKey: `caller-key:${input.operationId ?? "pdf-renderer-attempt"}`,
    policy,
  })
  const measuredDrawContract = createVNextPdfMeasuredDrawContractV1(
    structuredClone(thaiOnePageRequest) as VNextPdfMeasuredDrawContractRequestV1,
  )
  const request = createVNextPdfExportRequestV1({
    exportRequestId: operation.admission.exportIdentity.exportRequestId,
    artifactId: operation.admission.exportIdentity.artifactId,
    requestedAt: "2026-07-18T09:00:00.000Z",
    source: pdfExportOperationSource(),
    measuredDrawContract,
  })
  if (request.status !== "ready") throw new Error(JSON.stringify(request.issues))
  if (request.request.requestFingerprint !== operation.admission.exportIdentity.requestFingerprint) {
    throw new Error("renderer fixture request must match the admitted operation")
  }
  const qualification = createFlowDocBackendPdfExportRendererQualificationV1({
    qualificationId: "qualification:pdf-renderer-candidate:v1",
    adapterId: "renderer:candidate",
    adapterVersion: "1.0.0",
    implementationFingerprint: PDF_EXPORT_RENDERER_IMPLEMENTATION_FINGERPRINT,
    rendererProfileId: measuredDrawContract.rendererProfileId,
    measurementProfileId: measuredDrawContract.measurementProfileId,
    runtime: flowDocBackendPdfExportCurrentRuntimeIdentityV1(),
    maximumPaintCommandsBetweenChecks: 2,
    minimumCheckpointCount: 3,
    suiteFingerprint: PDF_EXPORT_RENDERER_SUITE_FINGERPRINT,
    qualifiedAt: "2026-07-18T08:00:00.000Z",
  })
  if (qualification.status !== "ready") throw new Error(JSON.stringify(qualification.issues))
  return {
    operation,
    request: request.request,
    currentSource: pdfExportOperationSource(),
    measuredDrawContract,
    qualification: qualification.qualification,
  }
}

export async function preparePdfExportRendererLifecycle(input: {
  repository: FlowDocBackendPdfExportLifecycleRepositoryV1
  fixture: ReturnType<typeof createPdfExportRendererFixture>
  claimExpiresAt?: string
}) {
  const { repository, fixture } = input
  await repository.initializeLifecycle(fixture.operation)
  const claim = await repository.applyLifecycleTransition({
    transitionId: `transition:${fixture.operation.operationId}:claim`,
    ...fixture.operation.scope,
    operationId: fixture.operation.operationId,
    expectedHeadRevision: 0,
    transitionAt: "2026-07-18T09:00:02.000Z",
    kind: "claim",
    claimToken: PDF_EXPORT_RENDERER_CLAIM_TOKEN,
    workerId: "worker:pdf-renderer",
    claimExpiresAt: input.claimExpiresAt ?? "2026-07-18T09:00:32.000Z",
  })
  if (claim.status !== "applied") throw new Error(`renderer fixture claim failed: ${claim.status}`)
  const handoff = await repository.applyLifecycleTransition({
    transitionId: `transition:${fixture.operation.operationId}:before-handoff`,
    ...fixture.operation.scope,
    operationId: fixture.operation.operationId,
    expectedHeadRevision: 1,
    transitionAt: "2026-07-18T09:00:03.000Z",
    kind: "pass-checkpoint",
    claimToken: PDF_EXPORT_RENDERER_CLAIM_TOKEN,
    nextCheckpoint: "before-render",
  })
  if (handoff.status !== "applied") throw new Error(`renderer fixture handoff failed: ${handoff.status}`)
}

export function deterministicPdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7\nFlowDoc V-D deterministic candidate\n%%EOF\n")
}

export function createCooperativeRenderer(input: {
  fixture: ReturnType<typeof createPdfExportRendererFixture>
  checkpointIndexes?: number[]
  bytes?: Uint8Array
  sha256?: string
  onCheckpoint?: (index: number) => Promise<void> | void
}): FlowDocBackendPdfExportRendererV1 {
  return {
    adapterId: "renderer:candidate",
    adapterVersion: "1.0.0",
    implementationFingerprint: PDF_EXPORT_RENDERER_IMPLEMENTATION_FINGERPRINT,
    async render({ rendererInput, control }) {
      const indexes = input.checkpointIndexes ?? [0, 2, 4]
      for (const paintCommandIndex of indexes) {
        await input.onCheckpoint?.(paintCommandIndex)
        const decision = await control.checkpoint({
          paintCommandIndex,
          totalPaintCommandCount: 4,
        })
        if (decision.status === "cancel") return {
          status: "cancelled",
          bytes: null,
          renderEvidence: null,
          issues: [],
        }
      }
      const bytes = input.bytes ?? deterministicPdfBytes()
      return {
        status: "rendered",
        bytes,
        renderEvidence: {
          status: "rendered",
          artifactId: rendererInput.artifactId,
          format: "pdf",
          mediaType: "application/pdf",
          byteLength: bytes.byteLength,
          sha256: input.sha256 ?? createHash("sha256").update(bytes).digest("hex"),
          pageCount: input.fixture.request.measuredDrawContract.pageCount,
          rendererProfileId: input.fixture.measuredDrawContract.rendererProfileId,
          measurementProfileId: input.fixture.measuredDrawContract.measurementProfileId,
          sourceContractFingerprint: rendererInput.sourceContractFingerprint,
          sourceContractContentFingerprint: rendererInput.sourceContractContentFingerprint,
        },
        issues: [],
      }
    },
  }
}

export function rendererAttemptInput(input: {
  fixture: ReturnType<typeof createPdfExportRendererFixture>
  repository: FlowDocBackendPdfExportLifecycleRepositoryV1
  renderer: FlowDocBackendPdfExportRendererV1
  qualification?: FlowDocBackendPdfExportRendererQualificationV1
  now?: () => string
}) {
  return {
    renderAttemptId: `render-attempt:${input.fixture.operation.operationId}`,
    completionId: `completion:${input.fixture.operation.operationId}`,
    operation: input.fixture.operation,
    request: input.fixture.request,
    currentSource: input.fixture.currentSource,
    measuredDrawContract: input.fixture.measuredDrawContract,
    qualification: input.qualification ?? input.fixture.qualification,
    renderer: input.renderer,
    lifecycleRepository: input.repository,
    claimToken: PDF_EXPORT_RENDERER_CLAIM_TOKEN,
    beforeRender: {
      transitionId: `transition:${input.fixture.operation.operationId}:before-render`,
      expectedHeadRevision: 2,
      checkedAt: "2026-07-18T09:00:04.000Z",
    },
    beforePersistTransitionId: `transition:${input.fixture.operation.operationId}:before-persist`,
    now: input.now ?? monotonicRendererClock(),
  }
}

export function monotonicRendererClock(input: {
  startMs?: number
  stepMs?: number
} = {}): () => string {
  let current = input.startMs ?? Date.parse("2026-07-18T09:00:05.000Z")
  const step = input.stepMs ?? 1
  return () => {
    const value = new Date(current).toISOString()
    current += step
    return value
  }
}
