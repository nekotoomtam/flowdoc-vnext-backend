import {
  parseVNextDocumentCompositionDemandV1,
  parseVNextDocumentCompositionManifestV1,
  parseVNextDocumentCompositionStateV1,
  type VNextDocumentCompositionCursorV1,
  type VNextDocumentCompositionDemandV1,
  type VNextDocumentCompositionManifestV1,
  type VNextDocumentCompositionOpenPageV1,
} from "@flowdoc/vnext-core"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_ATTEMPTS,
  FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
  blockedCompositionResult,
  cloneCompositionJson,
  compositionFingerprint,
  compositionIssue,
  readCompositionEnum,
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
import {
  parseFlowDocBackendCompositionContentRefV1,
  parseFlowDocBackendCompositionSourcePinV1,
  type FlowDocBackendCompositionContentRefV1,
  type FlowDocBackendCompositionSourcePinV1,
} from "./compositionSchedulerSourcePin.js"

export const FLOWDOC_BACKEND_COMPOSITION_JOB_HEAD_V1_SOURCE = "flowdoc-backend-composition-job-head"

export const FLOWDOC_BACKEND_COMPOSITION_JOB_STATUSES = [
  "waiting-window",
  "ready-to-advance",
  "ready-to-finalize",
  "completed",
  "blocked",
  "cancelled",
  "expired",
] as const

export type FlowDocBackendCompositionJobStatusV1 = typeof FLOWDOC_BACKEND_COMPOSITION_JOB_STATUSES[number]

export interface FlowDocBackendCompositionLeaseV1 {
  attemptId: string
  leaseToken: string
  acquiredAt: string
  expiresAt: string
}

export interface FlowDocBackendCompositionRetryV1 {
  attemptCount: number
  retryAfter: string | null
}

export interface FlowDocBackendCompositionBlockerV1 {
  code: string
  message: string
  path: string
  retryable: boolean
  recordedAt: string
}

export interface FlowDocBackendCompositionOutputRefsV1 {
  compositionFingerprint: string
  pagePlanRef: FlowDocBackendCompositionContentRefV1
  headingPageMapRef: FlowDocBackendCompositionContentRefV1
}

export interface FlowDocBackendCompositionChainV1 {
  transitionReceiptTipFingerprint: string | null
  closedPageChunkTipFingerprint: string | null
  closedPagePrefixFingerprint: string | null
  pageCount: number
  placementCount: number
  headingCount: number
}

export interface FlowDocBackendCompositionJobHeadInputV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_JOB_HEAD_V1_SOURCE
  schemaVersion: typeof FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION
  kind: "composition-job-head"
  jobId: string
  headRevision: number
  sourcePinFingerprint: string
  manifestFingerprint: string
  status: FlowDocBackendCompositionJobStatusV1
  transitionNumber: number
  cursor: VNextDocumentCompositionCursorV1
  openPage: VNextDocumentCompositionOpenPageV1 | null
  demand: VNextDocumentCompositionDemandV1 | null
  chain: FlowDocBackendCompositionChainV1
  lease: FlowDocBackendCompositionLeaseV1 | null
  retry: FlowDocBackendCompositionRetryV1
  blocker: FlowDocBackendCompositionBlockerV1 | null
  finalOutput: FlowDocBackendCompositionOutputRefsV1 | null
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export type FlowDocBackendCompositionJobHeadV1 = FlowDocBackendCompositionJobHeadInputV1 & {
  fingerprint: string
}

export type FlowDocBackendCompositionJobHeadResultV1 = FlowDocBackendCompositionContractResult<
  FlowDocBackendCompositionJobHeadV1,
  "jobHead"
>

export interface FlowDocBackendCompositionJobHeadContextV1 {
  value: unknown
  sourcePin: unknown
  manifest: unknown
}

