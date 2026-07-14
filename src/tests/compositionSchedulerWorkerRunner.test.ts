import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  compositionFingerprint,
  compositionIssue,
  createFlowDocBackendCompositionHeadUnavailableResultV1,
  createFlowDocBackendCompositionSqliteRepositoryV1,
  createFlowDocBackendCompositionWorkerStorageAttemptV1,
  createInMemoryFlowDocBackendCompositionRepositoryV1,
  createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  runFlowDocBackendCompositionWorkerAttemptOnceV1,
  type FlowDocBackendCompositionRepositoryV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionSqliteRepositoryV1,
  type FlowDocBackendCompositionWorkerHeadMutationV1,
  type FlowDocBackendCompositionWorkerJournalRepositoryV1,
  type FlowDocBackendCompositionWorkerRunnerClockV1,
} from "../index.js"
import { createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })
const unavailableAt = "2026-07-13T08:02:00.000Z"

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

function workerFacts(completedWriteAttemptCount = 1) {
  const fixture = createCompositionSchedulerFixture()
  const mutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
    operation: "head-create",
    input: {
      createRequestId: "runner-head-create",
      requestFingerprint: fp("runner-head-create"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    },
  }
  const unavailable = createFlowDocBackendCompositionHeadUnavailableResultV1({
    operation: "head-create",
    reconcileWith: "create-request",
    message: "runner fixture unavailable",
  })
  const state = createFlowDocBackendCompositionWorkerStorageAttemptV1({
    mutation,
    unavailable,
    completedWriteAttemptCount,
    unavailableAt,
  })
  if (state.status === "blocked") throw new Error(state.issues[0]?.message)
  return {
    fixture,
    mutation,
    state: state.state,
    create: {
      attemptId: "runner-attempt-1",
      createRequestId: "runner-journal-create",
      createRequestFingerprint: fp("runner-journal-create"),
      mutation,
      state: state.state,
      createdAt: unavailableAt,
    },
  }
}

function leasedHead(
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
  token: string,
): FlowDocBackendCompositionJobHeadV1 {
  const { fingerprint: _fingerprint, ...facts } = fixture.waitingHead
  const result = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    value: {
      ...facts,
      headRevision: 1,
      lease: {
        attemptId: `runner-lease-${token}`,
        leaseToken: token,
        acquiredAt: "2026-07-13T08:01:00.000Z",
        expiresAt: "2026-07-13T08:05:00.000Z",
      },
      retry: { attemptCount: 1, retryAfter: null },
      updatedAt: "2026-07-13T08:01:00.000Z",
    },
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.jobHead
}

function casWorkerFacts() {
  const fixture = createCompositionSchedulerFixture()
  const mutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
    operation: "head-compare-and-swap",
    input: {
      jobId: fixture.waitingHead.jobId,
      expectedHeadRevision: fixture.waitingHead.headRevision,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: leasedHead(fixture, "target"),
    },
  }
  const unavailable = createFlowDocBackendCompositionHeadUnavailableResultV1({
    operation: mutation.operation,
    reconcileWith: "head-read",
    message: "runner CAS fixture unavailable",
  })
  const state = createFlowDocBackendCompositionWorkerStorageAttemptV1({
    mutation,
    unavailable,
    completedWriteAttemptCount: 1,
    unavailableAt,
  })
  if (state.status === "blocked") throw new Error(state.issues[0]?.message)
  return {
    fixture,
    mutation,
    state: state.state,
    create: {
      attemptId: "runner-attempt-1",
      createRequestId: "runner-cas-journal-create",
      createRequestFingerprint: fp("runner-cas-journal-create"),
      mutation,
      state: state.state,
      createdAt: unavailableAt,
    },
  }
}

async function createJournal(
  repository: FlowDocBackendCompositionWorkerJournalRepositoryV1,
  facts: {
    create: Parameters<FlowDocBackendCompositionWorkerJournalRepositoryV1["createWorkerAttempt"]>[0]
  } = workerFacts(),
) {
  const created = await repository.createWorkerAttempt(facts.create)
  if (created.status !== "created") throw new Error(`journal setup failed: ${created.status}`)
}

