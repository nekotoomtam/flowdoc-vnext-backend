import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  FLOWDOC_BACKEND_COMPOSITION_MAX_DUE_WORKER_ATTEMPTS,
  compositionFingerprint,
  createFlowDocBackendCompositionHeadUnavailableResultV1,
  createFlowDocBackendCompositionSqliteRepositoryV1,
  createFlowDocBackendCompositionWorkerStorageAttemptV1,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1,
  runFlowDocBackendCompositionDueWorkerBatchV1,
  runFlowDocBackendCompositionWorkerAttemptOnceV1,
  type FlowDocBackendCompositionSqliteRepositoryV1,
  type FlowDocBackendCompositionWorkerHeadMutationV1,
  type FlowDocBackendCompositionWorkerJournalCreateInputV1,
  type FlowDocBackendCompositionWorkerJournalEntryV1,
  type FlowDocBackendCompositionWorkerJournalRepositoryV1,
  type FlowDocBackendCompositionWorkerRunnerClockV1,
} from "../index.js"
import { createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })

function sequenceClock(...values: string[]): FlowDocBackendCompositionWorkerRunnerClockV1 {
  let index = 0
  return {
    now() {
      const value = values[index] ?? values.at(-1)
      index += 1
      if (value == null) throw new Error("clock sequence is empty")
      return value
    },
  }
}

function createInput(input: {
  attemptId: string
  unavailableAt: string
  completedWriteAttemptCount?: number
}): FlowDocBackendCompositionWorkerJournalCreateInputV1 {
  const fixture = createCompositionSchedulerFixture()
  const mutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
    operation: "head-create",
    input: {
      createRequestId: `head-${input.attemptId}`,
      requestFingerprint: fp(`head-${input.attemptId}`),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    },
  }
  const unavailable = createFlowDocBackendCompositionHeadUnavailableResultV1({
    operation: "head-create",
    reconcileWith: "create-request",
    message: `unavailable ${input.attemptId}`,
  })
  const state = createFlowDocBackendCompositionWorkerStorageAttemptV1({
    mutation,
    unavailable,
    completedWriteAttemptCount: input.completedWriteAttemptCount ?? 1,
    unavailableAt: input.unavailableAt,
  })
  if (state.status === "blocked") throw new Error(state.issues[0]?.message)
  return {
    attemptId: input.attemptId,
    createRequestId: `journal-${input.attemptId}`,
    createRequestFingerprint: fp(`journal-${input.attemptId}`),
    mutation,
    state: state.state,
    createdAt: "2026-07-13T08:00:00.000Z",
  }
}

async function seed(
  repository: FlowDocBackendCompositionWorkerJournalRepositoryV1,
  inputs: FlowDocBackendCompositionWorkerJournalCreateInputV1[],
): Promise<void> {
  for (const input of inputs) {
    const created = await repository.createWorkerAttempt(input)
    if (created.status !== "created") throw new Error(`seed failed: ${created.status}`)
  }
}

