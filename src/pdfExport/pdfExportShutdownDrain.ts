import {
  cloneFlowDocBackendPdfExportJsonV1,
  flowDocBackendPdfExportFingerprintV1,
  flowDocBackendPdfExportOperationIssueV1,
  isFlowDocBackendPdfExportBoundedStringV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_SHUTDOWN_DRAIN_V1_SOURCE =
  "flowdoc-backend-pdf-export-shutdown-drain" as const

export interface FlowDocBackendPdfExportShutdownDrainStateV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_SHUTDOWN_DRAIN_V1_SOURCE
  contractVersion: 1
  kind: "pdf-export-shutdown-drain-state"
  gateId: string
  revision: number
  status: "accepting" | "draining" | "stopped"
  activeReservationCount: number
  drainRequestedAt: string | null
  stoppedAt: string | null
  stopReason: "shutdown-drain-complete" | "shutdown-forced" | null
  createdAt: string
  updatedAt: string
  contracts: {
    rejectsNewClaimsWhileDraining: true
    waitsForActiveReservations: true
    processLocal: true
    multiProcessCoordination: false
    workerExecution: false
    productionBinding: false
  }
  fingerprint: string
}

export type FlowDocBackendPdfExportShutdownDrainResultV1 =
  | {
      status: "reserved" | "released" | "draining" | "stopped" | "idempotent-replay"
      state: FlowDocBackendPdfExportShutdownDrainStateV1
      forcedReservationIds: string[]
      issues: []
    }
  | {
      status: "rejected" | "blocked"
      state: FlowDocBackendPdfExportShutdownDrainStateV1
      forcedReservationIds: []
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportShutdownDrainGateV1 {
  reserveClaim(input: { reservationId: string; reservedAt: string }): FlowDocBackendPdfExportShutdownDrainResultV1
  releaseClaim(input: { reservationId: string; releasedAt: string }): FlowDocBackendPdfExportShutdownDrainResultV1
  beginDrain(input: { requestedAt: string }): FlowDocBackendPdfExportShutdownDrainResultV1
  forceStop(input: { stoppedAt: string }): FlowDocBackendPdfExportShutdownDrainResultV1
  read(): FlowDocBackendPdfExportShutdownDrainStateV1
}

type DrainFactsV1 = Omit<FlowDocBackendPdfExportShutdownDrainStateV1, "fingerprint">

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function finalize(facts: DrainFactsV1): FlowDocBackendPdfExportShutdownDrainStateV1 {
  const cloned = cloneFlowDocBackendPdfExportJsonV1(facts)
  return { ...cloned, fingerprint: flowDocBackendPdfExportFingerprintV1(cloned) }
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1[] {
  return [flowDocBackendPdfExportOperationIssueV1(code, path, message)]
}

export function createFlowDocBackendPdfExportShutdownDrainGateV1(input: {
  gateId: string
  createdAt: string
}): FlowDocBackendPdfExportShutdownDrainGateV1 {
  if (!isFlowDocBackendPdfExportBoundedStringV1(input.gateId) || !exactIso(input.createdAt)) {
    throw new Error("PDF export shutdown drain gate requires a bounded id and exact creation time")
  }
  const reservations = new Set<string>()
  const completedReservations = new Set<string>()
  let state = finalize({
    source: FLOWDOC_BACKEND_PDF_EXPORT_SHUTDOWN_DRAIN_V1_SOURCE,
    contractVersion: 1,
    kind: "pdf-export-shutdown-drain-state",
    gateId: input.gateId,
    revision: 0,
    status: "accepting",
    activeReservationCount: 0,
    drainRequestedAt: null,
    stoppedAt: null,
    stopReason: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    contracts: {
      rejectsNewClaimsWhileDraining: true,
      waitsForActiveReservations: true,
      processLocal: true,
      multiProcessCoordination: false,
      workerExecution: false,
      productionBinding: false,
    },
  })

  const current = () => cloneFlowDocBackendPdfExportJsonV1(state)
  const staleTime = (at: string): boolean => Date.parse(at) < Date.parse(state.updatedAt)

  return {
    reserveClaim({ reservationId, reservedAt }) {
      if (!isFlowDocBackendPdfExportBoundedStringV1(reservationId) || !exactIso(reservedAt)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-reservation-invalid", "reservation", "reservation id and time must be bounded and monotonic"),
      }
      if (reservations.has(reservationId) || completedReservations.has(reservationId)) return {
        status: "idempotent-replay",
        state: current(),
        forcedReservationIds: [],
        issues: [],
      }
      if (staleTime(reservedAt)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-reservation-invalid", "reservedAt", "reservation time must be monotonic"),
      }
      if (state.status !== "accepting") return {
        status: "rejected",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-claim-rejected", "status", "draining or stopped gate rejects new claim reservations"),
      }
      reservations.add(reservationId)
      const { fingerprint: _fingerprint, ...facts } = state
      state = finalize({
        ...facts,
        revision: state.revision + 1,
        activeReservationCount: reservations.size,
        updatedAt: reservedAt,
      })
      return { status: "reserved", state: current(), forcedReservationIds: [], issues: [] }
    },

    releaseClaim({ reservationId, releasedAt }) {
      if (!isFlowDocBackendPdfExportBoundedStringV1(reservationId) || !exactIso(releasedAt)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-release-invalid", "reservation", "release id and time must be bounded and monotonic"),
      }
      if (completedReservations.has(reservationId)) return {
        status: "idempotent-replay",
        state: current(),
        forcedReservationIds: [],
        issues: [],
      }
      if (staleTime(releasedAt)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-release-invalid", "releasedAt", "release time must be monotonic"),
      }
      if (!reservations.has(reservationId)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-reservation-not-found", "reservationId", "only an active reservation can be released"),
      }
      reservations.delete(reservationId)
      completedReservations.add(reservationId)
      const { fingerprint: _fingerprint, ...facts } = state
      const completed = state.status === "draining" && reservations.size === 0
      state = finalize({
        ...facts,
        revision: state.revision + 1,
        status: completed ? "stopped" : state.status,
        activeReservationCount: reservations.size,
        stoppedAt: completed ? releasedAt : state.stoppedAt,
        stopReason: completed ? "shutdown-drain-complete" : state.stopReason,
        updatedAt: releasedAt,
      })
      return {
        status: completed ? "stopped" : "released",
        state: current(),
        forcedReservationIds: [],
        issues: [],
      }
    },

    beginDrain({ requestedAt }) {
      if (!exactIso(requestedAt)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-time-invalid", "requestedAt", "drain request time must be exact and monotonic"),
      }
      if (state.status !== "accepting") return {
        status: "idempotent-replay",
        state: current(),
        forcedReservationIds: [],
        issues: [],
      }
      if (staleTime(requestedAt)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-time-invalid", "requestedAt", "drain request time must be monotonic"),
      }
      const { fingerprint: _fingerprint, ...facts } = state
      const completed = reservations.size === 0
      state = finalize({
        ...facts,
        revision: state.revision + 1,
        status: completed ? "stopped" : "draining",
        drainRequestedAt: requestedAt,
        stoppedAt: completed ? requestedAt : null,
        stopReason: completed ? "shutdown-drain-complete" : null,
        updatedAt: requestedAt,
      })
      return {
        status: completed ? "stopped" : "draining",
        state: current(),
        forcedReservationIds: [],
        issues: [],
      }
    },

    forceStop({ stoppedAt }) {
      if (!exactIso(stoppedAt)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-time-invalid", "stoppedAt", "forced stop time must be exact and monotonic"),
      }
      if (state.status === "stopped") return {
        status: "idempotent-replay",
        state: current(),
        forcedReservationIds: [],
        issues: [],
      }
      if (staleTime(stoppedAt)) return {
        status: "blocked",
        state: current(),
        forcedReservationIds: [],
        issues: issue("pdf-export-drain-time-invalid", "stoppedAt", "forced stop time must be monotonic"),
      }
      const forcedReservationIds = [...reservations].sort()
      forcedReservationIds.forEach((reservationId) => completedReservations.add(reservationId))
      reservations.clear()
      const { fingerprint: _fingerprint, ...facts } = state
      state = finalize({
        ...facts,
        revision: state.revision + 1,
        status: "stopped",
        activeReservationCount: 0,
        drainRequestedAt: state.drainRequestedAt ?? stoppedAt,
        stoppedAt,
        stopReason: "shutdown-forced",
        updatedAt: stoppedAt,
      })
      return { status: "stopped", state: current(), forcedReservationIds, issues: [] }
    },

    read: current,
  }
}
