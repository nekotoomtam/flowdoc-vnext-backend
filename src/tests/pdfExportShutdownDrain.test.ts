import { describe, expect, it } from "vitest"
import { createFlowDocBackendPdfExportShutdownDrainGateV1 } from "../index.js"

describe("PDF export shutdown drain gate", () => {
  it("rejects new claims while draining and stops after active reservations release", () => {
    const gate = createFlowDocBackendPdfExportShutdownDrainGateV1({
      gateId: "pdf-export-worker:primary",
      createdAt: "2026-07-18T09:00:00.000Z",
    })
    expect(gate.reserveClaim({
      reservationId: "reservation:1",
      reservedAt: "2026-07-18T09:00:01.000Z",
    })).toMatchObject({ status: "reserved", state: { activeReservationCount: 1 } })
    expect(gate.reserveClaim({
      reservationId: "reservation:1",
      reservedAt: "2026-07-18T09:00:01.000Z",
    })).toMatchObject({ status: "idempotent-replay", state: { activeReservationCount: 1 } })
    expect(gate.reserveClaim({
      reservationId: "reservation:2",
      reservedAt: "2026-07-18T09:00:02.000Z",
    })).toMatchObject({ status: "reserved", state: { activeReservationCount: 2 } })

    expect(gate.beginDrain({ requestedAt: "2026-07-18T09:00:03.000Z" })).toMatchObject({
      status: "draining",
      state: { status: "draining", activeReservationCount: 2 },
    })
    expect(gate.reserveClaim({
      reservationId: "reservation:3",
      reservedAt: "2026-07-18T09:00:04.000Z",
    })).toMatchObject({
      status: "rejected",
      state: { status: "draining", activeReservationCount: 2 },
      issues: [{ code: "pdf-export-drain-claim-rejected" }],
    })
    expect(gate.releaseClaim({
      reservationId: "reservation:1",
      releasedAt: "2026-07-18T09:00:05.000Z",
    })).toMatchObject({ status: "released", state: { status: "draining", activeReservationCount: 1 } })
    expect(gate.reserveClaim({
      reservationId: "reservation:1",
      reservedAt: "2026-07-18T09:00:01.000Z",
    })).toMatchObject({
      status: "idempotent-replay",
      state: { status: "draining", activeReservationCount: 1 },
    })
    expect(gate.releaseClaim({
      reservationId: "reservation:2",
      releasedAt: "2026-07-18T09:00:06.000Z",
    })).toMatchObject({
      status: "stopped",
      state: {
        status: "stopped",
        activeReservationCount: 0,
        stopReason: "shutdown-drain-complete",
        contracts: { processLocal: true, multiProcessCoordination: false, productionBinding: false },
      },
    })
    expect(gate.releaseClaim({
      reservationId: "reservation:2",
      releasedAt: "2026-07-18T09:00:06.000Z",
    })).toMatchObject({ status: "idempotent-replay", state: { status: "stopped" } })
  })

  it("reports the exact reservations abandoned by forced shutdown", () => {
    const gate = createFlowDocBackendPdfExportShutdownDrainGateV1({
      gateId: "pdf-export-worker:forced",
      createdAt: "2026-07-18T09:00:00.000Z",
    })
    gate.reserveClaim({ reservationId: "reservation:b", reservedAt: "2026-07-18T09:00:01.000Z" })
    gate.reserveClaim({ reservationId: "reservation:a", reservedAt: "2026-07-18T09:00:02.000Z" })
    expect(gate.forceStop({ stoppedAt: "2026-07-18T09:00:03.000Z" })).toMatchObject({
      status: "stopped",
      forcedReservationIds: ["reservation:a", "reservation:b"],
      state: { status: "stopped", activeReservationCount: 0, stopReason: "shutdown-forced" },
    })
    expect(gate.forceStop({ stoppedAt: "2026-07-18T09:00:04.000Z" })).toMatchObject({
      status: "idempotent-replay",
      forcedReservationIds: [],
    })
  })

  it("stops immediately when drain begins without active work", () => {
    const gate = createFlowDocBackendPdfExportShutdownDrainGateV1({
      gateId: "pdf-export-worker:idle",
      createdAt: "2026-07-18T09:00:00.000Z",
    })
    expect(gate.beginDrain({ requestedAt: "2026-07-18T09:00:01.000Z" })).toMatchObject({
      status: "stopped",
      state: { stopReason: "shutdown-drain-complete", activeReservationCount: 0 },
    })
  })
})