function runnerInput(input: {
  journalRepository: FlowDocBackendCompositionWorkerJournalRepositoryV1
  compositionRepository: FlowDocBackendCompositionRepositoryV1
  clock: FlowDocBackendCompositionWorkerRunnerClockV1
  claimToken: string
  claimDurationMilliseconds?: number
}) {
  return {
    journalRepository: input.journalRepository,
    compositionRepository: input.compositionRepository,
    attemptId: "runner-attempt-1",
    workerId: `worker-${input.claimToken}`,
    claimToken: input.claimToken,
    claimDurationMilliseconds: input.claimDurationMilliseconds ?? 60_000,
    clock: input.clock,
  }
}

describe("composition scheduler one-step worker runner", () => {
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

  async function open(databasePath?: string, faultInjector?: Parameters<
    typeof createFlowDocBackendCompositionSqliteRepositoryV1
  >[0]["faultInjector"]) {
    const root = databasePath == null ? mkdtempSync(join(tmpdir(), "flowdoc-worker-runner-")) : null
    if (root != null) roots.push(root)
    const selectedPath = databasePath ?? join(root!, "composition.sqlite")
    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
      databasePath: selectedPath,
      faultInjector,
    })
    repositories.push(repository)
    return { databasePath: selectedPath, repository }
  }

  it("reconciles, retries once, completes, and replays without another write", async () => {
    const journal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(journal)
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    let writeCount = 0
    const composition: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async createHead(input) {
        writeCount += 1
        return base.createHead(input)
      },
    }

    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: journal,
      compositionRepository: composition,
      claimToken: "reconcile",
      clock: sequenceClock(
        "2026-07-13T08:02:00.000Z",
        "2026-07-13T08:02:00.010Z",
        "2026-07-13T08:02:00.020Z",
      ),
    }))).resolves.toMatchObject({
      status: "released",
      action: "reconcile",
      outcomeStatus: "retry-ready",
      entry: { journalRevision: 3, status: "pending", state: { phase: "retry-ready" } },
    })
    expect(writeCount).toBe(0)

    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: journal,
      compositionRepository: composition,
      claimToken: "retry",
      clock: sequenceClock(
        "2026-07-13T08:02:00.250Z",
        "2026-07-13T08:02:00.260Z",
        "2026-07-13T08:02:00.270Z",
      ),
    }))).resolves.toMatchObject({
      status: "completed",
      action: "retry",
      outcomeStatus: "committed",
      terminalStatus: "committed",
      entry: { journalRevision: 6, status: "completed" },
    })
    expect(writeCount).toBe(1)

    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: journal,
      compositionRepository: composition,
      claimToken: "duplicate",
      clock: sequenceClock("2026-07-13T08:02:01.000Z"),
    }))).resolves.toMatchObject({ status: "terminal-replay", terminalStatus: "committed" })
    expect(writeCount).toBe(1)
  })

  it("releases unavailable reconciliation and terminates its separate read budget", async () => {
    const journal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(journal)
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const unavailableReads: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async readHeadCreation() {
        throw new Error("read unavailable")
      },
    }

    for (const [index, time] of [
      "2026-07-13T08:02:00.000Z",
      "2026-07-13T08:02:00.260Z",
      "2026-07-13T08:02:00.770Z",
    ].entries()) {
      const result = await runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
        journalRepository: journal,
        compositionRepository: unavailableReads,
        claimToken: `read-${index}`,
        clock: sequenceClock(time, new Date(Date.parse(time) + 5).toISOString(), new Date(Date.parse(time) + 10).toISOString()),
      }))
      expect(result).toMatchObject(index < 2
        ? { status: "released", outcomeStatus: "reconciliation-unavailable" }
        : { status: "completed", outcomeStatus: "reconciliation-exhausted", terminalStatus: "reconciliation-exhausted" })
    }
  })

  it("maps exhausted, conflict, failed, and superseded evidence to immutable terminals", async () => {
    const exhaustedJournal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(exhaustedJournal, workerFacts(3))
    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: exhaustedJournal,
      compositionRepository: createInMemoryFlowDocBackendCompositionRepositoryV1(),
      claimToken: "terminal-exhausted",
      clock: sequenceClock(unavailableAt, unavailableAt, "2026-07-13T08:02:00.010Z"),
    }))).resolves.toMatchObject({
      status: "completed",
      outcomeStatus: "exhausted",
      terminalStatus: "exhausted",
    })

    const conflictFacts = workerFacts()
    if (conflictFacts.mutation.operation !== "head-create") throw new Error("expected create fixture")
    const conflictJournal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(conflictJournal, conflictFacts)
    const conflictRepository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await conflictRepository.createHead({
      ...conflictFacts.mutation.input,
      createRequestId: "other-create-request",
      requestFingerprint: fp("other-create-request"),
    })
    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: conflictJournal,
      compositionRepository: conflictRepository,
      claimToken: "terminal-conflict",
      clock: sequenceClock(unavailableAt, unavailableAt, "2026-07-13T08:02:00.010Z"),
    }))).resolves.toMatchObject({
      status: "completed",
      outcomeStatus: "conflict",
      terminalStatus: "conflict",
    })

    const failedJournal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(failedJournal)
    const failedBase = createInMemoryFlowDocBackendCompositionRepositoryV1()
    const failedRepository: FlowDocBackendCompositionRepositoryV1 = {
      ...failedBase,
      async readHeadCreation() {
        return {
          status: "invalid",
          createRequestId: null,
          requestFingerprint: null,
          head: null,
          issues: [compositionIssue("test-invalid-evidence", "repository", "invalid retained evidence")],
        }
      },
    }
    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: failedJournal,
      compositionRepository: failedRepository,
      claimToken: "terminal-failed",
      clock: sequenceClock(unavailableAt, unavailableAt, "2026-07-13T08:02:00.010Z"),
    }))).resolves.toMatchObject({
      status: "completed",
      outcomeStatus: "failed",
      terminalStatus: "failed",
    })

    const supersededFacts = casWorkerFacts()
    const supersededJournal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(supersededJournal, supersededFacts)
    const supersededRepository = createInMemoryFlowDocBackendCompositionRepositoryV1()
    await supersededRepository.createHead({
      createRequestId: "superseded-create",
      requestFingerprint: fp("superseded-create"),
      sourcePin: supersededFacts.fixture.sourcePin,
      manifest: supersededFacts.fixture.manifest,
      head: supersededFacts.fixture.waitingHead,
    })
    await supersededRepository.compareAndSwapHead({
      jobId: supersededFacts.fixture.waitingHead.jobId,
      expectedHeadRevision: supersededFacts.fixture.waitingHead.headRevision,
      expectedHeadFingerprint: supersededFacts.fixture.waitingHead.fingerprint,
      nextHead: leasedHead(supersededFacts.fixture, "other"),
    })
    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: supersededJournal,
      compositionRepository: supersededRepository,
      claimToken: "terminal-superseded",
      clock: sequenceClock(unavailableAt, unavailableAt, "2026-07-13T08:02:00.010Z"),
    }))).resolves.toMatchObject({
      status: "completed",
      outcomeStatus: "superseded",
      terminalStatus: "superseded",
    })
  })

  it("admits one competing runner and performs one composition read", async () => {
    const journal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(journal)
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    let readCount = 0
    const composition: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async readHeadCreation(jobId) {
        readCount += 1
        return base.readHeadCreation(jobId)
      },
    }
    const results = await Promise.all(["a", "b"].map((token) => runFlowDocBackendCompositionWorkerAttemptOnceV1(
      runnerInput({
        journalRepository: journal,
        compositionRepository: composition,
        claimToken: `race-${token}`,
        clock: sequenceClock(
          "2026-07-13T08:02:00.000Z",
          "2026-07-13T08:02:00.010Z",
          "2026-07-13T08:02:00.020Z",
        ),
      }),
    )))
    expect(results.filter((result) => result.status === "released")).toHaveLength(1)
    expect(results.filter((result) => result.status === "busy")).toHaveLength(1)
    expect(readCount).toBe(1)
  })

  it("does not execute duplicate delivery carrying the same claim token", async () => {
    const journal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(journal)
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    let readCount = 0
    const composition: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async readHeadCreation(jobId) {
        readCount += 1
        return base.readHeadCreation(jobId)
      },
    }
    const input = () => runnerInput({
      journalRepository: journal,
      compositionRepository: composition,
      claimToken: "same-delivery",
      clock: sequenceClock(
        "2026-07-13T08:02:00.000Z",
        "2026-07-13T08:02:00.010Z",
        "2026-07-13T08:02:00.020Z",
      ),
    })
    const results = await Promise.all([
      runFlowDocBackendCompositionWorkerAttemptOnceV1(input()),
      runFlowDocBackendCompositionWorkerAttemptOnceV1(input()),
    ])
    expect(results.filter((result) => result.status === "released")).toHaveLength(1)
    expect(results.filter((result) => result.status === "busy")).toHaveLength(1)
    expect(readCount).toBe(1)
  })

  it("reconciles an expired in-flight retry before permitting another write", async () => {
    const journal = createInMemoryFlowDocBackendCompositionWorkerJournalRepositoryV1()
    await createJournal(journal)
    const base = createInMemoryFlowDocBackendCompositionRepositoryV1()
    let writeCount = 0
    const composition: FlowDocBackendCompositionRepositoryV1 = {
      ...base,
      async createHead(input) {
        writeCount += 1
        return base.createHead(input)
      },
    }
    await runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: journal,
      compositionRepository: composition,
      claimToken: "prepare-retry",
      clock: sequenceClock(
        "2026-07-13T08:02:00.000Z",
        "2026-07-13T08:02:00.010Z",
        "2026-07-13T08:02:00.020Z",
      ),
    }))

    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: journal,
      compositionRepository: composition,
      claimToken: "expired-writer",
      claimDurationMilliseconds: 100,
      clock: sequenceClock(
        "2026-07-13T08:02:00.250Z",
        "2026-07-13T08:02:00.260Z",
        "2026-07-13T08:02:00.350Z",
      ),
    }))).resolves.toMatchObject({ status: "ownership-lost" })
    expect(writeCount).toBe(1)

    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: journal,
      compositionRepository: composition,
      claimToken: "recovery",
      clock: sequenceClock(
        "2026-07-13T08:02:00.350Z",
        "2026-07-13T08:02:00.360Z",
        "2026-07-13T08:02:00.370Z",
      ),
    }))).resolves.toMatchObject({
      status: "released",
      action: "recover-interrupted-retry",
      outcomeStatus: "interrupted-retry-recovered",
      entry: { state: { phase: "reconcile", completedWriteAttemptCount: 2 } },
    })
    expect(writeCount).toBe(1)

    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: journal,
      compositionRepository: composition,
      claimToken: "reconcile-committed",
      clock: sequenceClock(
        "2026-07-13T08:02:00.380Z",
        "2026-07-13T08:02:00.390Z",
        "2026-07-13T08:02:00.400Z",
      ),
    }))).resolves.toMatchObject({
      status: "completed",
      action: "reconcile",
      outcomeStatus: "committed",
    })
    expect(writeCount).toBe(1)
  })

  it("reopens an after-commit SQLite completion as terminal replay", async () => {
    const initial = await open()
    const facts = workerFacts()
    await createJournal(initial.repository, facts)
    await initial.repository.close()
    let injected = false
    const faulted = await open(initial.databasePath, (context) => {
      if (!injected && context.transactionKind === "worker-journal-complete" && context.point === "after-commit") {
        injected = true
        throw new Error("injected-runner-complete-after-commit")
      }
    })
    await faulted.repository.createHead(facts.mutation.input)
    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: faulted.repository,
      compositionRepository: faulted.repository,
      claimToken: "sqlite-complete",
      clock: sequenceClock(
        "2026-07-13T08:02:00.000Z",
        "2026-07-13T08:02:00.010Z",
        "2026-07-13T08:02:00.020Z",
      ),
    }))).resolves.toMatchObject({ status: "journal-unavailable" })
    faulted.repository.close()

    const reopened = await open(initial.databasePath)
    await expect(runFlowDocBackendCompositionWorkerAttemptOnceV1(runnerInput({
      journalRepository: reopened.repository,
      compositionRepository: reopened.repository,
      claimToken: "sqlite-replay",
      clock: sequenceClock("2026-07-13T08:02:01.000Z"),
    }))).resolves.toMatchObject({ status: "terminal-replay", terminalStatus: "committed" })
  })
})
