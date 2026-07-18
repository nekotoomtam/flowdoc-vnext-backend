import {
  reconcileFlowDocBackendPdfExportResumableOrphanContentV1,
  type FlowDocBackendPdfExportArtifactPersistenceRepositoryV1,
} from "./pdfExportArtifactPersistence.js"
import type { FlowDocBackendPdfExportResumableContentAddressedStoreV1 } from "./pdfExportContentAddressedStore.js"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ORPHAN_MAINTENANCE_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-orphan-maintenance" as const

export interface FlowDocBackendPdfExportLocalOrphanMaintenanceReportV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ORPHAN_MAINTENANCE_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-local-orphan-maintenance-report"
  status: "deferred" | "completed" | "blocked"
  observedAt: string
  inputCursorPresent: boolean
  nextCursorPresent: boolean
  scannedCount: number
  candidateCount: number
  referencedCount: number
  deletedCount: number
  retainedCount: number
  nextRunAt: string
  issues: FlowDocBackendPdfExportOperationIssueV1[]
  contracts: {
    onePagePerInvocation: true
    dueWorkRunsFirst: true
    cursorRetainedAcrossCycles: true
    automaticTimer: false
    productionBinding: false
  }
  fingerprint: string
}

export interface FlowDocBackendPdfExportLocalOrphanMaintenanceV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ORPHAN_MAINTENANCE_V1_SOURCE
    automaticTimer: false
    onePagePerInvocation: true
    productionBinding: false
  }
  runIfDue(input: { observedAt: string }): Promise<FlowDocBackendPdfExportLocalOrphanMaintenanceReportV1>
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function bounded(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function contracts() {
  return {
    onePagePerInvocation: true as const,
    dueWorkRunsFirst: true as const,
    cursorRetainedAcrossCycles: true as const,
    automaticTimer: false as const,
    productionBinding: false as const,
  }
}

function finalize(
  facts: Omit<FlowDocBackendPdfExportLocalOrphanMaintenanceReportV1, "fingerprint">,
): FlowDocBackendPdfExportLocalOrphanMaintenanceReportV1 {
  const cloned = cloneFlowDocBackendPdfExportJsonV1(facts)
  return { ...cloned, fingerprint: flowDocBackendPdfExportFingerprintV1(cloned) }
}

export function createFlowDocBackendPdfExportLocalOrphanMaintenanceV1(input: {
  createdAt: string
  intervalMs: number
  unavailableBackoffMs: number
  gracePeriodMs: number
  maxScanCount: number
  maxDeleteCount: number
  contentStore: FlowDocBackendPdfExportResumableContentAddressedStoreV1
  persistenceRepository: FlowDocBackendPdfExportArtifactPersistenceRepositoryV1
}): FlowDocBackendPdfExportLocalOrphanMaintenanceV1 {
  if (!exactIso(input.createdAt)) throw new Error("local orphan maintenance requires an exact creation time")
  const intervalMs = bounded(input.intervalMs, 1_000, 86_400_000, "intervalMs")
  const unavailableBackoffMs = bounded(input.unavailableBackoffMs, 100, 60_000, "unavailableBackoffMs")
  const gracePeriodMs = bounded(input.gracePeriodMs, 60_000, 7 * 86_400_000, "gracePeriodMs")
  const maxScanCount = bounded(input.maxScanCount, 1, 10_000, "maxScanCount")
  const maxDeleteCount = bounded(input.maxDeleteCount, 1, maxScanCount, "maxDeleteCount")
  let cursor: string | null = null
  let nextRunAt = input.createdAt

  return {
    facts: {
      source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ORPHAN_MAINTENANCE_V1_SOURCE,
      automaticTimer: false,
      onePagePerInvocation: true,
      productionBinding: false,
    },
    async runIfDue({ observedAt }) {
      if (!exactIso(observedAt)) throw new Error("local orphan maintenance clock must be an exact ISO time")
      const inputCursor = cursor
      if (Date.parse(observedAt) < Date.parse(nextRunAt)) return finalize({
        source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ORPHAN_MAINTENANCE_V1_SOURCE,
        contractVersion: 1,
        kind: "pdf-export-local-orphan-maintenance-report",
        status: "deferred",
        observedAt,
        inputCursorPresent: inputCursor != null,
        nextCursorPresent: cursor != null,
        scannedCount: 0,
        candidateCount: 0,
        referencedCount: 0,
        deletedCount: 0,
        retainedCount: 0,
        nextRunAt,
        issues: [],
        contracts: contracts(),
      })
      const reconciled = await reconcileFlowDocBackendPdfExportResumableOrphanContentV1({
        now: observedAt,
        gracePeriodMs,
        maxScanCount,
        maxDeleteCount,
        cursor: inputCursor,
        contentStore: input.contentStore,
        persistenceRepository: input.persistenceRepository,
      })
      if (reconciled.status === "completed") {
        cursor = reconciled.nextCursor
        nextRunAt = cursor == null
          ? new Date(Date.parse(observedAt) + intervalMs).toISOString()
          : observedAt
      } else {
        nextRunAt = new Date(Date.parse(observedAt) + unavailableBackoffMs).toISOString()
      }
      return finalize({
        source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_ORPHAN_MAINTENANCE_V1_SOURCE,
        contractVersion: 1,
        kind: "pdf-export-local-orphan-maintenance-report",
        status: reconciled.status,
        observedAt,
        inputCursorPresent: inputCursor != null,
        nextCursorPresent: cursor != null,
        scannedCount: reconciled.scannedCount,
        candidateCount: reconciled.candidateCount,
        referencedCount: reconciled.referencedCount,
        deletedCount: reconciled.deletedStorageKeys.length,
        retainedCount: reconciled.retainedStorageKeys.length,
        nextRunAt,
        issues: reconciled.issues,
        contracts: contracts(),
      })
    },
  }
}
