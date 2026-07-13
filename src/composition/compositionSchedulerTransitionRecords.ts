import {
  parseVNextDocumentCompositionClosedPageV1,
  parseVNextDocumentCompositionManifestV1,
  type VNextDocumentCompositionClosedPageV1,
  type VNextDocumentCompositionTransitionWorkV1,
} from "@flowdoc/vnext-core"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_CHUNK_PAGES,
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

export const FLOWDOC_BACKEND_COMPOSITION_PAGE_CHUNK_V1_SOURCE = "flowdoc-backend-composition-page-chunk"
export const FLOWDOC_BACKEND_COMPOSITION_TRANSITION_RECEIPT_V1_SOURCE = "flowdoc-backend-composition-transition-receipt"

export interface FlowDocBackendCompositionPageChunkInputV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_PAGE_CHUNK_V1_SOURCE
  schemaVersion: typeof FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION
  kind: "composition-closed-page-chunk"
  jobId: string
  transitionNumber: number
  manifestFingerprint: string
  windowRef: FlowDocBackendCompositionContentRefV1 | null
  previousChunkFingerprint: string | null
  closedPrefixBeforeFingerprint: string | null
  closedPrefixAfterFingerprint: string
  pageCountBefore: number
  placementCountBefore: number
  headingCountBefore: number
  pages: VNextDocumentCompositionClosedPageV1[]
  createdAt: string
}

export type FlowDocBackendCompositionPageChunkV1 = FlowDocBackendCompositionPageChunkInputV1 & {
  fingerprint: string
}

export type FlowDocBackendCompositionPageChunkResultV1 = FlowDocBackendCompositionContractResult<
  FlowDocBackendCompositionPageChunkV1,
  "pageChunk"
>

export interface FlowDocBackendCompositionTransitionReceiptInputV1 {
  source: typeof FLOWDOC_BACKEND_COMPOSITION_TRANSITION_RECEIPT_V1_SOURCE
  schemaVersion: typeof FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION
  kind: "composition-transition-receipt"
  jobId: string
  transitionNumber: number
  transitionRequestId: string
  requestFingerprint: string
  attemptId: string
  headRevisionBefore: number
  headRevisionAfter: number
  manifestFingerprint: string
  demandBeforeFingerprint: string | null
  windowRef: FlowDocBackendCompositionContentRefV1 | null
  transitionFingerprint: string
  cursorBeforeFingerprint: string
  cursorAfterFingerprint: string
  openPageAfterFingerprint: string | null
  demandAfterFingerprint: string | null
  pageChunkRef: FlowDocBackendCompositionContentRefV1 | null
  previousReceiptFingerprint: string | null
  status: "partial" | "complete"
  reason: "needs-family-window" | "output-limit" | "document-complete"
  work: VNextDocumentCompositionTransitionWorkV1
  createdAt: string
}

export type FlowDocBackendCompositionTransitionReceiptV1 = FlowDocBackendCompositionTransitionReceiptInputV1 & {
  fingerprint: string
}

export type FlowDocBackendCompositionTransitionReceiptResultV1 = FlowDocBackendCompositionContractResult<
  FlowDocBackendCompositionTransitionReceiptV1,
  "receipt"
>

interface Context {
  value: unknown
  sourcePin: unknown
  manifest: unknown
}

function parseOwners(context: Context): {
  sourcePin: FlowDocBackendCompositionSourcePinV1 | null
  manifestFingerprint: string | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const issues: FlowDocBackendCompositionContractIssue[] = []
  const source = parseFlowDocBackendCompositionSourcePinV1(context.sourcePin)
  if (source.status === "blocked") issues.push(...source.issues)
  const manifest = parseVNextDocumentCompositionManifestV1(context.manifest)
  if (manifest.status === "blocked") issues.push(...manifest.issues.map((item) => compositionIssue(
    item.code, `manifest${item.path.length === 0 ? "" : `.${item.path}`}`, item.message,
  )))
  if (source.status === "ready" && manifest.status === "ready" && (
    source.sourcePin.manifestFingerprint !== manifest.manifest.fingerprint
    || source.sourcePin.documentId !== manifest.manifest.documentId
  )) issues.push(compositionIssue("composition-record-owner-mismatch", "manifest", "record context owners do not match"))
  return {
    sourcePin: source.status === "ready" ? source.sourcePin : null,
    manifestFingerprint: manifest.status === "ready" ? manifest.manifest.fingerprint : null,
    issues,
  }
}

