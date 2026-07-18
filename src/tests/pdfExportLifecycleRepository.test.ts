import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportLifecycleHeadV1,
  createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1,
  createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1,
  parseFlowDocBackendPdfExportLifecycleHeadV1,
  supportsFlowDocBackendPdfExportLifecycleSqliteV1,
  type FlowDocBackendPdfExportLifecycleRepositoryV1,
  type FlowDocBackendPdfExportLifecycleSqliteRepositoryV1,
  type FlowDocBackendPdfExportLifecycleTransitionRequestV1,
} from "../index.js"
import { createPdfExportOperationFixture, pdfExportOperationPolicy } from "./helpers/pdfExportOperationFixture.js"

const CLAIM_AT = "2026-07-18T09:00:02.000Z"
const CLAIM_EXPIRES_AT = "2026-07-18T09:00:32.000Z"

function claimRequest(
  operation = createPdfExportOperationFixture(),
  overrides: Partial<Extract<FlowDocBackendPdfExportLifecycleTransitionRequestV1, { kind: "claim" }>> = {},
): Extract<FlowDocBackendPdfExportLifecycleTransitionRequestV1, { kind: "claim" }> {
  return {
    transitionId: "transition:claim:1",
    tenantId: operation.scope.tenantId,
    principalId: operation.scope.principalId,
    operationId: operation.operationId,
    expectedHeadRevision: 0,
    transitionAt: CLAIM_AT,
    kind: "claim",
    claimToken: "claim:worker-a:1",
    workerId: "worker:a",
    claimExpiresAt: CLAIM_EXPIRES_AT,
    ...overrides,
  }
}

async function runLifecycleConformance(repository: FlowDocBackendPdfExportLifecycleRepositoryV1) {
  const operation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:conformance" })
  const initialized = await repository.initializeLifecycle(operation)
  expect(initialized).toMatchObject({
    status: "created",
    head: {
      operationId: operation.operationId,
      operationFingerprint: operation.operationFingerprint,
      headRevision: 0,
      status: "pending",
      checkpoint: "before-handoff",
      attemptCount: 0,
      maxAttempts: 2,
      deadlineAt: "2026-07-18T09:02:01.000Z",
      contracts: {
        rendererExecution: false,
        bytePersistence: false,
        artifactProjection: false,
        backendRoute: false,
        productionBinding: false,
      },
    },
    issues: [],
  })
  await expect(repository.initializeLifecycle(operation)).resolves.toMatchObject({
    status: "idempotent-replay",
    head: { headRevision: 0 },
  })

  const claim = claimRequest(operation)
  const claimed = await repository.applyLifecycleTransition(claim)
  expect(claimed).toMatchObject({
    status: "applied",
    head: {
      headRevision: 1,
      status: "claimed",
      attemptCount: 1,
      claim: { claimToken: claim.claimToken, workerId: claim.workerId, attemptNumber: 1 },
    },
    receipt: { transitionId: claim.transitionId, fromHeadRevision: 0, toHeadRevision: 1 },
    issues: [],
  })
  if (claimed.status !== "applied") throw new Error("claim must apply")

  await expect(repository.applyLifecycleTransition({
    ...claim,
    workerId: "worker:changed",
  })).resolves.toMatchObject({
    status: "conflict",
    head: { headRevision: 1 },
    receipt: null,
    issues: [{ code: "pdf-export-lifecycle-transition-conflict" }],
  })

  const passed = await repository.applyLifecycleTransition({
    transitionId: "transition:checkpoint:handoff",
    ...operation.scope,
    operationId: operation.operationId,
    expectedHeadRevision: 1,
    transitionAt: "2026-07-18T09:00:03.000Z",
    kind: "pass-checkpoint",
    claimToken: claim.claimToken,
    nextCheckpoint: "before-render",
  })
  expect(passed).toMatchObject({
    status: "applied",
    head: { headRevision: 2, checkpoint: "before-render" },
  })

  const replay = await repository.applyLifecycleTransition(claim)
  expect(replay).toMatchObject({
    status: "idempotent-replay",
    head: { headRevision: 1, checkpoint: "before-handoff" },
    receipt: { receiptFingerprint: claimed.receipt.receiptFingerprint },
  })

  const cancellation = await repository.applyLifecycleTransition({
    transitionId: "transition:cancel:1",
    ...operation.scope,
    operationId: operation.operationId,
    expectedHeadRevision: 2,
    transitionAt: "2026-07-18T09:00:04.000Z",
    kind: "request-cancellation",
  })
  expect(cancellation).toMatchObject({
    status: "applied",
    head: { headRevision: 3, status: "claimed", cancellation: { transitionId: "transition:cancel:1" } },
  })

  await expect(repository.applyLifecycleTransition({
    transitionId: "transition:checkpoint:render",
    ...operation.scope,
    operationId: operation.operationId,
    expectedHeadRevision: 3,
    transitionAt: "2026-07-18T09:00:05.000Z",
    kind: "pass-checkpoint",
    claimToken: claim.claimToken,
    nextCheckpoint: "before-persist",
  })).resolves.toMatchObject({
    status: "applied",
    head: {
      headRevision: 4,
      status: "stopped",
      checkpoint: "before-render",
      claim: null,
      stop: { reason: "cancelled-before-render", stoppedAt: "2026-07-18T09:00:05.000Z" },
    },
  })

  const read = await repository.readLifecycle({ ...operation.scope, operationId: operation.operationId })
  expect(read).toMatchObject({ status: "found", head: { headRevision: 4, status: "stopped" } })
  if (read.status !== "found") throw new Error("lifecycle must be readable")
  read.head.status = "pending"
  await expect(repository.readLifecycle({ ...operation.scope, operationId: operation.operationId })).resolves.toMatchObject({
    head: { status: "stopped" },
  })
  await expect(repository.readLifecycle({
    tenantId: "tenant:other",
    principalId: operation.scope.principalId,
    operationId: operation.operationId,
  })).resolves.toMatchObject({ status: "not-found", head: null })
  await expect(repository.applyLifecycleTransition({
    ...claim,
    transitionId: "transition:stale",
  })).resolves.toMatchObject({ status: "stale", head: { headRevision: 4 } })
}