function coreIssues(
  path: string,
  values: readonly { code: string; message: string; path: string }[],
): FlowDocBackendCompositionContractIssue[] {
  return values.map((value) => compositionIssue(
    value.code,
    `${path}${value.path.length === 0 ? "" : `.${value.path}`}`,
    value.message,
  ))
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: FlowDocBackendCompositionContractIssue[],
): string | null | undefined {
  if (record[key] === null) return null
  return readCompositionString(record, key, path, issues) ?? undefined
}

function readLease(value: unknown, issues: FlowDocBackendCompositionContractIssue[]): FlowDocBackendCompositionLeaseV1 | null | undefined {
  if (value === null) return null
  const record = readCompositionRecord(value, "lease", ["attemptId", "leaseToken", "acquiredAt", "expiresAt"], issues)
  if (record == null) return undefined
  const attemptId = readCompositionString(record, "attemptId", "lease.attemptId", issues)
  const leaseToken = readCompositionString(record, "leaseToken", "lease.leaseToken", issues)
  const acquiredAt = readCompositionIsoDate(record, "acquiredAt", "lease.acquiredAt", issues)
  const expiresAt = readCompositionIsoDate(record, "expiresAt", "lease.expiresAt", issues)
  if (acquiredAt != null && expiresAt != null && Date.parse(expiresAt) <= Date.parse(acquiredAt)) issues.push(compositionIssue(
    "composition-lease-expiry-invalid", "lease.expiresAt", "lease expiry must be later than acquisition",
  ))
  return attemptId && leaseToken && acquiredAt && expiresAt ? { attemptId, leaseToken, acquiredAt, expiresAt } : undefined
}

function readRetry(value: unknown, issues: FlowDocBackendCompositionContractIssue[]): FlowDocBackendCompositionRetryV1 | null {
  const record = readCompositionRecord(value, "retry", ["attemptCount", "retryAfter"], issues)
  if (record == null) return null
  const attemptCount = readCompositionInteger(record, "attemptCount", "retry.attemptCount", 0, FLOWDOC_BACKEND_COMPOSITION_MAX_ATTEMPTS, issues)
  let retryAfter: string | null = null
  if (record.retryAfter !== null) retryAfter = readCompositionIsoDate(record, "retryAfter", "retry.retryAfter", issues)
  return attemptCount == null ? null : { attemptCount, retryAfter }
}

function readBlocker(value: unknown, issues: FlowDocBackendCompositionContractIssue[]): FlowDocBackendCompositionBlockerV1 | null | undefined {
  if (value === null) return null
  const record = readCompositionRecord(value, "blocker", ["code", "message", "path", "retryable", "recordedAt"], issues)
  if (record == null) return undefined
  const code = readCompositionString(record, "code", "blocker.code", issues)
  const message = readCompositionString(record, "message", "blocker.message", issues)
  const path = typeof record.path === "string" && record.path.length <= 512 ? record.path : null
  if (path == null) issues.push(compositionIssue("composition-blocker-path-invalid", "blocker.path", "blocker path must be a bounded string"))
  const retryable = typeof record.retryable === "boolean" ? record.retryable : null
  if (retryable == null) issues.push(compositionIssue("composition-blocker-retryable-invalid", "blocker.retryable", "blocker retryable must be a boolean"))
  const recordedAt = readCompositionIsoDate(record, "recordedAt", "blocker.recordedAt", issues)
  return code && message && path != null && retryable != null && recordedAt
    ? { code, message, path, retryable, recordedAt }
    : undefined
}

