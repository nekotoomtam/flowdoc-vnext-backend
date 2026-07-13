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
  createHead(input: {
    createRequestId: string
    requestFingerprint: string
    sourcePin: unknown
    manifest: unknown
    head: unknown
  }): Promise<FlowDocBackendCompositionHeadCreateResultV1>
  readHead(jobId: string): Promise<FlowDocBackendCompositionHeadReadResultV1>
  compareAndSwapHead(input: {
    jobId: string
    expectedHeadRevision: number
    expectedHeadFingerprint: string
    nextHead: unknown
    committedRequest?: FlowDocBackendCompositionCommittedRequestV1 | null
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

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function immutableKey(jobId: string, recordId: string): string {
  return `${jobId}\u0000${recordId}`
}

function requestKey(jobId: string, requestId: string): string {
  return `${jobId}\u0000${requestId}`
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
  const heads = new Map<string, StoredHead>()
  const committedRequests = new Map<string, StoredCommittedRequest>()

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
      immutable.set(key, { ref: cloneCompositionJson(ref), value: cloneCompositionJson(input.value) })
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

    async compareAndSwapHead(input) {
      const stored = heads.get(input.jobId)
      if (stored == null) return {
        status: "not-found",
        head: null,
        issues: [compositionIssue("composition-head-not-found", "jobId", "composition job head was not found")],
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
      stored.head = cloneCompositionJson(next.jobHead)
      if (input.committedRequest != null) committedRequests.set(
        requestKey(input.jobId, input.committedRequest.requestId),
        {
          requestFingerprint: input.committedRequest.requestFingerprint,
          receiptRef: cloneCompositionJson(input.committedRequest.receiptRef),
          head: cloneCompositionJson(next.jobHead),
        },
      )
      return { status: "committed", head: cloneCompositionJson(next.jobHead), issues: [] }
    },
  }
}
