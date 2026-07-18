import { createHash } from "node:crypto"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_MAX_COUNT,
  type FlowDocBackendPdfExportDueWorkEntryV1,
  type FlowDocBackendPdfExportDueWorkRepositoryV1,
} from "./pdfExportDueWork.js"
import type { FlowDocBackendPdfExportLifecycleRepositoryV1 } from "./pdfExportLifecycleRepository.js"
import type {
  FlowDocBackendPdfExportLocalOrphanMaintenanceReportV1,
  FlowDocBackendPdfExportLocalOrphanMaintenanceV1,
} from "./pdfExportLocalOrphanMaintenance.js"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_V1_SOURCE,
  runFlowDocBackendPdfExportLocalDueWorkEntryV1,
  type FlowDocBackendPdfExportLocalWorkerEntryResultV1,
  type FlowDocBackendPdfExportLocalWorkerEntryStatusV1,
  type FlowDocBackendPdfExportLocalWorkerExecutorV1,
} from "./pdfExportLocalWorker.js"
import type { FlowDocBackendPdfExportObservabilityRepositoryV1 } from "./pdfExportObservability.js"
import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"
import type { FlowDocBackendPdfExportOperationRepositoryV1 } from "./pdfExportOperationRepository.js"
import {
  createFlowDocBackendPdfExportShutdownDrainGateV1,
  type FlowDocBackendPdfExportShutdownDrainResultV1,
  type FlowDocBackendPdfExportShutdownDrainStateV1,
} from "./pdfExportShutdownDrain.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-worker-host" as const

const ENTRY_STATUSES: FlowDocBackendPdfExportLocalWorkerEntryStatusV1[] = [
  "completed",
  "terminal-replay",
  "terminated",
  "released",
  "attempts-exhausted",
  "deadline-stopped",
  "deferred",
  "ownership-lost",
  "not-found",
  "blocked",
  "storage-unavailable",
  "execution-interrupted",
]

export type FlowDocBackendPdfExportLocalWorkerStatusCountsV1 = Record<
  FlowDocBackendPdfExportLocalWorkerEntryStatusV1,
  number
>

export interface FlowDocBackendPdfExportLocalWorkerCycleReportV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-local-worker-cycle-report"
  hostId: string
  workerId: string
  runId: string
  cycleNumber: number
  observedAt: string
  status: "completed" | "blocked" | "storage-unavailable" | "draining"
  listedCount: number
  invokedCount: number
  nextCursorPresent: boolean
  recommendedDelayMs: number
  counts: FlowDocBackendPdfExportLocalWorkerStatusCountsV1
  results: FlowDocBackendPdfExportLocalWorkerEntryResultV1[]
  maintenance: FlowDocBackendPdfExportLocalOrphanMaintenanceReportV1 | null
  issues: FlowDocBackendPdfExportOperationIssueV1[]
  contracts: ReturnType<typeof hostContracts>
  fingerprint: string
}

export interface FlowDocBackendPdfExportLocalWorkerRunReportV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-local-worker-run-report"
  hostId: string
  workerId: string
  runId: string
  startedAt: string
  stoppedAt: string
  cycleCount: number
  listedCount: number
  invokedCount: number
  maintenanceRunCount: number
  maintenanceBlockedCount: number
  blockedCycleCount: number
  storageUnavailableCycleCount: number
  counts: FlowDocBackendPdfExportLocalWorkerStatusCountsV1
  drain: FlowDocBackendPdfExportShutdownDrainStateV1
  contracts: ReturnType<typeof hostContracts>
  fingerprint: string
}