function readNullableFingerprint(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: FlowDocBackendCompositionContractIssue[],
): string | null | undefined {
  if (record[key] === null) return null
  return readCompositionFingerprint(record, key, path, issues) ?? undefined
}

function readPageChunkFacts(context: Context, includeFingerprint: boolean): {
  facts: FlowDocBackendCompositionPageChunkInputV1 | null
  fingerprint: string | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const owners = parseOwners(context)
  const issues = owners.issues
  const keys = [
    "source", "schemaVersion", "kind", "jobId", "transitionNumber", "manifestFingerprint",
    "windowRef", "previousChunkFingerprint", "closedPrefixBeforeFingerprint",
    "closedPrefixAfterFingerprint", "pageCountBefore", "placementCountBefore",
    "headingCountBefore", "pages", "createdAt", ...(includeFingerprint ? ["fingerprint"] : []),
  ]
  const record = readCompositionRecord(context.value, "", keys, issues)
  if (record == null) return { facts: null, fingerprint: null, issues }
  readCompositionLiteral(record, "source", "source", FLOWDOC_BACKEND_COMPOSITION_PAGE_CHUNK_V1_SOURCE, issues)
  readCompositionLiteral(record, "schemaVersion", "schemaVersion", FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION, issues)
  readCompositionLiteral(record, "kind", "kind", "composition-closed-page-chunk", issues)
  const jobId = readCompositionString(record, "jobId", "jobId", issues)
  const transitionNumber = readCompositionInteger(record, "transitionNumber", "transitionNumber", 0, 1_000_000, issues)
  const manifestFingerprint = readCompositionFingerprint(record, "manifestFingerprint", "manifestFingerprint", issues)
  const windowRef = record.windowRef === null
    ? null
    : parseFlowDocBackendCompositionContentRefV1(record.windowRef, "windowRef", issues)
  const previousChunkFingerprint = readNullableFingerprint(record, "previousChunkFingerprint", "previousChunkFingerprint", issues)
  const closedPrefixBeforeFingerprint = readNullableFingerprint(record, "closedPrefixBeforeFingerprint", "closedPrefixBeforeFingerprint", issues)
  const closedPrefixAfterFingerprint = readCompositionFingerprint(record, "closedPrefixAfterFingerprint", "closedPrefixAfterFingerprint", issues)
  const pageCountBefore = readCompositionInteger(record, "pageCountBefore", "pageCountBefore", 0, 1_000_000, issues)
  const placementCountBefore = readCompositionInteger(record, "placementCountBefore", "placementCountBefore", 0, 10_000_000, issues)
  const headingCountBefore = readCompositionInteger(record, "headingCountBefore", "headingCountBefore", 0, 10_000_000, issues)
  const createdAt = readCompositionIsoDate(record, "createdAt", "createdAt", issues)
  const fingerprint = includeFingerprint ? readCompositionFingerprint(record, "fingerprint", "fingerprint", issues) : null
  const pages: VNextDocumentCompositionClosedPageV1[] = []
  if (!Array.isArray(record.pages) || record.pages.length < 1 || record.pages.length > FLOWDOC_BACKEND_COMPOSITION_MAX_CHUNK_PAGES) {
    issues.push(compositionIssue("composition-page-chunk-size-invalid", "pages", "page chunk must contain a bounded non-empty page array"))
  } else record.pages.forEach((page, index) => {
    const parsed = parseVNextDocumentCompositionClosedPageV1(page)
    if (parsed.status === "blocked") issues.push(...parsed.issues.map((item) => compositionIssue(
      item.code, `pages[${index}]${item.path.length === 0 ? "" : `.${item.path}`}`, item.message,
    )))
    else pages.push(parsed.page)
  })

  if (jobId != null && owners.sourcePin != null && jobId !== owners.sourcePin.jobId) issues.push(compositionIssue(
    "composition-page-chunk-job-mismatch", "jobId", "page chunk must belong to the pinned job",
  ))
  if (manifestFingerprint != null && owners.manifestFingerprint != null && manifestFingerprint !== owners.manifestFingerprint) {
    issues.push(compositionIssue("composition-page-chunk-manifest-mismatch", "manifestFingerprint", "page chunk must belong to the pinned manifest"))
  }
  if (jobId != null && windowRef != null && (windowRef.jobId !== jobId || windowRef.kind !== "family-window")) issues.push(compositionIssue(
    "composition-window-reference-invalid", "windowRef", "window reference must belong to the exact job and family-window kind",
  ))
  if (transitionNumber != null && transitionNumber === 0 && windowRef != null) issues.push(compositionIssue(
    "composition-initial-page-chunk-window-invalid",
    "windowRef",
    "transition-zero initialization page chunk cannot retain a family window",
  ))
  if (pageCountBefore != null && (
    (pageCountBefore === 0) !== (previousChunkFingerprint == null)
    || (pageCountBefore === 0) !== (closedPrefixBeforeFingerprint == null)
  )) issues.push(compositionIssue(
    "composition-page-chunk-prefix-start-invalid", "pageCountBefore", "empty and non-empty page prefixes require matching prior fingerprints",
  ))

  let runningPageCount = pageCountBefore ?? 0
  let runningPlacementCount = placementCountBefore ?? 0
  let runningHeadingCount = headingCountBefore ?? 0
  let prefix = closedPrefixBeforeFingerprint
  pages.forEach((page, index) => {
    if (
      page.pageIndex !== runningPageCount || page.pageNumber !== runningPageCount + 1
      || page.closedPageCountBefore !== runningPageCount
      || page.closedPlacementCountBefore !== runningPlacementCount
      || page.closedHeadingCountBefore !== runningHeadingCount
      || page.previousClosedPagePrefixFingerprint !== prefix
    ) issues.push(compositionIssue(
      "composition-page-chunk-chain-invalid", `pages[${index}]`, "page does not continue the exact retained prefix",
    ))
    runningPageCount += 1
    runningPlacementCount += page.placements.length
    runningHeadingCount += page.placements.filter((placement) => placement.heading != null).length
    prefix = page.closedPagePrefixFingerprint
  })
  if (pages.length > 0 && prefix !== closedPrefixAfterFingerprint) issues.push(compositionIssue(
    "composition-page-chunk-prefix-end-invalid", "closedPrefixAfterFingerprint", "chunk tip must equal the final closed page prefix",
  ))

  if (
    issues.length > 0 || jobId == null || transitionNumber == null || manifestFingerprint == null
    || windowRef === undefined || previousChunkFingerprint === undefined || closedPrefixBeforeFingerprint === undefined
    || closedPrefixAfterFingerprint == null || pageCountBefore == null || placementCountBefore == null
    || headingCountBefore == null || pages.length === 0 || createdAt == null
  ) return { facts: null, fingerprint, issues }
  return {
    facts: {
      source: FLOWDOC_BACKEND_COMPOSITION_PAGE_CHUNK_V1_SOURCE,
      schemaVersion: FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
      kind: "composition-closed-page-chunk",
      jobId,
      transitionNumber,
      manifestFingerprint,
      windowRef,
      previousChunkFingerprint,
      closedPrefixBeforeFingerprint,
      closedPrefixAfterFingerprint,
      pageCountBefore,
      placementCountBefore,
      headingCountBefore,
      pages,
      createdAt,
    },
    fingerprint,
    issues,
  }
}