function readChain(value: unknown, issues: FlowDocBackendCompositionContractIssue[]): FlowDocBackendCompositionChainV1 | null {
  const record = readCompositionRecord(value, "chain", [
    "transitionReceiptTipFingerprint", "closedPageChunkTipFingerprint",
    "closedPagePrefixFingerprint", "pageCount", "placementCount", "headingCount",
  ], issues)
  if (record == null) return null
  const transitionReceiptTipFingerprint = record.transitionReceiptTipFingerprint === null
    ? null
    : readCompositionFingerprint(record, "transitionReceiptTipFingerprint", "chain.transitionReceiptTipFingerprint", issues)
  const closedPageChunkTipFingerprint = record.closedPageChunkTipFingerprint === null
    ? null
    : readCompositionFingerprint(record, "closedPageChunkTipFingerprint", "chain.closedPageChunkTipFingerprint", issues)
  const closedPagePrefixFingerprint = record.closedPagePrefixFingerprint === null
    ? null
    : readCompositionFingerprint(record, "closedPagePrefixFingerprint", "chain.closedPagePrefixFingerprint", issues)
  const pageCount = readCompositionInteger(record, "pageCount", "chain.pageCount", 0, 1_000_000, issues)
  const placementCount = readCompositionInteger(record, "placementCount", "chain.placementCount", 0, 10_000_000, issues)
  const headingCount = readCompositionInteger(record, "headingCount", "chain.headingCount", 0, 10_000_000, issues)
  if (pageCount == null || placementCount == null || headingCount == null) return null
  if (
    (pageCount === 0) !== (closedPageChunkTipFingerprint == null)
    || (pageCount === 0) !== (closedPagePrefixFingerprint == null)
  ) issues.push(compositionIssue(
    "composition-page-chunk-tip-invalid", "chain.closedPageChunkTipFingerprint",
    "only an empty closed-page chain may have a null chunk tip",
  ))
  return {
    transitionReceiptTipFingerprint,
    closedPageChunkTipFingerprint,
    closedPagePrefixFingerprint,
    pageCount,
    placementCount,
    headingCount,
  }
}

function readFinalOutput(
  value: unknown,
  jobId: string | null,
  issues: FlowDocBackendCompositionContractIssue[],
): FlowDocBackendCompositionOutputRefsV1 | null | undefined {
  if (value === null) return null
  const record = readCompositionRecord(value, "finalOutput", ["compositionFingerprint", "pagePlanRef", "headingPageMapRef"], issues)
  if (record == null) return undefined
  const compositionOwner = readCompositionFingerprint(record, "compositionFingerprint", "finalOutput.compositionFingerprint", issues)
  const pagePlanRef = parseFlowDocBackendCompositionContentRefV1(record.pagePlanRef, "finalOutput.pagePlanRef", issues)
  const headingPageMapRef = parseFlowDocBackendCompositionContentRefV1(record.headingPageMapRef, "finalOutput.headingPageMapRef", issues)
  if (jobId != null && pagePlanRef != null && (pagePlanRef.jobId !== jobId || pagePlanRef.kind !== "page-plan")) issues.push(compositionIssue(
    "composition-page-plan-reference-invalid", "finalOutput.pagePlanRef", "page plan reference must belong to the exact job",
  ))
  if (jobId != null && headingPageMapRef != null && (
    headingPageMapRef.jobId !== jobId || headingPageMapRef.kind !== "heading-page-map"
  )) issues.push(compositionIssue(
    "composition-heading-map-reference-invalid", "finalOutput.headingPageMapRef", "heading map reference must belong to the exact job",
  ))
  return compositionOwner && pagePlanRef && headingPageMapRef
    ? { compositionFingerprint: compositionOwner, pagePlanRef, headingPageMapRef }
    : undefined
}

