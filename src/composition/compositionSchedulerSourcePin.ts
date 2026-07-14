import type { VNextDocumentCompositionTransitionLimitsV1 } from "@flowdoc/vnext-core"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_ATTEMPTS,
  FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_BYTES,
  FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
  blockedCompositionResult,
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  exactCompositionValue,
  readCompositionFingerprint,
  readCompositionInteger,
  readCompositionIsoDate,
  readCompositionLiteral,
  readCompositionRecord,
  readCompositionString,
  readyCompositionResult,
  type FlowDocBackendCompositionContractIssue,
  type FlowDocBackendCompositionContractResult,
} from "./compositionSchedulerContractSupport.js"

export const FLOWDOC_BACKEND_COMPOSITION_SOURCE_PIN_V1_SOURCE = "flowdoc-backend-composition-source-pin"

export const FLOWDOC_BACKEND_COMPOSITION_CONTENT_KINDS = [
  "source-snapshot",
  "composition-manifest",
  "family-window",
  "closed-page-chunk",
  "transition-receipt",
  "page-plan",
  "heading-page-map",
] as const

export type FlowDocBackendCompositionContentKindV1 = typeof FLOWDOC_BACKEND_COMPOSITION_CONTENT_KINDS[number]

export interface FlowDocBackendCompositionContentRefV1 {
  kind: FlowDocBackendCompositionContentKindV1
  jobId: string
  recordId: string
  recordFingerprint: string
  byteLength: number
}

export interface FlowDocBackendCompositionRetentionSummaryV1 {
  recordCount: number
  byteCount: number
}

export function summarizeFlowDocBackendCompositionContentRefsV1(
  refs: readonly FlowDocBackendCompositionContentRefV1[],
): FlowDocBackendCompositionRetentionSummaryV1 {
  const unique = new Map<string, FlowDocBackendCompositionContentRefV1>()
  refs.forEach((ref) => unique.set(`${ref.jobId}\u0000${ref.kind}\u0000${ref.recordId}`, ref))
  return {
    recordCount: unique.size,
    byteCount: [...unique.values()].reduce((total, ref) => total + ref.byteLength, 0),
  }
}

export interface FlowDocBackendCompositionExecutionLimitsV1 {
  maximumTransitionCount: number
  maximumAttemptCount: number
  maximumRetainedByteCount: number
}

export interface FlowDocBackendCompositionSourcePinInputV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_SOURCE_PIN_V1_SOURCE
  schemaVersion: typeof FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION
  kind: "composition-source-pin"
  jobId: string
  documentId: string
  packageVersion: 3
  documentVersion: 4
  baseRevision: number
  packageFingerprint: string
  resolvedProjectionFingerprint: string
  manifestFingerprint: string
  sourceSnapshotRef: FlowDocBackendCompositionContentRefV1
  manifestRef: FlowDocBackendCompositionContentRefV1
  profiles: {
    layoutProfileId: string
    measurementProfileId: string
    compositionProfileId: string
  }
  transitionLimits: VNextDocumentCompositionTransitionLimitsV1
  executionLimits: FlowDocBackendCompositionExecutionLimitsV1
  createdAt: string
  expiresAt: string
}

export type FlowDocBackendCompositionSourcePinV1 = FlowDocBackendCompositionSourcePinInputV1 & {
  fingerprint: string
}

export type FlowDocBackendCompositionSourcePinResultV1 = FlowDocBackendCompositionContractResult<
  FlowDocBackendCompositionSourcePinV1,
  "sourcePin"
>

function pathAt(path: string, key: string): string {
  return path.length === 0 ? key : `${path}.${key}`
}