describe("PDF export lifecycle repository", () => {
  const roots: string[] = []
  const sqliteRepositories: FlowDocBackendPdfExportLifecycleSqliteRepositoryV1[] = []

  afterEach(() => {
    sqliteRepositories.splice(0).forEach((repository) => {
      try {
        repository.close()
      } catch {
        // Restart tests can close a handle before cleanup.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function openSqlite(root?: string, options: {
    faultInjector?: Parameters<typeof createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1>[0]["faultInjector"]
  } = {}) {
    const selectedRoot = root ?? mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-lifecycle-"))
    if (root == null) roots.push(selectedRoot)
    const repository = await createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1({
      databasePath: join(selectedRoot, "pdf-export-lifecycle.sqlite"),
      ...options,
    })
    sqliteRepositories.push(repository)
    return { root: selectedRoot, repository }
  }

  it("passes lifecycle, replay, checkpoint cancellation, and scope conformance in memory", async () => {
    await runLifecycleConformance(createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1())
  })

  it("passes the same conformance through SQLite", async () => {
    const { repository } = await openSqlite()
    await runLifecycleConformance(repository)
  })

  it("fails closed on lifecycle head drift", () => {
    const operation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:drift" })
    const created = createFlowDocBackendPdfExportLifecycleHeadV1(operation)
    if (created.status !== "ready") throw new Error("lifecycle fixture must be valid")
    const drifted = structuredClone(created.head)
    drifted.attemptCount = 1
    expect(parseFlowDocBackendPdfExportLifecycleHeadV1(drifted)).toMatchObject({
      status: "blocked",
      head: null,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "pdf-export-lifecycle-fingerprint-mismatch" }),
      ]),
    })
  })

  it("enforces retry windows, attempt budget, deadline, reclaim, and forced shutdown", async () => {
    const repository = createInMemoryFlowDocBackendPdfExportLifecycleRepositoryV1()
    const retryOperation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:attempts" })
    await repository.initializeLifecycle(retryOperation)
    const firstClaim = claimRequest(retryOperation)
    await expect(repository.applyLifecycleTransition(firstClaim)).resolves.toMatchObject({ status: "applied" })
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:release:1",
      ...retryOperation.scope,
      operationId: retryOperation.operationId,
      expectedHeadRevision: 1,
      transitionAt: "2026-07-18T09:00:03.000Z",
      kind: "release-claim",
      claimToken: firstClaim.claimToken,
      retryAfter: "2026-07-18T09:00:10.000Z",
    })).resolves.toMatchObject({
      status: "applied",
      head: { status: "pending", checkpoint: "before-handoff", attemptCount: 1 },
    })
    await expect(repository.applyLifecycleTransition(claimRequest(retryOperation, {
      transitionId: "transition:claim:deferred",
      expectedHeadRevision: 2,
      transitionAt: "2026-07-18T09:00:09.000Z",
      claimExpiresAt: "2026-07-18T09:00:20.000Z",
    }))).resolves.toMatchObject({
      status: "blocked",
      issues: [{ code: "pdf-export-lifecycle-retry-deferred" }],
    })
    const secondClaim = claimRequest(retryOperation, {
      transitionId: "transition:claim:2",
      expectedHeadRevision: 2,
      transitionAt: "2026-07-18T09:00:10.000Z",
      claimExpiresAt: "2026-07-18T09:00:30.000Z",
      claimToken: "claim:worker-b:2",
      workerId: "worker:b",
    })
    await expect(repository.applyLifecycleTransition(secondClaim)).resolves.toMatchObject({
      status: "applied",
      head: { attemptCount: 2 },
    })
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:release:2",
      ...retryOperation.scope,
      operationId: retryOperation.operationId,
      expectedHeadRevision: 3,
      transitionAt: "2026-07-18T09:00:11.000Z",
      kind: "release-claim",
      claimToken: secondClaim.claimToken,
      retryAfter: null,
    })).resolves.toMatchObject({
      status: "applied",
      head: { status: "stopped", stop: { reason: "attempts-exhausted" } },
    })

    const reclaimOperation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:reclaim" })
    await repository.initializeLifecycle(reclaimOperation)
    await repository.applyLifecycleTransition(claimRequest(reclaimOperation, {
      claimExpiresAt: "2026-07-18T09:00:05.000Z",
    }))
    await repository.applyLifecycleTransition({
      transitionId: "transition:reclaim:checkpoint",
      ...reclaimOperation.scope,
      operationId: reclaimOperation.operationId,
      expectedHeadRevision: 1,
      transitionAt: "2026-07-18T09:00:03.000Z",
      kind: "pass-checkpoint",
      claimToken: "claim:worker-a:1",
      nextCheckpoint: "before-render",
    })
    await expect(repository.applyLifecycleTransition(claimRequest(reclaimOperation, {
      transitionId: "transition:claim:reclaimed",
      transitionAt: "2026-07-18T09:00:05.000Z",
      claimExpiresAt: "2026-07-18T09:00:20.000Z",
      claimToken: "claim:reclaimed",
      workerId: "worker:reclaimer",
      expectedHeadRevision: 2,
    }))).resolves.toMatchObject({
      status: "applied",
      head: {
        checkpoint: "before-handoff",
        attemptCount: 2,
        claim: { claimToken: "claim:reclaimed" },
      },
    })

    const deadlineOperation = createPdfExportOperationFixture({
      operationId: "operation:lifecycle:deadline",
      policy: pdfExportOperationPolicy({ executionDeadlineMs: 5_000 }),
    })
    await repository.initializeLifecycle(deadlineOperation)
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:deadline",
      ...deadlineOperation.scope,
      operationId: deadlineOperation.operationId,
      expectedHeadRevision: 0,
      transitionAt: "2026-07-18T09:00:06.000Z",
      kind: "enforce-deadline",
    })).resolves.toMatchObject({
      status: "applied",
      head: { status: "stopped", stop: { reason: "deadline-exceeded" } },
    })

    const forcedOperation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:forced" })
    await repository.initializeLifecycle(forcedOperation)
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:forced",
      ...forcedOperation.scope,
      operationId: forcedOperation.operationId,
      expectedHeadRevision: 0,
      transitionAt: CLAIM_AT,
      kind: "force-shutdown",
    })).resolves.toMatchObject({
      status: "applied",
      head: { status: "stopped", stop: { reason: "shutdown-forced" } },
    })

    const persistOperation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:before-persist" })
    await repository.initializeLifecycle(persistOperation)
    const persistClaim = claimRequest(persistOperation)
    await repository.applyLifecycleTransition(persistClaim)
    await repository.applyLifecycleTransition({
      transitionId: "transition:persist:handoff",
      ...persistOperation.scope,
      operationId: persistOperation.operationId,
      expectedHeadRevision: 1,
      transitionAt: "2026-07-18T09:00:03.000Z",
      kind: "pass-checkpoint",
      claimToken: persistClaim.claimToken,
      nextCheckpoint: "before-render",
    })
    await repository.applyLifecycleTransition({
      transitionId: "transition:persist:render",
      ...persistOperation.scope,
      operationId: persistOperation.operationId,
      expectedHeadRevision: 2,
      transitionAt: "2026-07-18T09:00:04.000Z",
      kind: "pass-checkpoint",
      claimToken: persistClaim.claimToken,
      nextCheckpoint: "before-persist",
    })
    await repository.applyLifecycleTransition({
      transitionId: "transition:persist:cancel",
      ...persistOperation.scope,
      operationId: persistOperation.operationId,
      expectedHeadRevision: 3,
      transitionAt: "2026-07-18T09:00:05.000Z",
      kind: "request-cancellation",
    })
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:persist:check",
      ...persistOperation.scope,
      operationId: persistOperation.operationId,
      expectedHeadRevision: 4,
      transitionAt: "2026-07-18T09:00:06.000Z",
      kind: "check-checkpoint",
      claimToken: persistClaim.claimToken,
    })).resolves.toMatchObject({
      status: "applied",
      head: {
        status: "stopped",
        checkpoint: "before-persist",
        stop: { reason: "cancelled-before-persist" },
      },
    })

    const clearOperation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:checkpoint-clear" })
    await repository.initializeLifecycle(clearOperation)
    const clearClaim = claimRequest(clearOperation)
    await repository.applyLifecycleTransition(clearClaim)
    await expect(repository.applyLifecycleTransition({
      transitionId: "transition:checkpoint:clear",
      ...clearOperation.scope,
      operationId: clearOperation.operationId,
      expectedHeadRevision: 1,
      transitionAt: "2026-07-18T09:00:03.000Z",
      kind: "check-checkpoint",
      claimToken: clearClaim.claimToken,
    })).resolves.toMatchObject({
      status: "applied",
      head: {
        status: "claimed",
        checkpointCheck: {
          checkpoint: "before-handoff",
          claimToken: clearClaim.claimToken,
          checkedAt: "2026-07-18T09:00:03.000Z",
        },
      },
    })
  })

  it("retains transition replay across close and reopen", async () => {
    const { root, repository } = await openSqlite()
    const operation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:restart" })
    await repository.initializeLifecycle(operation)
    const claim = claimRequest(operation)
    const applied = await repository.applyLifecycleTransition(claim)
    expect(applied.status).toBe("applied")
    repository.close()

    const reopened = await createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1({
      databasePath: join(root, "pdf-export-lifecycle.sqlite"),
    })
    sqliteRepositories.push(reopened)
    await expect(reopened.applyLifecycleTransition(claim)).resolves.toMatchObject({
      status: "idempotent-replay",
      head: { headRevision: 1 },
      receipt: applied.status === "applied" ? applied.receipt : undefined,
    })
  })

  it("keeps a transition on one exact side of before/after commit faults", async () => {
    for (const point of ["before-commit", "after-commit"] as const) {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-pdf-export-lifecycle-${point}-`))
      roots.push(root)
      let injected = false
      const { repository } = await openSqlite(root, {
        faultInjector(context) {
          if (!injected && context.transactionKind === "lifecycle-transition" && context.point === point) {
            injected = true
            throw new Error(`injected-${point}`)
          }
        },
      })
      const operation = createPdfExportOperationFixture({ operationId: `operation:lifecycle:fault:${point}` })
      await repository.initializeLifecycle(operation)
      const claim = claimRequest(operation)
      await expect(repository.applyLifecycleTransition(claim)).rejects.toThrow(`injected-${point}`)
      repository.close()

      const reopened = await createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1({
        databasePath: join(root, "pdf-export-lifecycle.sqlite"),
      })
      sqliteRepositories.push(reopened)
      await expect(reopened.readLifecycle({ ...operation.scope, operationId: operation.operationId })).resolves.toMatchObject({
        status: "found",
        head: { headRevision: point === "before-commit" ? 0 : 1 },
      })
      await expect(reopened.applyLifecycleTransition(claim)).resolves.toMatchObject({
        status: point === "before-commit" ? "applied" : "idempotent-replay",
        head: { headRevision: 1 },
      })
    }
  })

  it("keeps initialization on one exact side of before/after commit faults", async () => {
    for (const point of ["before-commit", "after-commit"] as const) {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-pdf-export-lifecycle-init-${point}-`))
      roots.push(root)
      let injected = false
      const { repository } = await openSqlite(root, {
        faultInjector(context) {
          if (!injected && context.transactionKind === "lifecycle-initialize" && context.point === point) {
            injected = true
            throw new Error(`injected-init-${point}`)
          }
        },
      })
      const operation = createPdfExportOperationFixture({ operationId: `operation:lifecycle:init-fault:${point}` })
      await expect(repository.initializeLifecycle(operation)).rejects.toThrow(`injected-init-${point}`)
      repository.close()

      const reopened = await createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1({
        databasePath: join(root, "pdf-export-lifecycle.sqlite"),
      })
      sqliteRepositories.push(reopened)
      await expect(reopened.readLifecycle({ ...operation.scope, operationId: operation.operationId })).resolves.toMatchObject({
        status: point === "before-commit" ? "not-found" : "found",
      })
      await expect(reopened.initializeLifecycle(operation)).resolves.toMatchObject({
        status: point === "before-commit" ? "created" : "idempotent-replay",
        head: { headRevision: 0 },
      })
    }
  })

  it("retains one claim owner across independent SQLite handles", async () => {
    const { root, repository: first } = await openSqlite()
    const second = await createFlowDocBackendPdfExportLifecycleSqliteRepositoryV1({
      databasePath: join(root, "pdf-export-lifecycle.sqlite"),
    })
    sqliteRepositories.push(second)
    const operation = createPdfExportOperationFixture({ operationId: "operation:lifecycle:handles" })
    await first.initializeLifecycle(operation)
    const results = await Promise.all([
      first.applyLifecycleTransition(claimRequest(operation, {
        transitionId: "transition:handles:first",
        claimToken: "claim:handles:first",
      })),
      second.applyLifecycleTransition(claimRequest(operation, {
        transitionId: "transition:handles:second",
        claimToken: "claim:handles:second",
      })),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["applied", "stale"])
    const found = await first.readLifecycle({ ...operation.scope, operationId: operation.operationId })
    expect(found).toMatchObject({ status: "found", head: { headRevision: 1, attemptCount: 1 } })
  })

  it("keeps the SQLite adapter behind the explicit runtime floor", () => {
    expect(supportsFlowDocBackendPdfExportLifecycleSqliteV1("24.15.0")).toBe(true)
    expect(supportsFlowDocBackendPdfExportLifecycleSqliteV1("24.14.9")).toBe(false)
    expect(supportsFlowDocBackendPdfExportLifecycleSqliteV1("22.13.0")).toBe(false)
    expect(supportsFlowDocBackendPdfExportLifecycleSqliteV1()).toBe(true)
  })
})
