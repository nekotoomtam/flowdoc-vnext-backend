import { parseVNextDocumentCompositionManifestV1, type VNextDocumentCompositionManifestV1 } from "@flowdoc/vnext-core"
import {
  cloneCompositionJson,
  compositionIssue,
  isCompositionRecord,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import {
  parseFlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionJobHeadV1,
} from "./compositionSchedulerJobHead.js"
import {
  parseFlowDocBackendCompositionContentRefV1,
  parseFlowDocBackendCompositionSourcePinV1,
  type FlowDocBackendCompositionContentRefV1,
  type FlowDocBackendCompositionSourcePinV1,
} from "./compositionSchedulerSourcePin.js"

export const FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_V1_SOURCE = "flowdoc-backend-composition-repository"

export interface FlowDocBackendCompositionRepositoryContextV1 {
  sourcePin: FlowDocBackendCompositionSourcePinV1
  manifest: VNextDocumentCompositionManifestV1
}

export type FlowDocBackendCompositionImmutableWriteResultV1 =
  | { status: "written" | "idempotent-replay"; ref: FlowDocBackendCompositionContentRefV1; issues: [] }
  | { status: "conflict" | "invalid"; ref: null; issues: FlowDocBackendCompositionContractIssue[] }

export type FlowDocBackendCompositionImmutableReadResultV1 =
  | { status: "found"; ref: FlowDocBackendCompositionContentRefV1; value: unknown; issues: [] }
  | { status: "not-found" | "invalid"; ref: null; value: null; issues: FlowDocBackendCompositionContractIssue[] }

export type FlowDocBackendCompositionImmutableFingerprintReadResultV1 =
  FlowDocBackendCompositionImmutableReadResultV1

export type FlowDocBackendCompositionHeadReadResultV1 =
  | {
      status: "found"
      context: FlowDocBackendCompositionRepositoryContextV1
      head: FlowDocBackendCompositionJobHeadV1
      issues: []
    }
  | {
      status: "not-found" | "invalid"
      context: null
      head: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionHeadCreateResultV1 =
  | { status: "created" | "idempotent-replay"; head: FlowDocBackendCompositionJobHeadV1; issues: [] }
  | { status: "conflict" | "invalid"; head: null; issues: FlowDocBackendCompositionContractIssue[] }

export interface FlowDocBackendCompositionCommittedRequestV1 {
  requestId: string
  requestFingerprint: string
  receiptRef: FlowDocBackendCompositionContentRefV1
}

export interface FlowDocBackendCompositionCommittedFinalizationV1 {
  requestId: string
  requestFingerprint: string
  pagePlanRef: FlowDocBackendCompositionContentRefV1
  headingPageMapRef: FlowDocBackendCompositionContentRefV1
}

export type FlowDocBackendCompositionCommittedFinalizationReadResultV1 =
  | {
      status: "found"
      requestFingerprint: string
      pagePlanRef: FlowDocBackendCompositionContentRefV1
      headingPageMapRef: FlowDocBackendCompositionContentRefV1
      head: FlowDocBackendCompositionJobHeadV1
      issues: []
    }
  | {
      status: "not-found"
      requestFingerprint: null
      pagePlanRef: null
      headingPageMapRef: null
      head: null
      issues: []
    }
  | {
      status: "invalid"
      requestFingerprint: null
      pagePlanRef: null
      headingPageMapRef: null
      head: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionCommittedRequestReadResultV1 =
  | {
      status: "found"
      requestFingerprint: string
      receiptRef: FlowDocBackendCompositionContentRefV1
      head: FlowDocBackendCompositionJobHeadV1
      issues: []
    }
  | {
      status: "not-found"
      requestFingerprint: null
      receiptRef: null
      head: null
      issues: []
    }
  | {
      status: "invalid"
      requestFingerprint: null
      receiptRef: null
      head: null
      issues: FlowDocBackendCompositionContractIssue[]
    }

export type FlowDocBackendCompositionHeadCompareAndSwapResultV1 =
  | { status: "committed" | "idempotent-replay"; head: FlowDocBackendCompositionJobHeadV1; issues: [] }
  | {
      status: "stale"
      head: FlowDocBackendCompositionJobHeadV1
      issues: FlowDocBackendCompositionContractIssue[]
    }
  | { status: "conflict" | "invalid" | "not-found"; head: null; issues: FlowDocBackendCompositionContractIssue[] }

export interface FlowDocBackendCompositionRepositoryV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_V1_SOURCE
  putImmutable(input: {
    ref: unknown
    value: unknown
  }): Promise<FlowDocBackendCompositionImmutableWriteResultV1>
  readImmutable(input: {
    jobId: string
    recordId: string
  }): Promise<FlowDocBackendCompositionImmutableReadResultV1>
  readImmutableByFingerprint(input: {
    jobId: string
    kind: FlowDocBackendCompositionContentRefV1["kind"]
    recordFingerprint: string
  }): Promise<FlowDocBackendCompositionImmutableFingerprintReadResultV1>
  createHead(input: {
    createRequestId: string
    requestFingerprint: string
    sourcePin: unknown
    manifest: unknown
    head: unknown
  }): Promise<FlowDocBackendCompositionHeadCreateResultV1>
  readHead(jobId: string): Promise<FlowDocBackendCompositionHeadReadResultV1>
  readCommittedRequest(input: {
    jobId: string
    requestId: string
  }): Promise<FlowDocBackendCompositionCommittedRequestReadResultV1>
  readCommittedFinalization(input: {
    jobId: string
    requestId: string
  }): Promise<FlowDocBackendCompositionCommittedFinalizationReadResultV1>
  compareAndSwapHead(input: {
    jobId: string
    expectedHeadRevision: number
    expectedHeadFingerprint: string
    nextHead: unknown
    committedRequest?: FlowDocBackendCompositionCommittedRequestV1 | null
    committedFinalization?: FlowDocBackendCompositionCommittedFinalizationV1 | null
  }): Promise<FlowDocBackendCompositionHeadCompareAndSwapResultV1>
}

interface StoredHead {
  context: FlowDocBackendCompositionRepositoryContextV1
  head: FlowDocBackendCompositionJobHeadV1
  createRequestId: string
  createRequestFingerprint: string
}

interface StoredCommittedRequest {
  requestFingerprint: string
  receiptRef: FlowDocBackendCompositionContentRefV1
  head: FlowDocBackendCompositionJobHeadV1
}

interface StoredCommittedFinalization {
  requestFingerprint: string
  pagePlanRef: FlowDocBackendCompositionContentRefV1
  headingPageMapRef: FlowDocBackendCompositionContentRefV1
  head: FlowDocBackendCompositionJobHeadV1
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function immutableKey(jobId: string, recordId: string): string {
  return `${jobId}\u0000${recordId}`
}

function requestKey(jobId: string, requestId: string): string {
  return `${jobId}\u0000${requestId}`
}

function fingerprintKey(
  jobId: string,
  kind: FlowDocBackendCompositionContentRefV1["kind"],
  fingerprint: string,
): string {
  return `${jobId}\u0000${kind}\u0000${fingerprint}`
}

function parseRef(value: unknown): {
  ref: FlowDocBackendCompositionContentRefV1 | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const ref = parseFlowDocBackendCompositionContentRefV1(value, "ref", issues)
  return { ref, issues }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const terminalStatuses = new Set(["completed", "blocked", "cancelled", "expired"])

export function createInMemoryFlowDocBackendCompositionRepositoryV1(): FlowDocBackendCompositionRepositoryV1 {
  const immutable = new Map<string, { ref: FlowDocBackendCompositionContentRefV1; value: unknown }>()
  const immutableFingerprints = new Map<string, string>()
  const heads = new Map<string, StoredHead>()
  const committedRequests = new Map<string, StoredCommittedRequest>()
  const committedFinalizations = new Map<string, StoredCommittedFinalization>()

  return {
    source: FLOWDOC_BACKEND_COMPOSITION_REPOSITORY_V1_SOURCE,

    async putImmutable(input) {
      const parsed = parseRef(input.ref)
      if (parsed.ref == null) return { status: "invalid", ref: null, issues: parsed.issues }
      const ref = parsed.ref
      if (!isCompositionRecord(input.value) || input.value.fingerprint !== ref.recordFingerprint) return {
        status: "invalid",
        ref: null,
        issues: [compositionIssue(
          "composition-immutable-fingerprint-mismatch",
          "value.fingerprint",
          "immutable value must expose the exact referenced fingerprint",
        )],
      }
      if (byteLength(input.value) !== ref.byteLength) return {
        status: "invalid",
        ref: null,
        issues: [compositionIssue(
          "composition-immutable-byte-length-mismatch",
          "ref.byteLength",
          "immutable ref byte length must equal canonical JSON bytes",
        )],
      }
      const key = immutableKey(ref.jobId, ref.recordId)
      const current = immutable.get(key)
      if (current != null) {
        return same(current.ref, ref) && same(current.value, input.value)
          ? { status: "idempotent-replay", ref: cloneCompositionJson(current.ref), issues: [] }
          : {
              status: "conflict",
              ref: null,
              issues: [compositionIssue(
                "composition-immutable-conflict",
                "ref.recordId",
                "immutable record id was already used with different content",
              )],
            }
      }
      const byFingerprint = fingerprintKey(ref.jobId, ref.kind, ref.recordFingerprint)
      const fingerprintOwnerKey = immutableFingerprints.get(byFingerprint)
      if (fingerprintOwnerKey != null && fingerprintOwnerKey !== key) return {
        status: "conflict",
        ref: null,
        issues: [compositionIssue(
          "composition-immutable-fingerprint-conflict",
          "ref.recordFingerprint",
          "immutable fingerprint was already retained under another record id",
        )],
      }
      immutable.set(key, { ref: cloneCompositionJson(ref), value: cloneCompositionJson(input.value) })
      immutableFingerprints.set(byFingerprint, key)
      return { status: "written", ref: cloneCompositionJson(ref), issues: [] }
    },

    async readImmutable(input) {
      if (typeof input.jobId !== "string" || input.jobId.length === 0 || typeof input.recordId !== "string" || input.recordId.length === 0) {
        return {
          status: "invalid",
          ref: null,
          value: null,
          issues: [compositionIssue("composition-immutable-read-invalid", "", "jobId and recordId are required")],
        }
      }
      const stored = immutable.get(immutableKey(input.jobId, input.recordId))
      return stored == null
        ? {
            status: "not-found",
            ref: null,
            value: null,
            issues: [compositionIssue("composition-immutable-not-found", "recordId", "immutable record was not found")],
          }
        : { status: "found", ref: cloneCompositionJson(stored.ref), value: cloneCompositionJson(stored.value), issues: [] }
    },

    async readImmutableByFingerprint(input) {
      const issues: FlowDocBackendCompositionContractIssue[] = []
      const probe = parseRef({
        jobId: input.jobId,
        kind: input.kind,
        recordId: "fingerprint-probe",
        recordFingerprint: input.recordFingerprint,
        byteLength: 1,
      })
      if (probe.ref == null) return { status: "invalid", ref: null, value: null, issues: probe.issues }
      const key = immutableFingerprints.get(fingerprintKey(input.jobId, input.kind, input.recordFingerprint))
      if (key == null) return {
        status: "not-found",
        ref: null,
        value: null,
        issues: [compositionIssue(
          "composition-immutable-fingerprint-not-found",
          "recordFingerprint",
          "immutable record fingerprint was not found for the exact job and kind",
        )],
      }
      const stored = immutable.get(key)
      if (stored == null || stored.ref.jobId !== input.jobId || stored.ref.kind !== input.kind
        || stored.ref.recordFingerprint !== input.recordFingerprint) {
        issues.push(compositionIssue(
          "composition-immutable-fingerprint-index-invalid",
          "recordFingerprint",
          "immutable fingerprint index does not resolve to the exact retained record",
        ))
        return { status: "invalid", ref: null, value: null, issues }
      }
      return { status: "found", ref: cloneCompositionJson(stored.ref), value: cloneCompositionJson(stored.value), issues: [] }
    },

    async createHead(input) {
      const source = parseFlowDocBackendCompositionSourcePinV1(input.sourcePin)
      const manifest = parseVNextDocumentCompositionManifestV1(input.manifest)
      if (source.status === "blocked" || manifest.status === "blocked") return {
        status: "invalid",
        head: null,
        issues: [
          ...(source.status === "blocked" ? source.issues : []),
          ...(manifest.status === "blocked" ? manifest.issues.map((item) => compositionIssue(item.code, item.path, item.message)) : []),
        ],
      }
      const parsedHead = parseFlowDocBackendCompositionJobHeadV1({
        value: input.head,
        sourcePin: source.sourcePin,
        manifest: manifest.manifest,
      })
      if (parsedHead.status === "blocked") return { status: "invalid", head: null, issues: parsedHead.issues }
      if (
        parsedHead.jobHead.headRevision !== 0 || parsedHead.jobHead.transitionNumber !== 0
        || typeof input.createRequestId !== "string" || input.createRequestId.length === 0
        || typeof input.requestFingerprint !== "string" || !input.requestFingerprint.startsWith("sha256:")
      ) return {
        status: "invalid",
        head: null,
        issues: [compositionIssue(
          "composition-head-create-invalid",
          "head",
          "created head requires revision/transition zero and bounded request identity",
        )],
      }
      const current = heads.get(source.sourcePin.jobId)
      if (current != null) {
        return current.createRequestId === input.createRequestId
          && current.createRequestFingerprint === input.requestFingerprint
          ? { status: "idempotent-replay", head: cloneCompositionJson(current.head), issues: [] }
          : {
              status: "conflict",
              head: null,
              issues: [compositionIssue("composition-head-create-conflict", "jobId", "job already exists with different creation identity")],
            }
      }
      const stored: StoredHead = {
        context: { sourcePin: cloneCompositionJson(source.sourcePin), manifest: cloneCompositionJson(manifest.manifest) },
        head: cloneCompositionJson(parsedHead.jobHead),
        createRequestId: input.createRequestId,
        createRequestFingerprint: input.requestFingerprint,
      }
      heads.set(source.sourcePin.jobId, stored)
      return { status: "created", head: cloneCompositionJson(stored.head), issues: [] }
    },

    async readHead(jobId) {
      const stored = heads.get(jobId)
      if (stored == null) return {
        status: "not-found",
        context: null,
        head: null,
        issues: [compositionIssue("composition-head-not-found", "jobId", "composition job head was not found")],
      }
      const parsed = parseFlowDocBackendCompositionJobHeadV1({
        value: stored.head,
        sourcePin: stored.context.sourcePin,
        manifest: stored.context.manifest,
      })
      if (parsed.status === "blocked") return { status: "invalid", context: null, head: null, issues: parsed.issues }
      return {
        status: "found",
        context: cloneCompositionJson(stored.context),
        head: cloneCompositionJson(parsed.jobHead),
        issues: [],
      }
    },

    async readCommittedRequest(input) {
      if (
        typeof input.jobId !== "string" || input.jobId.length === 0
        || typeof input.requestId !== "string" || input.requestId.length === 0
      ) return {
        status: "invalid",
        requestFingerprint: null,
        receiptRef: null,
        head: null,
        issues: [compositionIssue(
          "composition-committed-request-read-invalid",
          "",
          "jobId and requestId are required",
        )],
      }
      const stored = committedRequests.get(requestKey(input.jobId, input.requestId))
      if (stored == null) return {
        status: "not-found",
        requestFingerprint: null,
        receiptRef: null,
        head: null,
        issues: [],
      }
      const owner = heads.get(input.jobId)
      const parsedRef = parseRef(stored.receiptRef)
      const parsedHead = owner == null
        ? null
        : parseFlowDocBackendCompositionJobHeadV1({
            value: stored.head,
            sourcePin: owner.context.sourcePin,
            manifest: owner.context.manifest,
          })
      const retained = parsedRef.ref == null
        ? null
        : immutable.get(immutableKey(parsedRef.ref.jobId, parsedRef.ref.recordId))
      if (
        owner == null || parsedRef.ref == null || parsedHead == null || parsedHead.status === "blocked"
        || parsedRef.ref.jobId !== input.jobId || parsedRef.ref.kind !== "transition-receipt"
        || retained == null || retained.ref.recordFingerprint !== parsedRef.ref.recordFingerprint
        || parsedHead.jobHead.chain.transitionReceiptTipFingerprint !== parsedRef.ref.recordFingerprint
      ) return {
        status: "invalid",
        requestFingerprint: null,
        receiptRef: null,
        head: null,
        issues: [
          ...parsedRef.issues,
          ...(parsedHead?.status === "blocked" ? parsedHead.issues : []),
          compositionIssue(
            "composition-committed-request-invalid",
            "requestId",
            "committed request must retain a validated head snapshot and reachable exact receipt",
          ),
        ],
      }
      return {
        status: "found",
        requestFingerprint: stored.requestFingerprint,
        receiptRef: cloneCompositionJson(parsedRef.ref),
        head: cloneCompositionJson(parsedHead.jobHead),
        issues: [],
      }
    },

    async readCommittedFinalization(input) {
      if (
        typeof input.jobId !== "string" || input.jobId.length === 0
        || typeof input.requestId !== "string" || input.requestId.length === 0
      ) return {
        status: "invalid",
        requestFingerprint: null,
        pagePlanRef: null,
        headingPageMapRef: null,
        head: null,
        issues: [compositionIssue(
          "composition-finalization-request-read-invalid",
          "",
          "jobId and requestId are required",
        )],
      }
      const stored = committedFinalizations.get(requestKey(input.jobId, input.requestId))
      if (stored == null) return {
        status: "not-found",
        requestFingerprint: null,
        pagePlanRef: null,
        headingPageMapRef: null,
        head: null,
        issues: [],
      }
      const owner = heads.get(input.jobId)
      const plan = parseRef(stored.pagePlanRef)
      const map = parseRef(stored.headingPageMapRef)
      const parsedHead = owner == null ? null : parseFlowDocBackendCompositionJobHeadV1({
        value: stored.head,
        sourcePin: owner.context.sourcePin,
        manifest: owner.context.manifest,
      })
      const retainedPlan = plan.ref == null ? null : immutable.get(immutableKey(plan.ref.jobId, plan.ref.recordId))
      const retainedMap = map.ref == null ? null : immutable.get(immutableKey(map.ref.jobId, map.ref.recordId))
      if (
        owner == null || plan.ref == null || map.ref == null || parsedHead == null || parsedHead.status === "blocked"
        || plan.ref.jobId !== input.jobId || plan.ref.kind !== "page-plan" || retainedPlan == null
        || map.ref.jobId !== input.jobId || map.ref.kind !== "heading-page-map" || retainedMap == null
        || parsedHead.jobHead.status !== "completed" || parsedHead.jobHead.finalOutput == null
        || !same(parsedHead.jobHead.finalOutput.pagePlanRef, plan.ref)
        || !same(parsedHead.jobHead.finalOutput.headingPageMapRef, map.ref)
      ) return {
        status: "invalid",
        requestFingerprint: null,
        pagePlanRef: null,
        headingPageMapRef: null,
        head: null,
        issues: [
          ...plan.issues,
          ...map.issues,
          ...(parsedHead?.status === "blocked" ? parsedHead.issues : []),
          compositionIssue(
            "composition-finalization-request-invalid",
            "requestId",
            "finalization request must retain validated output refs and its completed head snapshot",
          ),
        ],
      }
      return {
        status: "found",
        requestFingerprint: stored.requestFingerprint,
        pagePlanRef: cloneCompositionJson(plan.ref),
        headingPageMapRef: cloneCompositionJson(map.ref),
        head: cloneCompositionJson(parsedHead.jobHead),
        issues: [],
      }
    },

    async compareAndSwapHead(input) {
      const stored = heads.get(input.jobId)
      if (stored == null) return {
        status: "not-found",
        head: null,
        issues: [compositionIssue("composition-head-not-found", "jobId", "composition job head was not found")],
      }
      if (input.committedRequest != null && input.committedFinalization != null) return {
        status: "invalid",
        head: null,
        issues: [compositionIssue(
          "composition-head-commit-kind-invalid",
          "",
          "one head commit cannot retain transition and finalization requests together",
        )],
      }
      if (input.committedRequest != null) {
        const replay = committedRequests.get(requestKey(input.jobId, input.committedRequest.requestId))
        if (replay != null) {
          return replay.requestFingerprint === input.committedRequest.requestFingerprint
            ? { status: "idempotent-replay", head: cloneCompositionJson(replay.head), issues: [] }
            : {
                status: "conflict",
                head: null,
                issues: [compositionIssue(
                  "composition-transition-request-conflict",
                  "committedRequest.requestId",
                  "transition request id was already committed with different content",
                )],
              }
        }
      }
      if (input.committedFinalization != null) {
        const replay = committedFinalizations.get(requestKey(input.jobId, input.committedFinalization.requestId))
        if (replay != null) return replay.requestFingerprint === input.committedFinalization.requestFingerprint
          ? { status: "idempotent-replay", head: cloneCompositionJson(replay.head), issues: [] }
          : {
              status: "conflict",
              head: null,
              issues: [compositionIssue(
                "composition-finalization-request-conflict",
                "committedFinalization.requestId",
                "finalization request id was already committed with different content",
              )],
            }
      }
      if (
        stored.head.headRevision !== input.expectedHeadRevision
        || stored.head.fingerprint !== input.expectedHeadFingerprint
      ) return {
        status: "stale",
        head: cloneCompositionJson(stored.head),
        issues: [compositionIssue("composition-head-stale", "expectedHeadRevision", "job head changed before compare-and-swap")],
      }
      const next = parseFlowDocBackendCompositionJobHeadV1({
        value: input.nextHead,
        sourcePin: stored.context.sourcePin,
        manifest: stored.context.manifest,
      })
      if (next.status === "blocked") return { status: "invalid", head: null, issues: next.issues }
      if (
        next.jobHead.headRevision !== stored.head.headRevision + 1
        || next.jobHead.transitionNumber < stored.head.transitionNumber
        || next.jobHead.transitionNumber > stored.head.transitionNumber + 1
        || next.jobHead.sourcePinFingerprint !== stored.head.sourcePinFingerprint
        || next.jobHead.manifestFingerprint !== stored.head.manifestFingerprint
        || terminalStatuses.has(stored.head.status)
      ) return {
        status: "invalid",
        head: null,
        issues: [compositionIssue(
          "composition-head-transition-invalid",
          "nextHead",
          "next head must advance one revision, preserve owners, and not leave a terminal state",
        )],
      }
      if (input.committedRequest != null) {
        const request = input.committedRequest
        const refResult = parseRef(request.receiptRef)
        const retained = refResult.ref == null
          ? null
          : immutable.get(immutableKey(refResult.ref.jobId, refResult.ref.recordId))
        if (
          refResult.ref == null || retained == null || refResult.ref.jobId !== input.jobId
          || refResult.ref.kind !== "transition-receipt"
          || next.jobHead.chain.transitionReceiptTipFingerprint !== refResult.ref.recordFingerprint
        ) return {
          status: "invalid",
          head: null,
          issues: [compositionIssue(
            "composition-committed-receipt-invalid",
            "committedRequest.receiptRef",
            "committed request requires a retained exact receipt reachable from the next head",
          )],
        }
      }
      if (input.committedFinalization != null) {
        const request = input.committedFinalization
        const plan = parseRef(request.pagePlanRef)
        const map = parseRef(request.headingPageMapRef)
        const retainedPlan = plan.ref == null ? null : immutable.get(immutableKey(plan.ref.jobId, plan.ref.recordId))
        const retainedMap = map.ref == null ? null : immutable.get(immutableKey(map.ref.jobId, map.ref.recordId))
        if (
          plan.ref == null || map.ref == null || retainedPlan == null || retainedMap == null
          || plan.ref.jobId !== input.jobId || plan.ref.kind !== "page-plan"
          || map.ref.jobId !== input.jobId || map.ref.kind !== "heading-page-map"
          || next.jobHead.status !== "completed" || next.jobHead.finalOutput == null
          || !same(next.jobHead.finalOutput.pagePlanRef, plan.ref)
          || !same(next.jobHead.finalOutput.headingPageMapRef, map.ref)
        ) return {
          status: "invalid",
          head: null,
          issues: [compositionIssue(
            "composition-committed-finalization-invalid",
            "committedFinalization",
            "committed finalization requires retained exact outputs reachable from the completed head",
          )],
        }
      }
      stored.head = cloneCompositionJson(next.jobHead)
      if (input.committedRequest != null) committedRequests.set(
        requestKey(input.jobId, input.committedRequest.requestId),
        {
          requestFingerprint: input.committedRequest.requestFingerprint,
          receiptRef: cloneCompositionJson(input.committedRequest.receiptRef),
          head: cloneCompositionJson(next.jobHead),
        },
      )
      if (input.committedFinalization != null) committedFinalizations.set(
        requestKey(input.jobId, input.committedFinalization.requestId),
        {
          requestFingerprint: input.committedFinalization.requestFingerprint,
          pagePlanRef: cloneCompositionJson(input.committedFinalization.pagePlanRef),
          headingPageMapRef: cloneCompositionJson(input.committedFinalization.headingPageMapRef),
          head: cloneCompositionJson(next.jobHead),
        },
      )
      return { status: "committed", head: cloneCompositionJson(next.jobHead), issues: [] }
    },
  }
}
