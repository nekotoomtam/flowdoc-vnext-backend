import type { FlowDocBackendPdfExportLifecycleHeadV1 } from "./pdfExportLifecycle.js"
import type { FlowDocBackendPdfExportOperationIssueV1 } from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE =
  "flowdoc-backend-pdf-export-due-work" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_MAX_COUNT = 64

export type FlowDocBackendPdfExportDueWorkLaneV1 =
  | "claim-ready"
  | "claim-expired"
  | "terminal-finalization"

export interface FlowDocBackendPdfExportDueWorkCursorV1 {
  dueAt: string
  operationId: string
}

export interface FlowDocBackendPdfExportDueWorkEntryV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE
  operationId: string
  scope: {
    tenantId: string
    principalId: string
  }
  dueAt: string
  lane: FlowDocBackendPdfExportDueWorkLaneV1
  headRevision: number
  lifecycleFingerprint: string
  head: FlowDocBackendPdfExportLifecycleHeadV1
}

export type FlowDocBackendPdfExportDueWorkListResultV1 =
  | {
      status: "ready"
      observedAt: string
      entries: FlowDocBackendPdfExportDueWorkEntryV1[]
      nextCursor: FlowDocBackendPdfExportDueWorkCursorV1 | null
      issues: []
    }
  | {
      status: "invalid" | "storage-unavailable"
      observedAt: string | null
      entries: []
      nextCursor: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportDueWorkRepositoryV1 {
  dueWorkSource: typeof FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_SOURCE
  listDueWork(input: {
    observedAt: string
    maxCount: number
    cursor: FlowDocBackendPdfExportDueWorkCursorV1 | null
  }): Promise<FlowDocBackendPdfExportDueWorkListResultV1>
}
