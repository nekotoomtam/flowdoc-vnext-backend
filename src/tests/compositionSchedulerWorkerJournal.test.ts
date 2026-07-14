import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  compositionFingerprint,
  createFlowDocBackendCompositionHeadUnavailableResultV1,
  createFlowDocBackendCompositionSqliteRepositoryV1,
  createFlowDocBackendCompositionWorkerStorageAttemptV1,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1,
  reconcileFlowDocBackendCompositionWorkerStorageAttemptV1,
  type FlowDocBackendCompositionSqliteRepositoryV1,
  type FlowDocBackendCompositionWorkerHeadMutationV1,
} from "../index.js"
import { createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })
const unavailableAt = "2026-07-13T08:02:00.000Z"

function workerFacts() {
  const fixture = createCompositionSchedulerFixture()
  const mutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
    operation: "head-create",
    input: {
      createRequestId: "journal-head-create",
      requestFingerprint: fp("journal-head-create"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    },
  }
  const unavailable = createFlowDocBackendCompositionHeadUnavailableResultV1({
    operation: "head-create",
    reconcileWith: "create-request",
    message: "test unavailable",
  })
  const attempt = createFlowDocBackendCompositionWorkerStorageAttemptV1({
    mutation,
    unavailable,
    completedWriteAttemptCount: 1,
    unavailableAt,
  })
  if (attempt.status === "blocked") throw new Error(attempt.issues[0]?.message)
  return {
    mutation,
    state: attempt.state,
    create: {
      attemptId: "worker-attempt-1",
      createRequestId: "journal-create-1",
      createRequestFingerprint: fp("journal-create-1"),
      mutation,
      state: attempt.state,
      createdAt: unavailableAt,
    },
  }
}