function parseContext(context: FlowDocBackendCompositionJobHeadContextV1): {
  sourcePin: FlowDocBackendCompositionSourcePinV1 | null
  manifest: VNextDocumentCompositionManifestV1 | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const sourcePinResult = parseFlowDocBackendCompositionSourcePinV1(context.sourcePin)
  if (sourcePinResult.status === "blocked") issues.push(...sourcePinResult.issues.map((item) => ({ ...item, path: `sourcePin${item.path.length === 0 ? "" : `.${item.path}`}` })))
  const manifestResult = parseVNextDocumentCompositionManifestV1(context.manifest)
  if (manifestResult.status === "blocked") issues.push(...coreIssues("manifest", manifestResult.issues))
  const sourcePin = sourcePinResult.status === "ready" ? sourcePinResult.sourcePin : null
  const manifest = manifestResult.status === "ready" ? manifestResult.manifest : null
  if (sourcePin != null && manifest != null && (
    sourcePin.documentId !== manifest.documentId
    || sourcePin.manifestFingerprint !== manifest.fingerprint
    || sourcePin.resolvedProjectionFingerprint !== manifest.resolvedProjectionFingerprint
  )) issues.push(compositionIssue(
    "composition-source-manifest-mismatch", "manifest", "manifest must match the exact source pin owners",
  ))
  return { sourcePin, manifest, issues }
}