export interface FlowDocBackendPdfExportLocalWorkerHostOptionsV1 {
  hostId: string
  workerId: string
  runId: string
  createdAt: string
  maxBatchCount?: number
  claimDurationMs?: number
  retryDelayMs?: number
  pollIntervalMs?: number
  unavailableBackoffMs?: number
  dueWorkRepository: FlowDocBackendPdfExportDueWorkRepositoryV1
  operationRepository: FlowDocBackendPdfExportOperationRepositoryV1
  lifecycleRepository: FlowDocBackendPdfExportLifecycleRepositoryV1
  observabilityRepository: FlowDocBackendPdfExportObservabilityRepositoryV1
  execute: FlowDocBackendPdfExportLocalWorkerExecutorV1
  maintenance?: FlowDocBackendPdfExportLocalOrphanMaintenanceV1
  now?(): string
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export interface FlowDocBackendPdfExportLocalWorkerHostV1 {
  facts: {
    source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE
    runtimeProfile: "local-integration"
    startMode: "explicit-dedicated-host"
    automaticStartOnImport: false
    concurrency: 1
    freshScanEachCycle: true
    externalQueue: false
    defaultServerMounted: false
    productionBinding: false
  }
  runCycle(): Promise<FlowDocBackendPdfExportLocalWorkerCycleReportV1>
  start(): Promise<FlowDocBackendPdfExportLocalWorkerRunReportV1>
  beginDrain(): FlowDocBackendPdfExportShutdownDrainResultV1
  forceStop(): Promise<FlowDocBackendPdfExportShutdownDrainResultV1>
  readDrain(): FlowDocBackendPdfExportShutdownDrainStateV1
}

interface ActiveReservationV1 {
  reservationId: string
  entry: FlowDocBackendPdfExportDueWorkEntryV1
  claimToken: string | null
}

function hostContracts() {
  return {
    runtimeProfile: "local-integration" as const,
    dedicatedHost: true as const,
    explicitStart: true as const,
    boundedPoll: true as const,
    boundedUnavailableBackoff: true as const,
    freshScanEachCycle: true as const,
    gracefulDrain: true as const,
    forceShutdownTransition: true as const,
    concurrency: 1 as const,
    externalQueue: false as const,
    defaultServerMounted: false as const,
    backendRoute: false as const,
    productionBinding: false as const,
  }
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function emptyCounts(): FlowDocBackendPdfExportLocalWorkerStatusCountsV1 {
  return Object.fromEntries(ENTRY_STATUSES.map((status) => [status, 0])) as
    FlowDocBackendPdfExportLocalWorkerStatusCountsV1
}

function addCounts(
  target: FlowDocBackendPdfExportLocalWorkerStatusCountsV1,
  source: FlowDocBackendPdfExportLocalWorkerStatusCountsV1,
): void {
  ENTRY_STATUSES.forEach((status) => {
    target[status] += source[status]
  })
}

function hashId(kind: string, facts: object): string {
  const digest = createHash("sha256").update(JSON.stringify(facts)).digest("hex")
  return `pdf-local-${kind}:${digest}`
}

function finalizeCycle(
  facts: Omit<FlowDocBackendPdfExportLocalWorkerCycleReportV1, "fingerprint">,
): FlowDocBackendPdfExportLocalWorkerCycleReportV1 {
  const cloned = cloneFlowDocBackendPdfExportJsonV1(facts)
  return { ...cloned, fingerprint: flowDocBackendPdfExportFingerprintV1(cloned) }
}

function finalizeRun(
  facts: Omit<FlowDocBackendPdfExportLocalWorkerRunReportV1, "fingerprint">,
): FlowDocBackendPdfExportLocalWorkerRunReportV1 {
  const cloned = cloneFlowDocBackendPdfExportJsonV1(facts)
  return { ...cloned, fingerprint: flowDocBackendPdfExportFingerprintV1(cloned) }
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || milliseconds === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds)
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    signal.addEventListener("abort", finish, { once: true })
  })
}