export function parseFlowDocBackendCompositionContentRefV1(
  value: unknown,
  path: string,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionContentRefV1 | null {
  const record = readCompositionRecord(
    value,
    path,
    ["kind", "jobId", "recordId", "recordFingerprint", "byteLength"],
    issues,
  )
  if (record == null) return null
  const kind = typeof record.kind === "string" && FLOWDOC_BACKEND_COMPOSITION_CONTENT_KINDS.includes(
    record.kind as FlowDocBackendCompositionContentKindV1,
  ) ? record.kind as FlowDocBackendCompositionContentKindV1 : null
  if (kind == null) issues.push(compositionIssue(
    "composition-content-kind-invalid",
    pathAt(path, "kind"),
    `${pathAt(path, "kind")} must be a supported immutable content kind`,
  ))
  const jobId = readCompositionString(record, "jobId", pathAt(path, "jobId"), issues)
  const recordId = readCompositionString(record, "recordId", pathAt(path, "recordId"), issues)
  const recordFingerprint = readCompositionFingerprint(
    record,
    "recordFingerprint",
    pathAt(path, "recordFingerprint"),
    issues,
  )
  const byteLength = readCompositionInteger(
    record,
    "byteLength",
    pathAt(path, "byteLength"),
    1,
    FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_BYTES,
    issues,
  )
  if (kind == null || jobId == null || recordId == null || recordFingerprint == null || byteLength == null) return null
  return { kind, jobId, recordId, recordFingerprint, byteLength }
}

function readTransitionLimits(
  value: unknown,
  issues: FlowDocBackendCompositionContractIssue[],
): VNextDocumentCompositionTransitionLimitsV1 | null {
  const path = "transitionLimits"
  const record = readCompositionRecord(value, path, [
    "maximumClosedPageCount",
    "maximumPlacementCount",
    "maximumFamilyPageCount",
    "maximumFamilyFragmentCount",
  ], issues)
  if (record == null) return null
  const maximumClosedPageCount = readCompositionInteger(record, "maximumClosedPageCount", `${path}.maximumClosedPageCount`, 1, 10_000, issues)
  const maximumPlacementCount = readCompositionInteger(record, "maximumPlacementCount", `${path}.maximumPlacementCount`, 1, 100_000, issues)
  const maximumFamilyPageCount = readCompositionInteger(record, "maximumFamilyPageCount", `${path}.maximumFamilyPageCount`, 1, 10_000, issues)
  const maximumFamilyFragmentCount = readCompositionInteger(record, "maximumFamilyFragmentCount", `${path}.maximumFamilyFragmentCount`, 1, 100_000, issues)
  if (
    maximumClosedPageCount == null || maximumPlacementCount == null
    || maximumFamilyPageCount == null || maximumFamilyFragmentCount == null
  ) return null
  return { maximumClosedPageCount, maximumPlacementCount, maximumFamilyPageCount, maximumFamilyFragmentCount }
}

function readExecutionLimits(
  value: unknown,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionExecutionLimitsV1 | null {
  const path = "executionLimits"
  const record = readCompositionRecord(value, path, [
    "maximumTransitionCount", "maximumAttemptCount", "maximumRetainedByteCount",
  ], issues)
  if (record == null) return null
  const maximumTransitionCount = readCompositionInteger(record, "maximumTransitionCount", `${path}.maximumTransitionCount`, 1, 1_000_000, issues)
  const maximumAttemptCount = readCompositionInteger(record, "maximumAttemptCount", `${path}.maximumAttemptCount`, 1, FLOWDOC_BACKEND_COMPOSITION_MAX_ATTEMPTS, issues)
  const maximumRetainedByteCount = readCompositionInteger(record, "maximumRetainedByteCount", `${path}.maximumRetainedByteCount`, 1, FLOWDOC_BACKEND_COMPOSITION_MAX_RETAINED_BYTES, issues)
  if (maximumTransitionCount == null || maximumAttemptCount == null || maximumRetainedByteCount == null) return null
  if (maximumAttemptCount < maximumTransitionCount) issues.push(compositionIssue(
    "composition-attempt-limit-invalid",
    `${path}.maximumAttemptCount`,
    "maximum attempt count cannot be lower than maximum transition count",
  ))
  return { maximumTransitionCount, maximumAttemptCount, maximumRetainedByteCount }
}

function readProfiles(
  value: unknown,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionSourcePinInputV1["profiles"] | null {
  const path = "profiles"
  const record = readCompositionRecord(value, path, ["layoutProfileId", "measurementProfileId", "compositionProfileId"], issues)
  if (record == null) return null
  const layoutProfileId = readCompositionString(record, "layoutProfileId", `${path}.layoutProfileId`, issues)
  const measurementProfileId = readCompositionString(record, "measurementProfileId", `${path}.measurementProfileId`, issues)
  const compositionProfileId = readCompositionString(record, "compositionProfileId", `${path}.compositionProfileId`, issues)
  return layoutProfileId && measurementProfileId && compositionProfileId
    ? { layoutProfileId, measurementProfileId, compositionProfileId }
    : null
}

function readSourcePinFacts(
  value: unknown,
  includeFingerprint: boolean,
): { facts: FlowDocBackendCompositionSourcePinInputV1 | null; fingerprint: string | null; issues: FlowDocBackendCompositionContractIssue[] } {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const keys = [
    "source", "schemaVersion", "kind", "jobId", "documentId", "packageVersion",
    "documentVersion", "baseRevision", "packageFingerprint", "resolvedProjectionFingerprint",
    "manifestFingerprint", "sourceSnapshotRef", "manifestRef", "profiles", "transitionLimits",
    "executionLimits", "createdAt", "expiresAt",
    ...(includeFingerprint ? ["fingerprint"] : []),
  ]
  const record = readCompositionRecord(value, "", keys, issues)
  if (record == null) return { facts: null, fingerprint: null, issues }
  readCompositionLiteral(record, "source", "source", FLOWDOC_BACKEND_COMPOSITION_SOURCE_PIN_V1_SOURCE, issues)
  readCompositionLiteral(record, "schemaVersion", "schemaVersion", FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION, issues)
  readCompositionLiteral(record, "kind", "kind", "composition-source-pin", issues)
  const jobId = readCompositionString(record, "jobId", "jobId", issues)
  const documentId = readCompositionString(record, "documentId", "documentId", issues)
  readCompositionLiteral(record, "packageVersion", "packageVersion", 3, issues)
  readCompositionLiteral(record, "documentVersion", "documentVersion", 4, issues)
  const baseRevision = readCompositionInteger(record, "baseRevision", "baseRevision", 0, Number.MAX_SAFE_INTEGER, issues)
  const packageFingerprint = readCompositionFingerprint(record, "packageFingerprint", "packageFingerprint", issues)
  const resolvedProjectionFingerprint = readCompositionFingerprint(record, "resolvedProjectionFingerprint", "resolvedProjectionFingerprint", issues)
  const manifestFingerprint = readCompositionFingerprint(record, "manifestFingerprint", "manifestFingerprint", issues)
  const sourceSnapshotRef = parseFlowDocBackendCompositionContentRefV1(record.sourceSnapshotRef, "sourceSnapshotRef", issues)
  const manifestRef = parseFlowDocBackendCompositionContentRefV1(record.manifestRef, "manifestRef", issues)
  const profiles = readProfiles(record.profiles, issues)
  const transitionLimits = readTransitionLimits(record.transitionLimits, issues)
  const executionLimits = readExecutionLimits(record.executionLimits, issues)
  const createdAt = readCompositionIsoDate(record, "createdAt", "createdAt", issues)
  const expiresAt = readCompositionIsoDate(record, "expiresAt", "expiresAt", issues)
  const fingerprint = includeFingerprint
    ? readCompositionFingerprint(record, "fingerprint", "fingerprint", issues)
    : null

  if (jobId != null && sourceSnapshotRef != null && (
    sourceSnapshotRef.jobId !== jobId || sourceSnapshotRef.kind !== "source-snapshot"
  )) issues.push(compositionIssue(
    "composition-source-reference-invalid",
    "sourceSnapshotRef",
    "source snapshot reference must belong to the exact job and source-snapshot kind",
  ))
  if (jobId != null && manifestRef != null && (
    manifestRef.jobId !== jobId || manifestRef.kind !== "composition-manifest"
  )) issues.push(compositionIssue(
    "composition-manifest-reference-invalid",
    "manifestRef",
    "manifest reference must belong to the exact job and composition-manifest kind",
  ))
  if (manifestFingerprint != null && manifestRef != null && manifestRef.recordFingerprint !== manifestFingerprint) {
    issues.push(compositionIssue(
      "composition-manifest-owner-mismatch",
      "manifestRef.recordFingerprint",
      "manifest reference must retain the exact core manifest fingerprint",
    ))
  }
  if (createdAt != null && expiresAt != null && Date.parse(expiresAt) <= Date.parse(createdAt)) issues.push(compositionIssue(
    "composition-expiry-invalid", "expiresAt", "expiry must be later than creation",
  ))

  if (
    issues.length > 0 || jobId == null || documentId == null || baseRevision == null
    || packageFingerprint == null || resolvedProjectionFingerprint == null || manifestFingerprint == null
    || sourceSnapshotRef == null || manifestRef == null || profiles == null || transitionLimits == null
    || executionLimits == null || createdAt == null || expiresAt == null
  ) return { facts: null, fingerprint, issues }

  return {
    facts: {
      source: FLOWDOC_BACKEND_COMPOSITION_SOURCE_PIN_V1_SOURCE,
      schemaVersion: FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
      kind: "composition-source-pin",
      jobId,
      documentId,
      packageVersion: 3,
      documentVersion: 4,
      baseRevision,
      packageFingerprint,
      resolvedProjectionFingerprint,
      manifestFingerprint,
      sourceSnapshotRef,
      manifestRef,
      profiles,
      transitionLimits,
      executionLimits,
      createdAt,
      expiresAt,
    },
    fingerprint,
    issues,
  }
}

export function finalizeFlowDocBackendCompositionSourcePinV1(value: unknown): FlowDocBackendCompositionSourcePinResultV1 {
  const parsed = readSourcePinFacts(value, false)
  if (parsed.facts == null) return blockedCompositionResult("sourcePin", parsed.issues)
  const facts = cloneCompositionJson(parsed.facts)
  return readyCompositionResult("sourcePin", { ...facts, fingerprint: compositionFingerprint(facts) })
}

export function parseFlowDocBackendCompositionSourcePinV1(value: unknown): FlowDocBackendCompositionSourcePinResultV1 {
  const parsed = readSourcePinFacts(value, true)
  if (parsed.facts == null || parsed.fingerprint == null) return blockedCompositionResult("sourcePin", parsed.issues)
  const expected = finalizeFlowDocBackendCompositionSourcePinV1(parsed.facts)
  if (expected.status === "blocked") return expected
  if (!exactCompositionValue(expected.sourcePin.fingerprint, parsed.fingerprint)) return blockedCompositionResult("sourcePin", [
    compositionIssue("composition-source-pin-fingerprint-mismatch", "fingerprint", "source pin fingerprint does not match its facts"),
  ])
  return expected
}
