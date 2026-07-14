import {
  parseVNextCompositionFragmentWindowV1,
  type VNextDocumentCompositionClosedPageV1,
} from "@flowdoc/vnext-core"
import {
  compositionIssue,
  exactCompositionValue,
  type FlowDocBackendCompositionContractIssue,
} from "./compositionSchedulerContractSupport.js"
import type { FlowDocBackendCompositionJobHeadV1 } from "./compositionSchedulerJobHead.js"
import type {
  FlowDocBackendCompositionRepositoryContextV1,
  FlowDocBackendCompositionRepositoryV1,
} from "./compositionSchedulerRepository.js"
import {
  parseFlowDocBackendCompositionPageChunkV1,
  parseFlowDocBackendCompositionTransitionReceiptV1,
  type FlowDocBackendCompositionPageChunkV1,
  type FlowDocBackendCompositionTransitionReceiptV1,
} from "./compositionSchedulerTransitionRecords.js"

export interface FlowDocBackendCompositionLoadedChainV1 {
  pages: VNextDocumentCompositionClosedPageV1[]
  pageChunks: FlowDocBackendCompositionPageChunkV1[]
  receipts: FlowDocBackendCompositionTransitionReceiptV1[]
}

export type FlowDocBackendCompositionLoadedChainResultV1 =
  | { status: "ready"; chain: FlowDocBackendCompositionLoadedChainV1; issues: [] }
  | { status: "blocked"; chain: null; issues: FlowDocBackendCompositionContractIssue[] }

function blocked(issues: FlowDocBackendCompositionContractIssue[]): FlowDocBackendCompositionLoadedChainResultV1 {
  return { status: "blocked", chain: null, issues }
}

function issue(code: string, path: string, message: string): FlowDocBackendCompositionContractIssue {
  return compositionIssue(code, path, message)
}

async function loadPageChunks(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  context: FlowDocBackendCompositionRepositoryContextV1
  head: FlowDocBackendCompositionJobHeadV1
}): Promise<{ chunks: FlowDocBackendCompositionPageChunkV1[]; issues: FlowDocBackendCompositionContractIssue[] }> {
  const reverse: FlowDocBackendCompositionPageChunkV1[] = []
  const issues: FlowDocBackendCompositionContractIssue[] = []
  let fingerprint = input.head.chain.closedPageChunkTipFingerprint
  const seen = new Set<string>()
  while (fingerprint != null) {
    if (seen.has(fingerprint) || reverse.length > input.head.chain.pageCount) {
      issues.push(issue("composition-page-chunk-cycle", "chain", "page chunk chain is cyclic or longer than its page count"))
      break
    }
    seen.add(fingerprint)
    const read = await input.repository.readImmutableByFingerprint({
      jobId: input.head.jobId,
      kind: "closed-page-chunk",
      recordFingerprint: fingerprint,
    })
    if (read.status !== "found") {
      issues.push(...read.issues)
      break
    }
    const parsed = parseFlowDocBackendCompositionPageChunkV1({
      value: read.value,
      sourcePin: input.context.sourcePin,
      manifest: input.context.manifest,
    })
    if (parsed.status === "blocked") {
      issues.push(...parsed.issues)
      break
    }
    if (parsed.pageChunk.fingerprint !== fingerprint || read.ref.recordFingerprint !== fingerprint) {
      issues.push(issue("composition-page-chunk-tip-mismatch", "chain", "page chunk does not match the requested chain fingerprint"))
      break
    }
    reverse.push(parsed.pageChunk)
    fingerprint = parsed.pageChunk.previousChunkFingerprint
  }
  const chunks = reverse.reverse()
  let previousChunk: string | null = null
  let prefix: string | null = null
  let pageCount = 0
  let placementCount = 0
  let headingCount = 0
  chunks.forEach((chunk, index) => {
    if (
      chunk.previousChunkFingerprint !== previousChunk
      || chunk.closedPrefixBeforeFingerprint !== prefix
      || chunk.pageCountBefore !== pageCount
      || chunk.placementCountBefore !== placementCount
      || chunk.headingCountBefore !== headingCount
    ) issues.push(issue(
      "composition-page-chunk-cross-chain-invalid",
      `pageChunks[${index}]`,
      "page chunk does not continue the exact prior retained chunk and core prefix",
    ))
    previousChunk = chunk.fingerprint
    prefix = chunk.closedPrefixAfterFingerprint
    pageCount += chunk.pages.length
    placementCount += chunk.pages.reduce((count, page) => count + page.placements.length, 0)
    headingCount += chunk.pages.reduce(
      (count, page) => count + page.placements.filter((placement) => placement.heading != null).length,
      0,
    )
  })
  if (
    previousChunk !== input.head.chain.closedPageChunkTipFingerprint
    || prefix !== input.head.chain.closedPagePrefixFingerprint
    || pageCount !== input.head.chain.pageCount
    || placementCount !== input.head.chain.placementCount
    || headingCount !== input.head.chain.headingCount
  ) issues.push(issue(
    "composition-page-chunk-head-mismatch",
    "jobHead.chain",
    "reachable page chunks must exactly equal the committed head chain and counts",
  ))
  return { chunks, issues }
}