function readJobHeadFacts(
  context: FlowDocBackendCompositionJobHeadContextV1,
  includeFingerprint: boolean,
): { facts: FlowDocBackendCompositionJobHeadInputV1 | null; fingerprint: string | null; issues: FlowDocBackendCompositionContractIssue[] } {
  const parsedContext = parseContext(context)
  const issues = parsedContext.issues
  const keys = [
    "source", "schemaVersion", "kind", "jobId", "headRevision", "sourcePinFingerprint",
    "manifestFingerprint", "status", "transitionNumber", "cursor", "openPage", "demand",
    "chain", "lease", "retry", "blocker", "finalOutput", "createdAt", "updatedAt", "expiresAt",
    ...(includeFingerprint ? ["fingerprint"] : []),
  ]
  const record = readCompositionRecord(context.value, "", keys, issues)
  if (record == null) return { facts: null, fingerprint: null, issues }
  readCompositionLiteral(record, "source", "source", FLOWDOC_BACKEND_COMPOSITION_JOB_HEAD_V1_SOURCE, issues)
  readCompositionLiteral(record, "schemaVersion", "schemaVersion", FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION, issues)
  readCompositionLiteral(record, "kind", "kind", "composition-job-head", issues)
  const jobId = readCompositionString(record, "jobId", "jobId", issues)
  const headRevision = readCompositionInteger(record, "headRevision", "headRevision", 0, Number.MAX_SAFE_INTEGER, issues)
  const sourcePinFingerprint = readCompositionFingerprint(record, "sourcePinFingerprint", "sourcePinFingerprint", issues)
  const manifestFingerprint = readCompositionFingerprint(record, "manifestFingerprint", "manifestFingerprint", issues)
  const status = readCompositionEnum(record, "status", "status", FLOWDOC_BACKEND_COMPOSITION_JOB_STATUSES, issues)
  const transitionNumber = readCompositionInteger(record, "transitionNumber", "transitionNumber", 0, 1_000_000, issues)
  const chain = readChain(record.chain, issues)
  const lease = readLease(record.lease, issues)
  const retry = readRetry(record.retry, issues)
  const blocker = readBlocker(record.blocker, issues)
  const finalOutput = readFinalOutput(record.finalOutput, jobId, issues)
  const createdAt = readCompositionIsoDate(record, "createdAt", "createdAt", issues)
  const updatedAt = readCompositionIsoDate(record, "updatedAt", "updatedAt", issues)
  const expiresAt = readCompositionIsoDate(record, "expiresAt", "expiresAt", issues)
  const fingerprint = includeFingerprint ? readCompositionFingerprint(record, "fingerprint", "fingerprint", issues) : null

  let cursor: VNextDocumentCompositionCursorV1 | null = null
  let openPage: VNextDocumentCompositionOpenPageV1 | null = null
  if (parsedContext.manifest != null) {
    const state = parseVNextDocumentCompositionStateV1({
      manifest: parsedContext.manifest,
      cursor: record.cursor,
      openPage: record.openPage,
    })
    if (state.status === "blocked") issues.push(...coreIssues("cursor", state.issues))
    else {
      cursor = state.cursor
      openPage = state.openPage
    }
  }
  let demand: VNextDocumentCompositionDemandV1 | null = null
  if (record.demand !== null) {
    const result = parseVNextDocumentCompositionDemandV1(record.demand)
    if (result.status === "blocked") issues.push(...coreIssues("demand", result.issues))
    else demand = result.demand
  }

  const sourcePin = parsedContext.sourcePin
  const manifest = parsedContext.manifest
  if (sourcePin != null && (
    jobId !== sourcePin.jobId || sourcePinFingerprint !== sourcePin.fingerprint
    || manifestFingerprint !== sourcePin.manifestFingerprint
    || createdAt !== sourcePin.createdAt || expiresAt !== sourcePin.expiresAt
  )) issues.push(compositionIssue(
    "composition-job-source-pin-mismatch", "sourcePinFingerprint", "job head must match the exact source pin and lifetime",
  ))
  if (manifest != null && cursor != null && (
    cursor.documentId !== manifest.documentId || cursor.manifestFingerprint !== manifest.fingerprint
  )) issues.push(compositionIssue("composition-job-cursor-owner-mismatch", "cursor", "cursor must belong to the pinned manifest"))
  if (manifest != null && demand != null && (
    demand.documentId !== manifest.documentId || demand.manifestFingerprint !== manifest.fingerprint
  )) issues.push(compositionIssue("composition-job-demand-owner-mismatch", "demand", "demand must belong to the pinned manifest"))
  if (cursor != null && chain != null && (
    cursor.closedPrefix.pageCount !== chain.pageCount
    || cursor.closedPrefix.placementCount !== chain.placementCount
    || cursor.closedPrefix.headingCount !== chain.headingCount
    || cursor.closedPrefix.fingerprint !== chain.closedPagePrefixFingerprint
  )) issues.push(compositionIssue("composition-job-chain-mismatch", "chain", "job chain must equal the exact core cursor closed prefix"))
  if (transitionNumber != null && chain != null && (
    (transitionNumber === 0) !== (chain.transitionReceiptTipFingerprint == null)
  )) issues.push(compositionIssue(
    "composition-transition-tip-invalid", "chain.transitionReceiptTipFingerprint",
    "only a job with zero transitions may have a null transition receipt tip",
  ))

  if (status != null && cursor != null) {
    if (status === "waiting-window") {
      if (cursor.complete || demand == null || cursor.activeRoot == null || finalOutput != null) issues.push(compositionIssue(
        "composition-waiting-state-invalid", "status", "waiting-window requires an incomplete active root, exact demand, and no final output",
      ))
      if (demand != null && cursor.activeRoot != null && (
        demand.itemIndex !== cursor.activeRoot.itemIndex
        || demand.rootNodeId !== cursor.activeRoot.rootNodeId
        || demand.family !== cursor.activeRoot.family
        || demand.cursorBefore.stateFingerprint !== cursor.activeRoot.familyCursor.stateFingerprint
      )) issues.push(compositionIssue(
        "composition-demand-cursor-mismatch", "demand", "demand must match the exact active core cursor",
      ))
    } else if (status === "ready-to-advance") {
      if (cursor.complete || cursor.activeRoot != null || demand != null || finalOutput != null) issues.push(compositionIssue(
        "composition-continuation-state-invalid", "status",
        "ready-to-advance requires incomplete structural state with no active root, demand, or final output",
      ))
    } else if (status === "ready-to-finalize") {
      if (!cursor.complete || demand != null || openPage != null || finalOutput != null) issues.push(compositionIssue(
        "composition-finalization-state-invalid", "status", "ready-to-finalize requires a terminal core cursor and no output",
      ))
    } else if (status === "completed") {
      if (!cursor.complete || demand != null || openPage != null || finalOutput == null || lease != null) issues.push(compositionIssue(
        "composition-completed-state-invalid", "status", "completed requires terminal core state, exact outputs, and no lease",
      ))
    } else if (demand != null || finalOutput != null || lease != null) issues.push(compositionIssue(
      "composition-terminal-state-invalid", "status", "blocked, cancelled, and expired jobs cannot retain demand, output, or lease",
    ))
  }

  if (status != null && blocker !== undefined) {
    if (status === "blocked" && blocker == null) issues.push(compositionIssue(
      "composition-blocker-missing", "blocker", "blocked status requires one bounded blocker",
    ))
    if (status !== "blocked" && blocker != null && !blocker.retryable) issues.push(compositionIssue(
      "composition-nonretryable-blocker-invalid", "blocker", "non-blocked jobs may retain only retryable diagnostics",
    ))
  }
  if (retry != null && sourcePin != null && retry.attemptCount > sourcePin.executionLimits.maximumAttemptCount) issues.push(compositionIssue(
    "composition-attempt-limit-exceeded", "retry.attemptCount", "attempt count exceeds the pinned execution limit",
  ))
  if (createdAt != null && updatedAt != null && expiresAt != null && (
    Date.parse(updatedAt) < Date.parse(createdAt) || Date.parse(updatedAt) > Date.parse(expiresAt)
  )) issues.push(compositionIssue("composition-job-time-invalid", "updatedAt", "updated time must stay within the pinned job lifetime"))
  if (lease != null && updatedAt != null && expiresAt != null && (
    Date.parse(lease.acquiredAt) < Date.parse(updatedAt) || Date.parse(lease.expiresAt) > Date.parse(expiresAt)
  )) issues.push(compositionIssue("composition-job-lease-time-invalid", "lease", "lease must begin at/after update and end before job expiry"))

  if (
    issues.length > 0 || jobId == null || headRevision == null || sourcePinFingerprint == null
    || manifestFingerprint == null || status == null || transitionNumber == null || cursor == null
    || chain == null || lease === undefined || retry == null || blocker === undefined || finalOutput === undefined
    || createdAt == null || updatedAt == null || expiresAt == null
  ) return { facts: null, fingerprint, issues }

  return {
    facts: {
      source: FLOWDOC_BACKEND_COMPOSITION_JOB_HEAD_V1_SOURCE,
      schemaVersion: FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
      kind: "composition-job-head",
      jobId,
      headRevision,
      sourcePinFingerprint,
      manifestFingerprint,
      status,
      transitionNumber,
      cursor,
      openPage,
      demand,
      chain,
      lease,
      retry,
      blocker,
      finalOutput,
      createdAt,
      updatedAt,
      expiresAt,
    },
    fingerprint,
    issues,
  }
}