export function finalizeFlowDocBackendCompositionPageChunkV1(context: Context): FlowDocBackendCompositionPageChunkResultV1 {
  const parsed = readPageChunkFacts(context, false)
  if (parsed.facts == null) return blockedCompositionResult("pageChunk", parsed.issues)
  const facts = cloneCompositionJson(parsed.facts)
  return readyCompositionResult("pageChunk", { ...facts, fingerprint: compositionFingerprint(facts) })
}

export function parseFlowDocBackendCompositionPageChunkV1(context: Context): FlowDocBackendCompositionPageChunkResultV1 {
  const parsed = readPageChunkFacts(context, true)
  if (parsed.facts == null || parsed.fingerprint == null) return blockedCompositionResult("pageChunk", parsed.issues)
  const finalized = finalizeFlowDocBackendCompositionPageChunkV1({ ...context, value: parsed.facts })
  if (finalized.status === "blocked") return finalized
  return finalized.pageChunk.fingerprint === parsed.fingerprint ? finalized : blockedCompositionResult("pageChunk", [
    compositionIssue("composition-page-chunk-fingerprint-mismatch", "fingerprint", "page chunk fingerprint does not match its facts"),
  ])
}

function readWork(value: unknown, issues: FlowDocBackendCompositionContractIssue[]): VNextDocumentCompositionTransitionWorkV1 | null {
  const record = readCompositionRecord(value, "work", [
    "windowCount", "familyPageCount", "closedPageCount", "placementCount",
    "bodyItemCompletionCount", "pageAdvanceCount", "cursorCommitCount",
  ], issues)
  if (record == null) return null
  const keys = Object.keys(record) as Array<keyof VNextDocumentCompositionTransitionWorkV1>
  const result = {} as VNextDocumentCompositionTransitionWorkV1
  keys.forEach((key) => {
    const count = readCompositionInteger(record, key, `work.${key}`, 0, 10_000_000, issues)
    if (count != null) result[key] = count
  })
  return keys.every((key) => typeof result[key] === "number") ? result : null
}