describe("composition scheduler worker journal", () => {
  const roots: string[] = []
  const repositories: FlowDocBackendCompositionSqliteRepositoryV1[] = []

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      try {
        repository.close()
      } catch {
        // A restart or fault-boundary test may already have closed this handle.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function open(databasePath?: string, faultInjector?: Parameters<
    typeof createFlowDocBackendCompositionSqliteRepositoryV1
  >[0]["faultInjector"]) {
    const root = databasePath == null ? mkdtempSync(join(tmpdir(), "flowdoc-worker-journal-")) : null
    if (root != null) roots.push(root)
    const selectedPath = databasePath ?? join(root!, "composition.sqlite")
    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
      databasePath: selectedPath,
      faultInjector,
    })
    repositories.push(repository)
    return { databasePath: selectedPath, repository }
  }

  it("owns each mutation once and replays exact creation", async () => {
    const journal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    const facts = workerFacts()
    await expect(journal.createWorkerAttempt(facts.create)).resolves.toMatchObject({
      status: "created",
      entry: { journalRevision: 0, status: "pending" },
    })
    await expect(journal.createWorkerAttempt(facts.create)).resolves.toMatchObject({ status: "idempotent-replay" })
    await expect(journal.createWorkerAttempt({
      ...facts.create,
      attemptId: "worker-attempt-other",
      createRequestId: "journal-create-other",
      createRequestFingerprint: fp("journal-create-other"),
    })).resolves.toMatchObject({ status: "conflict" })
    await expect(journal.createWorkerAttempt({
      ...facts.create,
      createRequestId: "journal-create-conflict",
      createRequestFingerprint: fp("journal-create-conflict"),
    })).resolves.toMatchObject({ status: "conflict" })
  })

  it("enforces scheduling, ownership, release replay, expiry reclaim, and terminal replay", async () => {
    const journal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    const facts = workerFacts()
    await journal.createWorkerAttempt(facts.create)

    await expect(journal.claimWorkerAttempt({
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 0,
      claimToken: "claim-1",
      workerId: "worker-1",
      claimedAt: "2026-07-13T08:01:59.999Z",
      expiresAt: "2026-07-13T08:02:59.999Z",
    })).resolves.toMatchObject({ status: "invalid" })
    const claim = {
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 0,
      claimToken: "claim-1",
      workerId: "worker-1",
      claimedAt: unavailableAt,
      expiresAt: "2026-07-13T08:03:00.000Z",
    }
    await expect(journal.claimWorkerAttempt(claim)).resolves.toMatchObject({
      status: "claimed",
      entry: { journalRevision: 1 },
    })
    await expect(journal.createWorkerAttempt(facts.create)).resolves.toMatchObject({
      status: "idempotent-replay",
      entry: { journalRevision: 1, status: "claimed" },
    })
    await expect(journal.claimWorkerAttempt(claim)).resolves.toMatchObject({ status: "idempotent-replay" })
    await expect(journal.claimWorkerAttempt({
      ...claim,
      claimToken: "claim-competing",
      workerId: "worker-2",
    })).resolves.toMatchObject({ status: "busy" })
    await expect(journal.startWorkerAttempt({
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 1,
      claimToken: "claim-1",
      startedAt: "2026-07-13T08:02:00.050Z",
    })).resolves.toMatchObject({ status: "started", entry: { journalRevision: 2 } })

    const reconciled = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
      repository: createInMemoryFlowDocBackendCompositionRepositoryV1(),
      mutation: facts.mutation,
      state: facts.state,
      observedAt: unavailableAt,
    })
    if (reconciled.status !== "retry-ready") throw new Error("journal fixture did not reach retry-ready")
    const release = {
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 2,
      claimToken: "claim-1",
      releasedAt: "2026-07-13T08:02:00.100Z",
      nextState: reconciled.state,
    }
    await expect(journal.releaseWorkerAttempt(release)).resolves.toMatchObject({
      status: "released",
      entry: { journalRevision: 3, status: "pending" },
    })
    await expect(journal.releaseWorkerAttempt(release)).resolves.toMatchObject({ status: "idempotent-replay" })
    await expect(journal.releaseWorkerAttempt({
      ...release,
      claimToken: "claim-that-never-owned-the-release",
    })).resolves.toMatchObject({ status: "invalid" })

    const retryClaim = {
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 3,
      claimToken: "claim-retry-1",
      workerId: "worker-1",
      claimedAt: reconciled.state.retryNotBefore,
      expiresAt: "2026-07-13T08:03:00.250Z",
    }
    await expect(journal.claimWorkerAttempt({
      ...retryClaim,
      claimedAt: "2026-07-13T08:02:00.249Z",
      expiresAt: "2026-07-13T08:03:00.249Z",
    })).resolves.toMatchObject({ status: "deferred" })
    await expect(journal.claimWorkerAttempt(retryClaim)).resolves.toMatchObject({ status: "claimed" })
    await expect(journal.startWorkerAttempt({
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 4,
      claimToken: retryClaim.claimToken,
      startedAt: retryClaim.claimedAt,
    })).resolves.toMatchObject({ status: "started", entry: { journalRevision: 5 } })
    const reclaim = {
      ...retryClaim,
      expectedJournalRevision: 5,
      claimToken: "claim-retry-2",
      workerId: "worker-2",
      claimedAt: retryClaim.expiresAt,
      expiresAt: "2026-07-13T08:04:00.250Z",
    }
    await expect(journal.claimWorkerAttempt(reclaim)).resolves.toMatchObject({
      status: "reclaimed",
      entry: { journalRevision: 6 },
    })
    await expect(journal.startWorkerAttempt({
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 6,
      claimToken: reclaim.claimToken,
      startedAt: reclaim.claimedAt,
    })).resolves.toMatchObject({ status: "started", entry: { journalRevision: 7 } })
    await expect(journal.completeWorkerAttempt({
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 5,
      claimToken: retryClaim.claimToken,
      completedAt: retryClaim.expiresAt,
      terminalStatus: "failed",
      resultFingerprint: fp("old-owner"),
    })).resolves.toMatchObject({ status: "stale" })

    const completion = {
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 7,
      claimToken: reclaim.claimToken,
      completedAt: "2026-07-13T08:03:00.300Z",
      terminalStatus: "exhausted" as const,
      resultFingerprint: fp("terminal-exhausted"),
    }
    await expect(journal.completeWorkerAttempt(completion)).resolves.toMatchObject({
      status: "completed",
      entry: { journalRevision: 8, status: "completed" },
    })
    await expect(journal.completeWorkerAttempt(completion)).resolves.toMatchObject({ status: "idempotent-replay" })
    await expect(journal.completeWorkerAttempt({
      ...completion,
      claimToken: "different-owner",
    })).resolves.toMatchObject({ status: "stale" })
  })

  it("persists through restart and admits only one competing SQLite claimant", async () => {
    const facts = workerFacts()
    const first = await open()
    await first.repository.createWorkerAttempt(facts.create)
    const second = await open(first.databasePath)
    const claimA = first.repository.claimWorkerAttempt({
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 0,
      claimToken: "sqlite-claim-a",
      workerId: "sqlite-worker-a",
      claimedAt: unavailableAt,
      expiresAt: "2026-07-13T08:03:00.000Z",
    })
    const claimB = second.repository.claimWorkerAttempt({
      attemptId: facts.create.attemptId,
      expectedJournalRevision: 0,
      claimToken: "sqlite-claim-b",
      workerId: "sqlite-worker-b",
      claimedAt: unavailableAt,
      expiresAt: "2026-07-13T08:03:00.000Z",
    })
    const results = await Promise.all([claimA, claimB])
    expect(results.filter((result) => result.status === "claimed")).toHaveLength(1)
    expect(results.filter((result) => result.status === "busy" || result.status === "stale")).toHaveLength(1)

    first.repository.close()
    second.repository.close()
    const reopened = await open(first.databasePath)
    await expect(reopened.repository.readWorkerAttempt(facts.create.attemptId)).resolves.toMatchObject({
      status: "found",
      entry: { journalRevision: 1, status: "claimed" },
    })
  })

  it("keeps release entirely before or after the SQLite commit crash boundary", async () => {
    for (const point of ["before-commit", "after-commit"] as const) {
      const facts = workerFacts()
      const initial = await open()
      await initial.repository.createWorkerAttempt(facts.create)
      await initial.repository.claimWorkerAttempt({
        attemptId: facts.create.attemptId,
        expectedJournalRevision: 0,
        claimToken: "fault-claim",
        workerId: "fault-worker",
        claimedAt: unavailableAt,
        expiresAt: "2026-07-13T08:03:00.000Z",
      })
      await initial.repository.startWorkerAttempt({
        attemptId: facts.create.attemptId,
        expectedJournalRevision: 1,
        claimToken: "fault-claim",
        startedAt: "2026-07-13T08:02:00.050Z",
      })
      const reconciled = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
        repository: createInMemoryFlowDocBackendCompositionRepositoryV1(),
        mutation: facts.mutation,
        state: facts.state,
        observedAt: unavailableAt,
      })
      if (reconciled.status !== "retry-ready") throw new Error("journal fixture did not reach retry-ready")
      initial.repository.close()

      let injected = false
      const faulted = await open(initial.databasePath, (context) => {
        if (!injected && context.transactionKind === "worker-journal-release" && context.point === point) {
          injected = true
          throw new Error(`injected-${point}`)
        }
      })
      const release = {
        attemptId: facts.create.attemptId,
        expectedJournalRevision: 2,
        claimToken: "fault-claim",
        releasedAt: "2026-07-13T08:02:00.100Z",
        nextState: reconciled.state,
      }
      await expect(faulted.repository.releaseWorkerAttempt(release)).rejects.toThrow(`injected-${point}`)
      faulted.repository.close()

      const reopened = await open(initial.databasePath)
      await expect(reopened.repository.readWorkerAttempt(facts.create.attemptId)).resolves.toMatchObject({
        status: "found",
        entry: point === "before-commit"
          ? { journalRevision: 2, status: "claimed" }
          : { journalRevision: 3, status: "pending" },
      })
      await expect(reopened.repository.releaseWorkerAttempt(release)).resolves.toMatchObject({
        status: point === "before-commit" ? "released" : "idempotent-replay",
      })
    }
  })

  it("replays claim and completion across both SQLite commit crash boundaries", async () => {
    for (const operation of ["claim", "complete"] as const) {
      for (const point of ["before-commit", "after-commit"] as const) {
        const facts = workerFacts()
        const initial = await open()
        await initial.repository.createWorkerAttempt(facts.create)
        const claim = {
          attemptId: facts.create.attemptId,
          expectedJournalRevision: 0,
          claimToken: `crash-${operation}-claim`,
          workerId: "crash-worker",
          claimedAt: unavailableAt,
          expiresAt: "2026-07-13T08:03:00.000Z",
        }
        if (operation === "complete") {
          await initial.repository.claimWorkerAttempt(claim)
          await initial.repository.startWorkerAttempt({
            attemptId: facts.create.attemptId,
            expectedJournalRevision: 1,
            claimToken: claim.claimToken,
            startedAt: unavailableAt,
          })
        }
        initial.repository.close()

        let injected = false
        const faulted = await open(initial.databasePath, (context) => {
          if (
            !injected
            && context.transactionKind === `worker-journal-${operation}`
            && context.point === point
          ) {
            injected = true
            throw new Error(`injected-${operation}-${point}`)
          }
        })
        const completion = {
          attemptId: facts.create.attemptId,
          expectedJournalRevision: 2,
          claimToken: claim.claimToken,
          completedAt: "2026-07-13T08:02:00.100Z",
          terminalStatus: "failed" as const,
          resultFingerprint: fp(`crash-${operation}-terminal`),
        }
        const operationPromise = operation === "claim"
          ? faulted.repository.claimWorkerAttempt(claim)
          : faulted.repository.completeWorkerAttempt(completion)
        await expect(operationPromise).rejects.toThrow(`injected-${operation}-${point}`)
        faulted.repository.close()

        const reopened = await open(initial.databasePath)
        await expect(reopened.repository.readWorkerAttempt(facts.create.attemptId)).resolves.toMatchObject({
          status: "found",
          entry: operation === "claim"
            ? point === "before-commit"
              ? { journalRevision: 0, status: "pending" }
              : { journalRevision: 1, status: "claimed" }
            : point === "before-commit"
              ? { journalRevision: 2, status: "claimed" }
              : { journalRevision: 3, status: "completed" },
        })
        if (operation === "claim") {
          await expect(reopened.repository.claimWorkerAttempt(claim)).resolves.toMatchObject({
            status: point === "before-commit" ? "claimed" : "idempotent-replay",
          })
        } else {
          await expect(reopened.repository.completeWorkerAttempt(completion)).resolves.toMatchObject({
            status: point === "before-commit" ? "completed" : "idempotent-replay",
          })
        }
      }
    }
  })

  it("keeps execution start entirely before or after the SQLite commit crash boundary", async () => {
    for (const point of ["before-commit", "after-commit"] as const) {
      const facts = workerFacts()
      const initial = await open()
      await initial.repository.createWorkerAttempt(facts.create)
      await initial.repository.claimWorkerAttempt({
        attemptId: facts.create.attemptId,
        expectedJournalRevision: 0,
        claimToken: "start-crash-claim",
        workerId: "start-crash-worker",
        claimedAt: unavailableAt,
        expiresAt: "2026-07-13T08:03:00.000Z",
      })
      initial.repository.close()

      let injected = false
      const faulted = await open(initial.databasePath, (context) => {
        if (!injected && context.transactionKind === "worker-journal-start" && context.point === point) {
          injected = true
          throw new Error(`injected-start-${point}`)
        }
      })
      const start = {
        attemptId: facts.create.attemptId,
        expectedJournalRevision: 1,
        claimToken: "start-crash-claim",
        startedAt: "2026-07-13T08:02:00.010Z",
      }
      await expect(faulted.repository.startWorkerAttempt(start)).rejects.toThrow(`injected-start-${point}`)
      faulted.repository.close()

      const reopened = await open(initial.databasePath)
      await expect(reopened.repository.readWorkerAttempt(facts.create.attemptId)).resolves.toMatchObject({
        status: "found",
        entry: point === "before-commit"
          ? { journalRevision: 1, status: "claimed", execution: null }
          : { journalRevision: 2, status: "claimed", execution: { phase: "reconcile" } },
      })
      await expect(reopened.repository.startWorkerAttempt(start)).resolves.toMatchObject({
        status: point === "before-commit" ? "started" : "idempotent-replay",
      })
    }
  })
})