export function finalizeFlowDocBackendCompositionJobHeadV1(
  context: FlowDocBackendCompositionJobHeadContextV1,
): FlowDocBackendCompositionJobHeadResultV1 {
  const parsed = readJobHeadFacts(context, false)
  if (parsed.facts == null) return blockedCompositionResult("jobHead", parsed.issues)
  const facts = cloneCompositionJson(parsed.facts)
  return readyCompositionResult("jobHead", { ...facts, fingerprint: compositionFingerprint(facts) })
}

export function parseFlowDocBackendCompositionJobHeadV1(
  context: FlowDocBackendCompositionJobHeadContextV1,
): FlowDocBackendCompositionJobHeadResultV1 {
  const parsed = readJobHeadFacts(context, true)
  if (parsed.facts == null || parsed.fingerprint == null) return blockedCompositionResult("jobHead", parsed.issues)
  const finalized = finalizeFlowDocBackendCompositionJobHeadV1({ ...context, value: parsed.facts })
  if (finalized.status === "blocked") return finalized
  if (finalized.jobHead.fingerprint !== parsed.fingerprint) return blockedCompositionResult("jobHead", [
    compositionIssue("composition-job-head-fingerprint-mismatch", "fingerprint", "job head fingerprint does not match its facts"),
  ])
  return finalized
}