async function loadReceipts(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  context: FlowDocBackendCompositionRepositoryContextV1
  head: FlowDocBackendCompositionJobHeadV1
  chunks: FlowDocBackendCompositionPageChunkV1[]
}): Promise<{ receipts: FlowDocBackendCompositionTransitionReceiptV1[]; issues: FlowDocBackendCompositionContractIssue[] }> {
  const reverse: FlowDocBackendCompositionTransitionReceiptV1[] = []
  const issues: FlowDocBackendCompositionContractIssue[] = []
  let fingerprint = input.head.chain.transitionReceiptTipFingerprint
  const seen = new Set<string>()
  while (fingerprint != null) {
    if (seen.has(fingerprint) || reverse.length >= input.head.transitionNumber + 1) {
      issues.push(issue("composition-receipt-chain-cycle", "chain", "transition receipt chain is cyclic or longer than transition count"))
      break
    }
    seen.add(fingerprint)
    const read = await input.repository.readImmutableByFingerprint({
      jobId: input.head.jobId,
      kind: "transition-receipt",
      recordFingerprint: fingerprint,
    })
    if (read.status !== "found") {
      issues.push(...read.issues)
      break
    }
    const parsed = parseFlowDocBackendCompositionTransitionReceiptV1({
      value: read.value,
      sourcePin: input.context.sourcePin,
      manifest: input.context.manifest,
    })
    if (parsed.status === "blocked") {
      issues.push(...parsed.issues)
      break
    }
    if (parsed.receipt.fingerprint !== fingerprint || read.ref.recordFingerprint !== fingerprint) {
      issues.push(issue("composition-receipt-tip-mismatch", "chain", "receipt does not match the requested chain fingerprint"))
      break
    }
    reverse.push(parsed.receipt)
    fingerprint = parsed.receipt.previousReceiptFingerprint
  }
  const receipts = reverse.reverse()
  const chunksByFingerprint = new Map(input.chunks.map((chunk) => [chunk.fingerprint, chunk]))
  const referencedChunks = new Set<string>()
  let previous: string | null = null
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index]
    if (receipt.transitionNumber !== index + 1 || receipt.previousReceiptFingerprint !== previous) issues.push(issue(
      "composition-receipt-order-invalid",
      `receipts[${index}]`,
      "receipt chain must be contiguous from transition one",
    ))
    previous = receipt.fingerprint
    if (receipt.windowRef != null) {
      const windowRead = await input.repository.readImmutable({
        jobId: receipt.windowRef.jobId,
        recordId: receipt.windowRef.recordId,
      })
      if (windowRead.status !== "found" || !exactCompositionValue(windowRead.ref, receipt.windowRef)) {
        issues.push(issue("composition-receipt-window-missing", `receipts[${index}].windowRef`, "receipt window ref must resolve exactly"))
      } else {
        const parsedWindow = parseVNextCompositionFragmentWindowV1(windowRead.value)
        if (parsedWindow.status === "blocked" || parsedWindow.window.fingerprint !== receipt.windowRef.recordFingerprint) issues.push(issue(
          "composition-receipt-window-invalid",
          `receipts[${index}].windowRef`,
          "receipt window must retain one valid exact common family window",
        ))
      }
    }
    if (receipt.pageChunkRef != null) {
      const chunk = chunksByFingerprint.get(receipt.pageChunkRef.recordFingerprint)
      const chunkRead = await input.repository.readImmutable({
        jobId: receipt.pageChunkRef.jobId,
        recordId: receipt.pageChunkRef.recordId,
      })
      if (
        chunk == null || chunk.transitionNumber !== receipt.transitionNumber
        || chunkRead.status !== "found" || !exactCompositionValue(chunkRead.ref, receipt.pageChunkRef)
      ) issues.push(issue(
        "composition-receipt-page-chunk-invalid",
        `receipts[${index}].pageChunkRef`,
        "receipt page chunk must resolve to the exact reachable transition chunk",
      ))
      else referencedChunks.add(chunk.fingerprint)
    }
  }
  const transitionChunks = input.chunks.filter((chunk) => chunk.transitionNumber > 0)
  const terminalReceiptMatches = input.head.transitionNumber === 0
    ? receipts.length === 0 && input.head.chain.transitionReceiptTipFingerprint == null
    : receipts.at(-1)?.cursorAfterFingerprint === input.head.cursor.fingerprint
  if (
    receipts.length !== input.head.transitionNumber
    || previous !== input.head.chain.transitionReceiptTipFingerprint
    || !terminalReceiptMatches
    || transitionChunks.some((chunk) => !referencedChunks.has(chunk.fingerprint))
  ) issues.push(issue(
    "composition-receipt-head-mismatch",
    "jobHead.chain",
    "reachable receipts and referenced chunks must exactly cover the committed transition head",
  ))
  return { receipts, issues }
}

export async function loadFlowDocBackendCompositionChainV1(input: {
  repository: FlowDocBackendCompositionRepositoryV1
  context: FlowDocBackendCompositionRepositoryContextV1
  head: FlowDocBackendCompositionJobHeadV1
}): Promise<FlowDocBackendCompositionLoadedChainResultV1> {
  const pages = await loadPageChunks(input)
  const receipts = await loadReceipts({ ...input, chunks: pages.chunks })
  const issues = [...pages.issues, ...receipts.issues]
  return issues.length > 0
    ? blocked(issues)
    : {
        status: "ready",
        chain: {
          pages: pages.chunks.flatMap((chunk) => chunk.pages),
          pageChunks: pages.chunks,
          receipts: receipts.receipts,
        },
        issues: [],
      }
}