describe("composition scheduler due worker discovery", () => {
  const roots: string[] = []
  const repositories: FlowDocBackendCompositionSqliteRepositoryV1[] = []

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      try {
        repository.close()
      } catch {
        // Restart tests may close a handle before cleanup.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function open(databasePath?: string) {
    const root = databasePath == null ? mkdtempSync(join(tmpdir(), "flowdoc-worker-due-")) : null
    if (root != null) roots.push(root)
    const selectedPath = databasePath ?? join(root!, "composition.sqlite")
    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath: selectedPath })
    repositories.push(repository)
    return { databasePath: selectedPath, repository }
  }

  it("orders due pending entries, pages by exact cursor, and performs no claims", async () => {
    const repository = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await seed(repository, [
      createInput({ attemptId: "attempt-b", unavailableAt: "2026-07-13T08:02:00.000Z" }),
      createInput({ attemptId: "attempt-a", unavailableAt: "2026-07-13T08:02:00.000Z" }),
      createInput({ attemptId: "attempt-c", unavailableAt: "2026-07-13T08:03:00.000Z" }),
    ])
    const before = await repository.readWorkerAttempt("attempt-a")
    const first = await repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:30.000Z",
      maximumResultCount: 1,
      after: null,
    })
    expect(first).toMatchObject({
      status: "ready",
      entries: [{ attemptId: "attempt-a", status: "pending", journalRevision: 0 }],
      nextCursor: { dueAt: "2026-07-13T08:02:00.000Z", attemptId: "attempt-a" },
    })
    if (first.status !== "ready") throw new Error("first due page failed")
    await expect(repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:30.000Z",
      maximumResultCount: 1,
      after: first.nextCursor,
    })).resolves.toMatchObject({
      status: "ready",
      entries: [{ attemptId: "attempt-b", status: "pending", journalRevision: 0 }],
      nextCursor: null,
    })
    expect(await repository.readWorkerAttempt("attempt-a")).toEqual(before)
    await expect(repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:30.000Z",
      maximumResultCount: FLOWDOC_BACKEND_COMPOSITION_MAX_DUE_WORKER_ATTEMPTS + 1,
      after: null,
    })).resolves.toMatchObject({ status: "invalid" })
  })

  it("discovers expired claims for reclaim while excluding active claims", async () => {
    const repository = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await seed(repository, [
      createInput({ attemptId: "attempt-expired", unavailableAt: "2026-07-13T08:01:00.000Z" }),
      createInput({ attemptId: "attempt-active", unavailableAt: "2026-07-13T08:01:00.000Z" }),
    ])
    await repository.claimWorkerAttempt({
      attemptId: "attempt-expired",
      expectedJournalRevision: 0,
      claimToken: "expired-claim",
      workerId: "expired-worker",
      claimedAt: "2026-07-13T08:01:00.000Z",
      expiresAt: "2026-07-13T08:02:00.000Z",
    })
    await repository.claimWorkerAttempt({
      attemptId: "attempt-active",
      expectedJournalRevision: 0,
      claimToken: "active-claim",
      workerId: "active-worker",
      claimedAt: "2026-07-13T08:01:00.000Z",
      expiresAt: "2026-07-13T08:04:00.000Z",
    })
    const before = await repository.readWorkerAttempt("attempt-expired")
    await expect(repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:03:00.000Z",
      maximumResultCount: 4,
      after: null,
    })).resolves.toMatchObject({
      status: "ready",
      entries: [{ attemptId: "attempt-expired", status: "claimed" }],
    })
    expect(await repository.readWorkerAttempt("attempt-expired")).toEqual(before)
  })

  it("updates the SQLite due projection after a runner transition and across restart", async () => {
    const { databasePath, repository } = await open()
    await seed(repository, [createInput({
      attemptId: "attempt-due-sqlite",
      unavailableAt: "2026-07-13T08:02:00.000Z",
    })])
    await expect(repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:00.000Z",
      maximumResultCount: 4,
      after: null,
    })).resolves.toMatchObject({ status: "ready", entries: [{ attemptId: "attempt-due-sqlite" }] })

    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1({
      journalRepository: repository,
      compositionRepository: createInMemoryFlowDocBackendCompositionRepositoryV1(),
      attemptId: "attempt-due-sqlite",
      workerId: "due-worker",
      claimToken: "due-claim",
      claimDurationMilliseconds: 60_000,
      clock: sequenceClock(
        "2026-07-13T08:02:00.000Z",
        "2026-07-13T08:02:00.010Z",
        "2026-07-13T08:02:00.020Z",
      ),
    })).resolves.toMatchObject({ status: "released", outcomeStatus: "retry-ready" })
    await expect(repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:00.249Z",
      maximumResultCount: 4,
      after: null,
    })).resolves.toMatchObject({ status: "ready", entries: [] })

    repository.close()
    const reopened = await open(databasePath)
    await expect(reopened.repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:00.250Z",
      maximumResultCount: 4,
      after: null,
    })).resolves.toMatchObject({
      status: "ready",
      entries: [{ attemptId: "attempt-due-sqlite", state: { phase: "retry-ready" } }],
    })
    await expect(reopened.repository.claimWorkerAttempt({
      attemptId: "attempt-due-sqlite",
      expectedJournalRevision: 3,
      claimToken: "due-expiring-claim",
      workerId: "due-expiring-worker",
      claimedAt: "2026-07-13T08:02:00.250Z",
      expiresAt: "2026-07-13T08:02:00.300Z",
    })).resolves.toMatchObject({ status: "claimed" })
    await expect(reopened.repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:00.299Z",
      maximumResultCount: 4,
      after: null,
    })).resolves.toMatchObject({ status: "ready", entries: [] })
    reopened.repository.close()
    const reclaimed = await open(databasePath)
    await expect(reclaimed.repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:00.300Z",
      maximumResultCount: 4,
      after: null,
    })).resolves.toMatchObject({
      status: "ready",
      entries: [{ attemptId: "attempt-due-sqlite", status: "claimed" }],
    })
    const { DatabaseSync } = await import("node:sqlite")
    const inspection = new DatabaseSync(databasePath, { readOnly: true })
    const queryPlan = inspection.prepare(`
      EXPLAIN QUERY PLAN
      SELECT attempt_id
      FROM composition_worker_attempts
      WHERE discoverable = 1 AND due_at <= ?
      ORDER BY due_at ASC, attempt_id ASC
      LIMIT ?
    `).all("2026-07-13T08:02:00.300Z", 5) as Array<{ detail: string }>
    inspection.close()
    expect(queryPlan.map((step) => step.detail).join(" ")).toContain("composition_worker_attempt_due_idx")
  })

  it("backfills not-before when opening a Phase 399 SQLite journal table", async () => {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-worker-due-migration-"))
    roots.push(root)
    const databasePath = join(root, "composition.sqlite")
    const input = createInput({ attemptId: "attempt-migrated", unavailableAt: "2026-07-13T08:02:00.000Z" })
    const memory = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await seed(memory, [input])
    const found = await memory.readWorkerAttempt(input.attemptId)
    if (found.status !== "found") throw new Error("migration fixture entry missing")
    const { DatabaseSync } = await import("node:sqlite")
    const database = new DatabaseSync(databasePath)
    database.exec(`
      CREATE TABLE composition_worker_attempts (
        attempt_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        mutation_fingerprint TEXT NOT NULL UNIQUE,
        journal_revision INTEGER NOT NULL CHECK (journal_revision >= 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'completed')),
        entry_fingerprint TEXT NOT NULL,
        entry_json TEXT NOT NULL
      ) STRICT;
    `)
    database.prepare(`
      INSERT INTO composition_worker_attempts (
        attempt_id, job_id, mutation_fingerprint, journal_revision, status,
        entry_fingerprint, entry_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      found.entry.attemptId,
      found.entry.jobId,
      found.entry.mutationFingerprint,
      found.entry.journalRevision,
      found.entry.status,
      found.entry.fingerprint,
      JSON.stringify(found.entry),
    )
    database.close()

    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
    repositories.push(repository)
    await expect(repository.listDueWorkerAttempts({
      observedAt: "2026-07-13T08:02:00.000Z",
      maximumResultCount: 1,
      after: null,
    })).resolves.toMatchObject({ status: "ready", entries: [{ attemptId: "attempt-migrated" }] })
  })

  it("runs one bounded sequential batch and fingerprints exact outcome counts", async () => {
    const journal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await seed(journal, [
      createInput({ attemptId: "attempt-a-retry", unavailableAt: "2026-07-13T08:02:00.000Z" }),
      createInput({
        attemptId: "attempt-b-exhausted",
        unavailableAt: "2026-07-13T08:02:00.000Z",
        completedWriteAttemptCount: 3,
      }),
    ])
    const result = await runFlowDocBackendCompositionDueWorkerBatchV1({
      journalRepository: journal,
      compositionRepository: createInMemoryFlowDocBackendCompositionRepositoryV1(),
      runId: "due-batch-1",
      workerId: "due-batch-worker",
      maximumResultCount: 2,
      after: null,
      claimDurationMilliseconds: 60_000,
      clock: sequenceClock(
        "2026-07-13T08:02:00.000Z",
        "2026-07-13T08:02:00.000Z",
        "2026-07-13T08:02:00.010Z",
        "2026-07-13T08:02:00.020Z",
        "2026-07-13T08:02:00.030Z",
        "2026-07-13T08:02:00.040Z",
        "2026-07-13T08:02:00.050Z",
      ),
    })
    expect(result).toMatchObject({
      status: "ready",
      attempts: [
        { attemptId: "attempt-a-retry", result: { status: "released", outcomeStatus: "retry-ready" } },
        { attemptId: "attempt-b-exhausted", result: { status: "completed", terminalStatus: "exhausted" } },
      ],
      report: {
        listedAttemptCount: 2,
        invokedAttemptCount: 2,
        nextCursor: null,
        outcomes: { released: 1, completed: 1 },
        terminals: { exhausted: 1 },
      },
    })
    if (result.status !== "ready") throw new Error("batch result was not ready")
    expect(result.report.outcomes).toEqual({
      released: 1,
      completed: 1,
      terminalReplay: 0,
      deferred: 0,
      busy: 0,
      ownershipLost: 0,
      blocked: 0,
      journalUnavailable: 0,
      executionInterrupted: 0,
      notFound: 0,
    })
    expect(result.report.terminals).toEqual({
      committed: 0,
      superseded: 0,
      conflict: 0,
      exhausted: 1,
      failed: 0,
      reconciliationExhausted: 0,
    })
    const { fingerprint, ...facts } = result.report
    expect(fingerprint).toBe(compositionFingerprint(facts))

    await expect(runFlowDocBackendCompositionDueWorkerBatchV1({
      journalRepository: journal,
      compositionRepository: createInMemoryFlowDocBackendCompositionRepositoryV1(),
      runId: "due-batch-2",
      workerId: "due-batch-worker",
      maximumResultCount: 2,
      after: null,
      claimDurationMilliseconds: 60_000,
      clock: sequenceClock("2026-07-13T08:02:00.100Z"),
    })).resolves.toMatchObject({
      status: "ready",
      attempts: [],
      report: { listedAttemptCount: 0, invokedAttemptCount: 0 },
    })
  })
})