function readReceiptFacts(context: Context, includeFingerprint: boolean): {
  facts: FlowDocBackendCompositionTransitionReceiptInputV1 | null
  fingerprint: string | null
  issues: FlowDocBackendCompositionContractIssue[]
} {
  const owners = parseOwners(context)
  const issues = owners.issues
  const keys = [
    "source", "schemaVersion", "kind", "jobId", "transitionNumber", "transitionRequestId",
    "requestFingerprint", "attemptId", "headRevisionBefore", "headRevisionAfter",
    "manifestFingerprint", "demandBeforeFingerprint", "windowRef", "transitionFingerprint",
    "cursorBeforeFingerprint", "cursorAfterFingerprint", "openPageAfterFingerprint",
    "demandAfterFingerprint", "pageChunkRef", "previousReceiptFingerprint", "status",
    "reason", "work", "createdAt", ...(includeFingerprint ? ["fingerprint"] : []),
  ]
  const record = readCompositionRecord(context.value, "", keys, issues)
  if (record == null) return { facts: null, fingerprint: null, issues }
  readCompositionLiteral(record, "source", "source", FLOWDOC_BACKEND_COMPOSITION_TRANSITION_RECEIPT_V1_SOURCE, issues)
  readCompositionLiteral(record, "schemaVersion", "schemaVersion", FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION, issues)
  readCompositionLiteral(record, "kind", "kind", "composition-transition-receipt", issues)
  const jobId = readCompositionString(record, "jobId", "jobId", issues)
  const transitionNumber = readCompositionInteger(record, "transitionNumber", "transitionNumber", 1, 1_000_000, issues)
  const transitionRequestId = readCompositionString(record, "transitionRequestId", "transitionRequestId", issues)
  const requestFingerprint = readCompositionFingerprint(record, "requestFingerprint", "requestFingerprint", issues)
  const attemptId = readCompositionString(record, "attemptId", "attemptId", issues)
  const headRevisionBefore = readCompositionInteger(record, "headRevisionBefore", "headRevisionBefore", 0, Number.MAX_SAFE_INTEGER, issues)
  const headRevisionAfter = readCompositionInteger(record, "headRevisionAfter", "headRevisionAfter", 1, Number.MAX_SAFE_INTEGER, issues)
  const manifestFingerprint = readCompositionFingerprint(record, "manifestFingerprint", "manifestFingerprint", issues)
  const demandBeforeFingerprint = readNullableFingerprint(record, "demandBeforeFingerprint", "demandBeforeFingerprint", issues)
  const windowRef = record.windowRef === null ? null : parseFlowDocBackendCompositionContentRefV1(record.windowRef, "windowRef", issues)
  const transitionFingerprint = readCompositionFingerprint(record, "transitionFingerprint", "transitionFingerprint", issues)
  const cursorBeforeFingerprint = readCompositionFingerprint(record, "cursorBeforeFingerprint", "cursorBeforeFingerprint", issues)
  const cursorAfterFingerprint = readCompositionFingerprint(record, "cursorAfterFingerprint", "cursorAfterFingerprint", issues)
  const openPageAfterFingerprint = readNullableFingerprint(record, "openPageAfterFingerprint", "openPageAfterFingerprint", issues)
  const demandAfterFingerprint = readNullableFingerprint(record, "demandAfterFingerprint", "demandAfterFingerprint", issues)
  const pageChunkRef = record.pageChunkRef === null ? null : parseFlowDocBackendCompositionContentRefV1(record.pageChunkRef, "pageChunkRef", issues)
  const previousReceiptFingerprint = readNullableFingerprint(record, "previousReceiptFingerprint", "previousReceiptFingerprint", issues)
  const status = readCompositionEnum(record, "status", "status", ["partial", "complete"] as const, issues)
  const reason = readCompositionEnum(record, "reason", "reason", ["needs-family-window", "output-limit", "document-complete"] as const, issues)
  const work = readWork(record.work, issues)
  const createdAt = readCompositionIsoDate(record, "createdAt", "createdAt", issues)
  const fingerprint = includeFingerprint ? readCompositionFingerprint(record, "fingerprint", "fingerprint", issues) : null

  if (jobId != null && owners.sourcePin != null && jobId !== owners.sourcePin.jobId) issues.push(compositionIssue(
    "composition-receipt-job-mismatch", "jobId", "transition receipt must belong to the pinned job",
  ))
  if (manifestFingerprint != null && owners.manifestFingerprint != null && manifestFingerprint !== owners.manifestFingerprint) issues.push(compositionIssue(
    "composition-receipt-manifest-mismatch", "manifestFingerprint", "transition receipt must belong to the pinned manifest",
  ))
  if (headRevisionBefore != null && headRevisionAfter != null && headRevisionAfter !== headRevisionBefore + 1) issues.push(compositionIssue(
    "composition-receipt-revision-invalid", "headRevisionAfter", "receipt must describe one compare-and-swap head commit",
  ))
  if (transitionNumber != null && (transitionNumber === 1) !== (previousReceiptFingerprint == null)) issues.push(compositionIssue(
    "composition-receipt-prefix-invalid", "previousReceiptFingerprint", "first and later receipts require exact previous-tip identity",
  ))
  if ((demandBeforeFingerprint == null) !== (windowRef == null)) issues.push(compositionIssue(
    "composition-receipt-window-demand-invalid", "windowRef", "family window and demand-before must both exist or both be null",
  ))
  if (jobId != null && windowRef != null && (windowRef.jobId !== jobId || windowRef.kind !== "family-window")) issues.push(compositionIssue(
    "composition-receipt-window-reference-invalid", "windowRef", "window reference must belong to the exact job",
  ))
  if (jobId != null && pageChunkRef != null && (pageChunkRef.jobId !== jobId || pageChunkRef.kind !== "closed-page-chunk")) issues.push(compositionIssue(
    "composition-receipt-chunk-reference-invalid", "pageChunkRef", "page chunk reference must belong to the exact job",
  ))
  if (work != null && (work.closedPageCount === 0) !== (pageChunkRef == null)) issues.push(compositionIssue(
    "composition-receipt-chunk-work-invalid", "pageChunkRef", "page chunk presence must match exact closed-page work",
  ))
  if (status != null && reason != null) {
    if ((status === "complete") !== (reason === "document-complete")) issues.push(compositionIssue(
      "composition-receipt-result-invalid", "status", "complete status and document-complete reason must occur together",
    ))
    if ((reason === "needs-family-window") !== (demandAfterFingerprint != null)) issues.push(compositionIssue(
      "composition-receipt-demand-after-invalid", "demandAfterFingerprint", "only needs-family-window may retain demand-after",
    ))
  }

  if (
    issues.length > 0 || jobId == null || transitionNumber == null || transitionRequestId == null
    || requestFingerprint == null || attemptId == null || headRevisionBefore == null || headRevisionAfter == null
    || manifestFingerprint == null || demandBeforeFingerprint === undefined || windowRef === undefined
    || transitionFingerprint == null || cursorBeforeFingerprint == null || cursorAfterFingerprint == null
    || openPageAfterFingerprint === undefined || demandAfterFingerprint === undefined || pageChunkRef === undefined
    || previousReceiptFingerprint === undefined || status == null || reason == null || work == null || createdAt == null
  ) return { facts: null, fingerprint, issues }
  return {
    facts: {
      source: FLOWDOC_BACKEND_COMPOSITION_TRANSITION_RECEIPT_V1_SOURCE,
      schemaVersion: FLOWDOC_BACKEND_COMPOSITION_SCHEMA_VERSION,
      kind: "composition-transition-receipt",
      jobId,
      transitionNumber,
      transitionRequestId,
      requestFingerprint,
      attemptId,
      headRevisionBefore,
      headRevisionAfter,
      manifestFingerprint,
      demandBeforeFingerprint,
      windowRef,
      transitionFingerprint,
      cursorBeforeFingerprint,
      cursorAfterFingerprint,
      openPageAfterFingerprint,
      demandAfterFingerprint,
      pageChunkRef,
      previousReceiptFingerprint,
      status,
      reason,
      work,
      createdAt,
    },
    fingerprint,
    issues,
  }
}

export function finalizeFlowDocBackendCompositionTransitionReceiptV1(context: Context): FlowDocBackendCompositionTransitionReceiptResultV1 {
  const parsed = readReceiptFacts(context, false)
  if (parsed.facts == null) return blockedCompositionResult("receipt", parsed.issues)
  const facts = cloneCompositionJson(parsed.facts)
  return readyCompositionResult("receipt", { ...facts, fingerprint: compositionFingerprint(facts) })
}

export function parseFlowDocBackendCompositionTransitionReceiptV1(context: Context): FlowDocBackendCompositionTransitionReceiptResultV1 {
  const parsed = readReceiptFacts(context, true)
  if (parsed.facts == null || parsed.fingerprint == null) return blockedCompositionResult("receipt", parsed.issues)
  const finalized = finalizeFlowDocBackendCompositionTransitionReceiptV1({ ...context, value: parsed.facts })
  if (finalized.status === "blocked") return finalized
  return finalized.receipt.fingerprint === parsed.fingerprint ? finalized : blockedCompositionResult("receipt", [
    compositionIssue("composition-receipt-fingerprint-mismatch", "fingerprint", "transition receipt fingerprint does not match its facts"),
  ])
}