export function createFlowDocBackendPdfExportLocalWorkerHostV1(
  input: FlowDocBackendPdfExportLocalWorkerHostOptionsV1,
): FlowDocBackendPdfExportLocalWorkerHostV1 {
  if (
    !isFlowDocBackendPdfExportBoundedStringV1(input.hostId)
    || !isFlowDocBackendPdfExportBoundedStringV1(input.workerId)
    || !isFlowDocBackendPdfExportBoundedStringV1(input.runId)
    || !exactIso(input.createdAt)
  ) throw new Error("local PDF worker host requires bounded identities and exact creation time")
  const maxBatchCount = boundedInteger(input.maxBatchCount ?? 8, 1, FLOWDOC_BACKEND_PDF_EXPORT_DUE_WORK_V1_MAX_COUNT, "maxBatchCount")
  const claimDurationMs = boundedInteger(input.claimDurationMs ?? 30_000, 1_000, 300_000, "claimDurationMs")
  const retryDelayMs = boundedInteger(input.retryDelayMs ?? 1_000, 100, 60_000, "retryDelayMs")
  const pollIntervalMs = boundedInteger(input.pollIntervalMs ?? 1_000, 50, 60_000, "pollIntervalMs")
  const unavailableBackoffMs = boundedInteger(input.unavailableBackoffMs ?? 2_000, 100, 60_000, "unavailableBackoffMs")
  const sourceNow = input.now ?? (() => new Date().toISOString())
  const sleep = input.sleep ?? defaultSleep
  let lastNowMs = Date.parse(input.createdAt)
  const now = () => {
    const value = sourceNow()
    if (!exactIso(value)) throw new Error("local PDF worker clock must return an exact ISO time")
    lastNowMs = Math.max(lastNowMs, Date.parse(value))
    return new Date(lastNowMs).toISOString()
  }
  const gate = createFlowDocBackendPdfExportShutdownDrainGateV1({
    gateId: `drain:${input.hostId}`,
    createdAt: input.createdAt,
  })
  let cycleNumber = 0
  let cycleRunning = false
  let startPromise: Promise<FlowDocBackendPdfExportLocalWorkerRunReportV1> | null = null
  let waitController: AbortController | null = null
  let active: ActiveReservationV1 | null = null

  const runCycle = async (): Promise<FlowDocBackendPdfExportLocalWorkerCycleReportV1> => {
    if (cycleRunning) throw new Error("local PDF worker permits only one active cycle")
    cycleRunning = true
    cycleNumber += 1
    const currentCycle = cycleNumber
    const observedAt = now()
    const counts = emptyCounts()
    const results: FlowDocBackendPdfExportLocalWorkerEntryResultV1[] = []
    try {
      if (gate.read().status !== "accepting") return finalizeCycle({
        source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE,
        contractVersion: 1,
        kind: "pdf-export-local-worker-cycle-report",
        hostId: input.hostId,
        workerId: input.workerId,
        runId: input.runId,
        cycleNumber: currentCycle,
        observedAt,
        status: "draining",
        listedCount: 0,
        invokedCount: 0,
        nextCursorPresent: false,
        recommendedDelayMs: 0,
        counts,
        results,
        maintenance: null,
        issues: [],
        contracts: hostContracts(),
      })
      const due = await input.dueWorkRepository.listDueWork({
        observedAt,
        maxCount: maxBatchCount,
        cursor: null,
      })
      if (due.status !== "ready") return finalizeCycle({
        source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE,
        contractVersion: 1,
        kind: "pdf-export-local-worker-cycle-report",
        hostId: input.hostId,
        workerId: input.workerId,
        runId: input.runId,
        cycleNumber: currentCycle,
        observedAt,
        status: due.status === "storage-unavailable" ? "storage-unavailable" : "blocked",
        listedCount: 0,
        invokedCount: 0,
        nextCursorPresent: false,
        recommendedDelayMs: unavailableBackoffMs,
        counts,
        results,
        maintenance: null,
        issues: due.issues,
        contracts: hostContracts(),
      })
      for (const [entryIndex, entry] of due.entries.entries()) {
        const reservationId = hashId("reservation", {
          hostId: input.hostId,
          runId: input.runId,
          cycleNumber: currentCycle,
          entryIndex,
          operationId: entry.operationId,
          lifecycleFingerprint: entry.lifecycleFingerprint,
        })
        const reserved = gate.reserveClaim({ reservationId, reservedAt: now() })
        if (reserved.status !== "reserved") break
        active = { reservationId, entry, claimToken: null }
        try {
          const entryResult = await runFlowDocBackendPdfExportLocalDueWorkEntryV1({
            runId: input.runId,
            workerId: input.workerId,
            entry,
            claimDurationMs,
            retryDelayMs,
            operationRepository: input.operationRepository,
            lifecycleRepository: input.lifecycleRepository,
            observabilityRepository: input.observabilityRepository,
            execute: input.execute,
            now,
            onClaimed(claimed) {
              if (active?.reservationId === reservationId) active.claimToken = claimed.claimToken
            },
          })
          results.push(entryResult)
          counts[entryResult.status] += 1
        } finally {
          active = null
          gate.releaseClaim({ reservationId, releasedAt: now() })
        }
      }
      const maintenance = gate.read().status === "accepting" && input.maintenance != null
        ? await input.maintenance.runIfDue({ observedAt: now() })
        : null
      return finalizeCycle({
        source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE,
        contractVersion: 1,
        kind: "pdf-export-local-worker-cycle-report",
        hostId: input.hostId,
        workerId: input.workerId,
        runId: input.runId,
        cycleNumber: currentCycle,
        observedAt,
        status: gate.read().status !== "accepting"
          ? "draining"
          : maintenance?.status === "blocked"
            ? "storage-unavailable"
            : "completed",
        listedCount: due.entries.length,
        invokedCount: results.length,
        nextCursorPresent: due.nextCursor != null,
        recommendedDelayMs: gate.read().status !== "accepting"
          ? 0
          : maintenance?.status === "blocked"
            ? unavailableBackoffMs
            : pollIntervalMs,
        counts,
        results,
        maintenance,
        issues: maintenance?.issues ?? [],
        contracts: hostContracts(),
      })
    } finally {
      cycleRunning = false
    }
  }

  const beginDrain = () => {
    const drained = gate.beginDrain({ requestedAt: now() })
    waitController?.abort()
    return drained
  }

  const forceLifecycleStop = async (reservation: ActiveReservationV1): Promise<void> => {
    const terminal = await input.observabilityRepository.readTerminalWorkflow({
      ...reservation.entry.scope,
      operationId: reservation.entry.operationId,
    })
    if (terminal.status === "found") return
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await input.lifecycleRepository.readLifecycle({
        ...reservation.entry.scope,
        operationId: reservation.entry.operationId,
      })
      if (current.status !== "found" || current.head.status === "stopped") return
      const stoppedAt = now()
      const stopped = await input.lifecycleRepository.applyLifecycleTransition({
        transitionId: hashId("force-shutdown", {
          hostId: input.hostId,
          runId: input.runId,
          operationId: reservation.entry.operationId,
          headRevision: current.head.headRevision,
        }),
        ...reservation.entry.scope,
        operationId: reservation.entry.operationId,
        expectedHeadRevision: current.head.headRevision,
        transitionAt: stoppedAt,
        kind: "force-shutdown",
      })
      if (stopped.status === "applied" || stopped.status === "idempotent-replay") return
      if (stopped.status !== "stale") return
    }
  }

  const forceStop = async () => {
    const reservation = active == null ? null : { ...active }
    const stopped = gate.forceStop({ stoppedAt: now() })
    waitController?.abort()
    if (reservation != null) await forceLifecycleStop(reservation)
    return stopped
  }

  const start = (): Promise<FlowDocBackendPdfExportLocalWorkerRunReportV1> => {
    if (startPromise != null) return startPromise
    const startedAt = now()
    startPromise = (async () => {
      const counts = emptyCounts()
      let listedCount = 0
      let invokedCount = 0
      let maintenanceRunCount = 0
      let maintenanceBlockedCount = 0
      let blockedCycleCount = 0
      let storageUnavailableCycleCount = 0
      while (gate.read().status === "accepting") {
        const cycle = await runCycle()
        listedCount += cycle.listedCount
        invokedCount += cycle.invokedCount
        addCounts(counts, cycle.counts)
        if (cycle.maintenance != null && cycle.maintenance.status !== "deferred") maintenanceRunCount += 1
        if (cycle.maintenance?.status === "blocked") maintenanceBlockedCount += 1
        if (cycle.status === "blocked") blockedCycleCount += 1
        if (cycle.status === "storage-unavailable") storageUnavailableCycleCount += 1
        if (gate.read().status !== "accepting") break
        waitController = new AbortController()
        await sleep(cycle.recommendedDelayMs, waitController.signal)
        waitController = null
      }
      if (gate.read().status === "draining" && gate.read().activeReservationCount === 0) beginDrain()
      return finalizeRun({
        source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE,
        contractVersion: 1,
        kind: "pdf-export-local-worker-run-report",
        hostId: input.hostId,
        workerId: input.workerId,
        runId: input.runId,
        startedAt,
        stoppedAt: now(),
        cycleCount: cycleNumber,
        listedCount,
        invokedCount,
        maintenanceRunCount,
        maintenanceBlockedCount,
        blockedCycleCount,
        storageUnavailableCycleCount,
        counts,
        drain: gate.read(),
        contracts: hostContracts(),
      })
    })()
    return startPromise
  }

  return {
    facts: {
      source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_HOST_V1_SOURCE,
      runtimeProfile: "local-integration",
      startMode: "explicit-dedicated-host",
      automaticStartOnImport: false,
      concurrency: 1,
      freshScanEachCycle: true,
      externalQueue: false,
      defaultServerMounted: false,
      productionBinding: false,
    },
    runCycle,
    start,
    beginDrain,
    forceStop,
    readDrain: () => gate.read(),
  }
}

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_EXECUTION_SOURCE =
  FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_WORKER_V1_SOURCE
