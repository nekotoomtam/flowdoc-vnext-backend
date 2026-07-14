import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  cancelFlowDocBackendCompositionV1,
  compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1,
  compositionFingerprint,
  createFlowDocBackendCompositionHeadWithAvailabilityV1,
  createFlowDocBackendCompositionSqliteRepositoryV1,
  createFlowDocBackendCompositionWorkerStorageAttemptV1,
  finalizeFlowDocBackendCompositionV1,
  finalizeFlowDocBackendCompositionJobHeadV1,
  reconcileFlowDocBackendCompositionWorkerStorageAttemptV1,
  retryFlowDocBackendCompositionWorkerStorageAttemptV1,
  supportsFlowDocBackendCompositionSqliteCandidateV1,
  type FlowDocBackendCompositionJobHeadV1,
  type FlowDocBackendCompositionRepositoryV1,
  type FlowDocBackendCompositionSqliteRepositoryV1,
  type FlowDocBackendCompositionWorkerHeadMutationV1,
} from "../index.js"
import { contentRef, createCompositionSchedulerFixture } from "./helpers/compositionSchedulerFixture.js"

const fp = (value: string) => compositionFingerprint({ value })
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8")

function leasedHead(
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
  leaseToken: string,
): FlowDocBackendCompositionJobHeadV1 {
  const { fingerprint: _fingerprint, ...facts } = fixture.waitingHead
  const result = finalizeFlowDocBackendCompositionJobHeadV1({
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    value: {
      ...facts,
      headRevision: 1,
      lease: {
        attemptId: `attempt-${leaseToken}`,
        leaseToken,
        acquiredAt: "2026-07-13T08:00:00.000Z",
        expiresAt: "2026-07-13T08:05:00.000Z",
      },
    },
  })
  if (result.status === "blocked") throw new Error(result.issues[0]?.message)
  return result.jobHead
}

async function seedLeasedTransition(
  repository: FlowDocBackendCompositionRepositoryV1,
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
) {
  await repository.createHead({
    createRequestId: "create-worker-finalization",
    requestFingerprint: fp("create-worker-finalization"),
    sourcePin: fixture.sourcePin,
    manifest: fixture.manifest,
    head: fixture.waitingHead,
  })
  const windowRef = fixture.receipt.windowRef
  const pageChunkRef = fixture.receipt.pageChunkRef
  if (windowRef == null || pageChunkRef == null) throw new Error("worker fixture requires transition outputs")
  const receiptRef = contentRef(
    fixture.sourcePin.jobId,
    "transition-receipt",
    "worker-transition-receipt",
    fixture.receipt.fingerprint,
    bytes(fixture.receipt),
  )
  for (const [ref, value] of [
    [windowRef, fixture.window],
    [pageChunkRef, fixture.pageChunk],
    [receiptRef, fixture.receipt],
  ] as const) await repository.putImmutable({ ref, value })
  const leased = leasedHead(fixture, "worker-finalization")
  const acquired = await repository.compareAndSwapHead({
    jobId: fixture.sourcePin.jobId,
    expectedHeadRevision: fixture.waitingHead.headRevision,
    expectedHeadFingerprint: fixture.waitingHead.fingerprint,
    nextHead: leased,
  })
  if (acquired.status !== "committed") throw new Error(`worker seed lease failed: ${acquired.status}`)
  return { leased, receiptRef }
}

async function seedReadyToFinalize(
  repository: FlowDocBackendCompositionRepositoryV1,
  fixture: ReturnType<typeof createCompositionSchedulerFixture>,
) {
  const { leased, receiptRef } = await seedLeasedTransition(repository, fixture)
  const committed = await repository.compareAndSwapHead({
    jobId: fixture.sourcePin.jobId,
    expectedHeadRevision: leased.headRevision,
    expectedHeadFingerprint: leased.fingerprint,
    nextHead: fixture.readyToFinalizeHead,
    committedRequest: {
      requestId: fixture.receipt.transitionRequestId,
      requestFingerprint: fixture.receipt.requestFingerprint,
      receiptRef,
    },
  })
  if (committed.status !== "committed") throw new Error(`worker seed transition failed: ${committed.status}`)
  return { leased, receiptRef }
}

describe("composition scheduler SQLite repository candidate", () => {
  const roots: string[] = []
  const repositories: FlowDocBackendCompositionSqliteRepositoryV1[] = []

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      try {
        repository.close()
      } catch {
        // A test may close a repository before reopening it.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function open(root?: string) {
    const selectedRoot = root ?? mkdtempSync(join(tmpdir(), "flowdoc-composition-sqlite-"))
    if (root == null) roots.push(selectedRoot)
    const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
      databasePath: join(selectedRoot, "composition.sqlite"),
    })
    repositories.push(repository)
    return { root: selectedRoot, repository }
  }

  it("keeps the candidate behind its explicit Node runtime floor", () => {
    expect(supportsFlowDocBackendCompositionSqliteCandidateV1("24.15.0")).toBe(true)
    expect(supportsFlowDocBackendCompositionSqliteCandidateV1("24.14.9")).toBe(false)
    expect(supportsFlowDocBackendCompositionSqliteCandidateV1("22.13.0")).toBe(false)
    expect(supportsFlowDocBackendCompositionSqliteCandidateV1()).toBe(true)
  })

  it("admits immutable batches atomically with exact replay and first-write accounting", async () => {
    const fixture = createCompositionSchedulerFixture()
    const { repository } = await open()
    const values = ["a", "b", "c", "d"].map((name) => ({ fingerprint: fp(`batch-${name}`) }))
    const refs = values.map((value, index) => contentRef(
      fixture.sourcePin.jobId,
      "family-window",
      `batch-${index}`,
      value.fingerprint,
      bytes(value),
    ))
    const storedAt = "2026-07-13T07:00:00.000Z"
    await expect(repository.putImmutableBatchWithPhysicalAdmission({
      records: [{ ref: refs[0], value: values[0] }, { ref: refs[1], value: values[1] }],
      storedAt,
      maximumPhysicalByteCount: refs[0]!.byteLength,
    })).resolves.toMatchObject({ status: "physical-quota-exceeded", writtenRecordCount: 0 })
    await expect(repository.readImmutable({ jobId: fixture.sourcePin.jobId, recordId: refs[0]!.recordId }))
      .resolves.toMatchObject({ status: "not-found" })
    await expect(repository.readImmutable({ jobId: fixture.sourcePin.jobId, recordId: refs[1]!.recordId }))
      .resolves.toMatchObject({ status: "not-found" })

    const maximumPhysicalByteCount = refs.reduce((total, ref) => total + ref.byteLength, 0)
    const first = await repository.putImmutableBatchWithPhysicalAdmission({
      records: [{ ref: refs[0], value: values[0] }, { ref: refs[1], value: values[1] }],
      storedAt,
      maximumPhysicalByteCount,
    })
    expect(first).toMatchObject({
      status: "written",
      writtenRecordCount: 2,
      usage: { recordCount: 2, byteCount: refs[0]!.byteLength + refs[1]!.byteLength },
    })
    await expect(repository.putImmutableBatchWithPhysicalAdmission({
      records: [{ ref: refs[0], value: values[0] }, { ref: refs[1], value: values[1] }],
      storedAt,
      maximumPhysicalByteCount,
    })).resolves.toMatchObject({ status: "idempotent-replay", writtenRecordCount: 0 })
    await expect(repository.putImmutableBatchWithPhysicalAdmission({
      records: [{ ref: refs[0], value: values[0] }, { ref: refs[2], value: values[2] }],
      storedAt,
      maximumPhysicalByteCount,
    })).resolves.toMatchObject({ status: "written", writtenRecordCount: 1, usage: { recordCount: 3 } })

    const conflictingValue = { fingerprint: fp("batch-conflict") }
    const conflictingRef = contentRef(
      fixture.sourcePin.jobId,
      "family-window",
      refs[0]!.recordId,
      conflictingValue.fingerprint,
      bytes(conflictingValue),
    )
    await expect(repository.putImmutableBatchWithPhysicalAdmission({
      records: [{ ref: refs[3], value: values[3] }, { ref: conflictingRef, value: conflictingValue }],
      storedAt,
      maximumPhysicalByteCount,
    })).resolves.toMatchObject({ status: "conflict", writtenRecordCount: 0 })
    await expect(repository.readImmutable({ jobId: fixture.sourcePin.jobId, recordId: refs[3]!.recordId }))
      .resolves.toMatchObject({ status: "not-found" })
    await expect(repository.inspectPhysicalUsage(fixture.sourcePin.jobId)).resolves.toMatchObject({
      status: "ready",
      usage: { recordCount: 3, byteCount: refs[0]!.byteLength + refs[1]!.byteLength + refs[2]!.byteLength },
    })
  })

  it("keeps the whole immutable batch on one side of the commit crash boundary", async () => {
    const fixture = createCompositionSchedulerFixture()
    for (const point of ["before-commit", "after-commit"] as const) {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-composition-batch-${point}-`))
      roots.push(root)
      const databasePath = join(root, "composition.sqlite")
      let injected = false
      const faulted = await createFlowDocBackendCompositionSqliteRepositoryV1({
        databasePath,
        faultInjector(context) {
          if (!injected && context.transactionKind === "immutable-write" && context.point === point) {
            injected = true
            throw new Error(`injected-${point}`)
          }
        },
      })
      repositories.push(faulted)
      const values = [0, 1].map((index) => ({ fingerprint: fp(`${point}-${index}`) }))
      const refs = values.map((value, index) => contentRef(
        fixture.sourcePin.jobId,
        "family-window",
        `${point}-${index}`,
        value.fingerprint,
        bytes(value),
      ))
      await expect(faulted.putImmutableBatchWithPhysicalAdmission({
        records: [{ ref: refs[0], value: values[0] }, { ref: refs[1], value: values[1] }],
        storedAt: "2026-07-13T07:00:00.000Z",
        maximumPhysicalByteCount: 10_000,
      })).rejects.toThrow(`injected-${point}`)
      faulted.close()

      const reopened = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
      repositories.push(reopened)
      const expectedStatus = point === "before-commit" ? "not-found" : "found"
      await expect(reopened.readImmutable({ jobId: fixture.sourcePin.jobId, recordId: refs[0]!.recordId }))
        .resolves.toMatchObject({ status: expectedStatus })
      await expect(reopened.readImmutable({ jobId: fixture.sourcePin.jobId, recordId: refs[1]!.recordId }))
        .resolves.toMatchObject({ status: expectedStatus })
      const usage = await reopened.inspectPhysicalUsage(fixture.sourcePin.jobId)
      if (point === "before-commit") expect(usage).toMatchObject({ status: "not-found" })
      else expect(usage).toMatchObject({ status: "ready", usage: { recordCount: 2 } })
    }
  })

  it("reconciles unknown head create outcomes through the exact create request", async () => {
    const fixture = createCompositionSchedulerFixture()
    for (const point of ["before-commit", "after-commit"] as const) {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-composition-create-availability-${point}-`))
      roots.push(root)
      const databasePath = join(root, "composition.sqlite")
      let injected = false
      const faulted = await createFlowDocBackendCompositionSqliteRepositoryV1({
        databasePath,
        faultInjector(context) {
          if (!injected && context.transactionKind === "head-create" && context.point === point) {
            injected = true
            throw new Error(`injected-create-${point}`)
          }
        },
      })
      repositories.push(faulted)
      const input = {
        createRequestId: `create-availability-${point}`,
        requestFingerprint: fp(`create-availability-${point}`),
        sourcePin: fixture.sourcePin,
        manifest: fixture.manifest,
        head: fixture.waitingHead,
      }
      const unavailable = await createFlowDocBackendCompositionHeadWithAvailabilityV1(faulted, input)
      expect(unavailable).toMatchObject({
        status: "unavailable",
        availability: { commitState: "unknown", reconcileWith: "create-request" },
      })
      if (unavailable.status !== "unavailable") throw new Error("create fault did not become unavailable")
      const mutation = { operation: "head-create" as const, input }
      const pending = createFlowDocBackendCompositionWorkerStorageAttemptV1({
        mutation,
        unavailable,
        completedWriteAttemptCount: 1,
        unavailableAt: "2026-07-13T08:01:00.000Z",
      })
      if (pending.status === "blocked") throw new Error(pending.issues[0]?.message)
      faulted.close()
      const reopened = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
      repositories.push(reopened)
      const reconciled = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
        repository: reopened,
        mutation,
        state: pending.state,
        observedAt: "2026-07-13T08:01:00.000Z",
      })
      if (point === "after-commit") expect(reconciled).toMatchObject({ status: "committed", evidence: "create-request" })
      else {
        expect(reconciled).toMatchObject({ status: "retry-ready", evidence: "create-request" })
        if (reconciled.status !== "retry-ready") throw new Error("create reconciliation did not prepare retry")
        await expect(retryFlowDocBackendCompositionWorkerStorageAttemptV1({
          repository: reopened,
          mutation,
          state: reconciled.state,
          startedAt: reconciled.state.retryNotBefore,
        })).resolves.toMatchObject({ status: "committed" })
      }
      await expect(reopened.readHeadCreation(fixture.sourcePin.jobId)).resolves.toMatchObject({
        status: "found",
        createRequestId: input.createRequestId,
        requestFingerprint: input.requestFingerprint,
      })
    }
  })

  it("reconciles unknown head CAS outcomes by reading the exact next head", async () => {
    const fixture = createCompositionSchedulerFixture()
    for (const point of ["before-commit", "after-commit"] as const) {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-composition-cas-availability-${point}-`))
      roots.push(root)
      const databasePath = join(root, "composition.sqlite")
      let injected = false
      const faulted = await createFlowDocBackendCompositionSqliteRepositoryV1({
        databasePath,
        faultInjector(context) {
          if (!injected && context.transactionKind === "head-cas" && context.point === point) {
            injected = true
            throw new Error(`injected-cas-${point}`)
          }
        },
      })
      repositories.push(faulted)
      await faulted.createHead({
        createRequestId: `create-cas-availability-${point}`,
        requestFingerprint: fp(`create-cas-availability-${point}`),
        sourcePin: fixture.sourcePin,
        manifest: fixture.manifest,
        head: fixture.waitingHead,
      })
      const nextHead = leasedHead(fixture, `availability-${point}`)
      const input = {
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: fixture.waitingHead.headRevision,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
        nextHead,
      }
      const unavailable = await compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1(faulted, input)
      expect(unavailable).toMatchObject({
        status: "unavailable",
        availability: { commitState: "unknown", reconcileWith: "head-read" },
      })
      if (unavailable.status !== "unavailable") throw new Error("CAS fault did not become unavailable")
      const mutation = { operation: "head-compare-and-swap" as const, input }
      const pending = createFlowDocBackendCompositionWorkerStorageAttemptV1({
        mutation,
        unavailable,
        completedWriteAttemptCount: 1,
        unavailableAt: "2026-07-13T08:01:00.000Z",
      })
      if (pending.status === "blocked") throw new Error(pending.issues[0]?.message)
      faulted.close()
      const reopened = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
      repositories.push(reopened)
      const reconciled = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
        repository: reopened,
        mutation,
        state: pending.state,
        observedAt: "2026-07-13T08:01:00.000Z",
      })
      if (point === "after-commit") expect(reconciled).toMatchObject({ status: "committed", evidence: "head-read" })
      else {
        expect(reconciled).toMatchObject({ status: "retry-ready", evidence: "head-read" })
        if (reconciled.status !== "retry-ready") throw new Error("CAS reconciliation did not prepare retry")
        await expect(retryFlowDocBackendCompositionWorkerStorageAttemptV1({
          repository: reopened,
          mutation,
          state: reconciled.state,
          startedAt: reconciled.state.retryNotBefore,
        })).resolves.toMatchObject({ status: "committed" })
      }
      await expect(reopened.readHead(fixture.sourcePin.jobId)).resolves.toMatchObject({
        status: "found",
        head: { headRevision: nextHead.headRevision, fingerprint: nextHead.fingerprint },
      })
    }
  })

  it("recovers one committed transition outcome across before/after-commit restart", async () => {
    const fixture = createCompositionSchedulerFixture()
    for (const point of ["before-commit", "after-commit"] as const) {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-composition-worker-request-${point}-`))
      roots.push(root)
      const databasePath = join(root, "composition.sqlite")
      let armed = false
      const faulted = await createFlowDocBackendCompositionSqliteRepositoryV1({
        databasePath,
        faultInjector(context) {
          if (armed && context.transactionKind === "head-cas" && context.point === point) {
            armed = false
            throw new Error(`injected-worker-request-${point}`)
          }
        },
      })
      repositories.push(faulted)
      const { leased, receiptRef } = await seedLeasedTransition(faulted, fixture)
      const mutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
        operation: "head-compare-and-swap",
        input: {
          jobId: fixture.sourcePin.jobId,
          expectedHeadRevision: leased.headRevision,
          expectedHeadFingerprint: leased.fingerprint,
          nextHead: fixture.readyToFinalizeHead,
          committedRequest: {
            requestId: fixture.receipt.transitionRequestId,
            requestFingerprint: fixture.receipt.requestFingerprint,
            receiptRef,
          },
        },
      }
      armed = true
      const unavailable = await compareAndSwapFlowDocBackendCompositionHeadWithAvailabilityV1(
        faulted,
        mutation.input,
      )
      expect(unavailable).toMatchObject({
        status: "unavailable",
        availability: { reconcileWith: "committed-request" },
      })
      if (unavailable.status !== "unavailable") throw new Error("transition fault did not become unavailable")
      const pending = createFlowDocBackendCompositionWorkerStorageAttemptV1({
        mutation,
        unavailable,
        completedWriteAttemptCount: 1,
        unavailableAt: "2026-07-13T08:01:00.000Z",
      })
      if (pending.status === "blocked") throw new Error(pending.issues[0]?.message)
      faulted.close()

      const reopened = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
      repositories.push(reopened)
      if (point === "after-commit") {
        const retained = await reopened.readCommittedRequest({
          jobId: fixture.sourcePin.jobId,
          requestId: fixture.receipt.transitionRequestId,
        })
        expect(retained).toMatchObject({ status: "found" })
        if (retained.status !== "found") throw new Error("committed transition evidence is missing")
        expect(retained.requestFingerprint).toBe(mutation.input.committedRequest!.requestFingerprint)
        expect(retained.receiptRef).toEqual(mutation.input.committedRequest!.receiptRef)
        expect(retained.head).toEqual(mutation.input.nextHead)
      }
      const reconciled = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
        repository: reopened,
        mutation,
        state: pending.state,
        observedAt: "2026-07-13T08:01:00.000Z",
      })
      if (point === "after-commit") expect(reconciled).toMatchObject({
        status: "committed",
        evidence: "committed-request",
      })
      else {
        expect(reconciled).toMatchObject({ status: "retry-ready", evidence: "committed-request" })
        if (reconciled.status !== "retry-ready") throw new Error("transition reconciliation did not prepare retry")
        await expect(retryFlowDocBackendCompositionWorkerStorageAttemptV1({
          repository: reopened,
          mutation,
          state: reconciled.state,
          startedAt: reconciled.state.retryNotBefore,
        })).resolves.toMatchObject({ status: "committed" })
      }
      await expect(reopened.readCommittedRequest({
        jobId: fixture.sourcePin.jobId,
        requestId: fixture.receipt.transitionRequestId,
      })).resolves.toMatchObject({
        status: "found",
        requestFingerprint: fixture.receipt.requestFingerprint,
        receiptRef,
        head: fixture.readyToFinalizeHead,
      })
    }
  })

  it("recovers one finalization outcome across before/after-commit restart", async () => {
    const fixture = createCompositionSchedulerFixture()
    for (const point of ["before-commit", "after-commit"] as const) {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-composition-worker-finalization-${point}-`))
      roots.push(root)
      const databasePath = join(root, "composition.sqlite")
      let armed = false
      const faulted = await createFlowDocBackendCompositionSqliteRepositoryV1({
        databasePath,
        faultInjector(context) {
          if (armed && context.transactionKind === "head-cas" && context.point === point) {
            armed = false
            throw new Error(`injected-worker-finalization-${point}`)
          }
        },
      })
      repositories.push(faulted)
      await seedReadyToFinalize(faulted, fixture)
      const captured: { value: Parameters<FlowDocBackendCompositionRepositoryV1["compareAndSwapHead"]>[0] | null } = {
        value: null,
      }
      const repository = {
        ...faulted,
        async compareAndSwapHeadWithAvailability(
          input: Parameters<FlowDocBackendCompositionRepositoryV1["compareAndSwapHead"]>[0],
        ) {
          if (input.committedFinalization != null) {
            captured.value = input
            armed = true
          }
          return faulted.compareAndSwapHeadWithAvailability(input)
        },
      }
      const finalized = await finalizeFlowDocBackendCompositionV1({
        repository,
        request: {
          requestId: `worker-finalization-${point}`,
          jobId: fixture.sourcePin.jobId,
          expectedHeadRevision: fixture.readyToFinalizeHead.headRevision,
          expectedHeadFingerprint: fixture.readyToFinalizeHead.fingerprint,
        },
        attempt: {
          attemptId: `worker-finalization-attempt-${point}`,
          leaseToken: `worker-finalization-lease-${point}`,
          acquiredAt: "2026-07-13T08:02:00.000Z",
          completedAt: "2026-07-13T08:02:01.000Z",
          leaseExpiresAt: "2026-07-13T08:05:00.000Z",
        },
      })
      expect(finalized).toMatchObject({
        status: "unavailable",
        availability: { reconcileWith: "committed-finalization" },
      })
      if (finalized.status !== "unavailable" || finalized.availability == null || captured.value == null) {
        throw new Error(`finalization fault was not captured: ${finalized.status}`)
      }
      const mutation: FlowDocBackendCompositionWorkerHeadMutationV1 = {
        operation: "head-compare-and-swap",
        input: captured.value,
      }
      const unavailable = {
        status: "unavailable" as const,
        head: null,
        availability: finalized.availability,
        issues: finalized.issues,
      }
      const pending = createFlowDocBackendCompositionWorkerStorageAttemptV1({
        mutation,
        unavailable,
        completedWriteAttemptCount: 1,
        unavailableAt: "2026-07-13T08:02:01.000Z",
      })
      if (pending.status === "blocked") throw new Error(pending.issues[0]?.message)
      faulted.close()

      const reopened = await createFlowDocBackendCompositionSqliteRepositoryV1({ databasePath })
      repositories.push(reopened)
      const reconciled = await reconcileFlowDocBackendCompositionWorkerStorageAttemptV1({
        repository: reopened,
        mutation,
        state: pending.state,
        observedAt: "2026-07-13T08:02:01.000Z",
      })
      if (point === "after-commit") expect(reconciled).toMatchObject({
        status: "committed",
        evidence: "committed-finalization",
      })
      else {
        expect(reconciled).toMatchObject({ status: "retry-ready", evidence: "committed-finalization" })
        if (reconciled.status !== "retry-ready") throw new Error("finalization reconciliation did not prepare retry")
        await expect(retryFlowDocBackendCompositionWorkerStorageAttemptV1({
          repository: reopened,
          mutation,
          state: reconciled.state,
          startedAt: reconciled.state.retryNotBefore,
        })).resolves.toMatchObject({ status: "committed" })
      }
      const finalization = mutation.input.committedFinalization
      if (finalization == null) throw new Error("captured finalization evidence is missing")
      await expect(reopened.readCommittedFinalization({
        jobId: fixture.sourcePin.jobId,
        requestId: finalization.requestId,
      })).resolves.toMatchObject({
        status: "found",
        requestFingerprint: finalization.requestFingerprint,
        pagePlanRef: finalization.pagePlanRef,
        headingPageMapRef: finalization.headingPageMapRef,
      })
    }
  })

  it("retains V1 head, transition replay, batch, and usage facts across connection restart", async () => {
    const fixture = createCompositionSchedulerFixture()
    const { root, repository } = await open()
    const createInput = {
      createRequestId: "create-sqlite-restart",
      requestFingerprint: fp("create-sqlite-restart"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    }
    await expect(repository.createHead(createInput)).resolves.toMatchObject({ status: "created" })

    const windowRef = contentRef(
      fixture.sourcePin.jobId,
      "family-window",
      "window-sqlite",
      fixture.window.fingerprint,
      bytes(fixture.window),
    )
    const chunkRef = contentRef(
      fixture.sourcePin.jobId,
      "closed-page-chunk",
      "chunk-sqlite",
      fixture.pageChunk.fingerprint,
      bytes(fixture.pageChunk),
    )
    const receiptRef = contentRef(
      fixture.sourcePin.jobId,
      "transition-receipt",
      "receipt-sqlite",
      fixture.receipt.fingerprint,
      bytes(fixture.receipt),
    )
    for (const [ref, value] of [
      [windowRef, fixture.window],
      [chunkRef, fixture.pageChunk],
      [receiptRef, fixture.receipt],
    ] as const) await expect(repository.putImmutable({ ref, value })).resolves.toMatchObject({ status: "written" })

    const lease = leasedHead(fixture, "sqlite-restart")
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 0,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      nextHead: lease,
    })).resolves.toMatchObject({ status: "committed", head: { headRevision: 1 } })
    const committedRequest = {
      requestId: fixture.receipt.transitionRequestId,
      requestFingerprint: fixture.receipt.requestFingerprint,
      receiptRef,
    }
    await expect(repository.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 1,
      expectedHeadFingerprint: lease.fingerprint,
      nextHead: fixture.readyToFinalizeHead,
      committedRequest,
    })).resolves.toMatchObject({ status: "committed", head: { headRevision: 2 } })

    repository.close()
    const reopened = (await open(root)).repository
    await expect(reopened.readHead(fixture.sourcePin.jobId)).resolves.toMatchObject({
      status: "found",
      head: { status: "ready-to-finalize", headRevision: 2 },
    })
    await expect(reopened.readCommittedRequest({
      jobId: fixture.sourcePin.jobId,
      requestId: committedRequest.requestId,
    })).resolves.toMatchObject({
      status: "found",
      receiptRef,
      head: { headRevision: 2 },
    })
    await expect(reopened.compareAndSwapHead({
      jobId: fixture.sourcePin.jobId,
      expectedHeadRevision: 1,
      expectedHeadFingerprint: lease.fingerprint,
      nextHead: fixture.readyToFinalizeHead,
      committedRequest,
    })).resolves.toMatchObject({ status: "idempotent-replay", head: { headRevision: 2 } })
    await expect(reopened.readImmutableBatch({
      jobId: fixture.sourcePin.jobId,
      refs: [receiptRef, chunkRef, windowRef],
    })).resolves.toMatchObject({
      status: "found",
      records: [
        { ref: receiptRef },
        { ref: chunkRef },
        { ref: windowRef },
      ],
    })
    await expect(reopened.inspectPhysicalUsage(fixture.sourcePin.jobId)).resolves.toMatchObject({
      status: "ready",
      usage: {
        recordCount: 3,
        byteCount: receiptRef.byteLength + chunkRef.byteLength + windowRef.byteLength,
      },
    })
  })

  it("admits physical bytes atomically and cleans only old unprotected records on a terminal head", async () => {
    const fixture = createCompositionSchedulerFixture()
    const { repository } = await open()
    const protectedValue = { fingerprint: fp("protected-physical-record") }
    const orphanValue = { fingerprint: fp("orphan-physical-record") }
    const rejectedValue = { fingerprint: fp("rejected-physical-record") }
    const protectedRef = contentRef(
      fixture.sourcePin.jobId,
      "source-snapshot",
      "protected-physical-record",
      protectedValue.fingerprint,
      bytes(protectedValue),
    )
    const orphanRef = contentRef(
      fixture.sourcePin.jobId,
      "family-window",
      "orphan-physical-record",
      orphanValue.fingerprint,
      bytes(orphanValue),
    )
    const rejectedRef = contentRef(
      fixture.sourcePin.jobId,
      "family-window",
      "rejected-physical-record",
      rejectedValue.fingerprint,
      bytes(rejectedValue),
    )
    await expect(repository.putImmutableWithPhysicalAdmission({
      ref: protectedRef,
      value: protectedValue,
      storedAt: "2026-07-13T07:00:00.000Z",
      maximumPhysicalByteCount: protectedRef.byteLength + orphanRef.byteLength,
    })).resolves.toMatchObject({ status: "written" })
    await expect(repository.putImmutableWithPhysicalAdmission({
      ref: orphanRef,
      value: orphanValue,
      storedAt: "2026-07-13T07:00:00.000Z",
      maximumPhysicalByteCount: protectedRef.byteLength + orphanRef.byteLength,
    })).resolves.toMatchObject({ status: "written" })
    await expect(repository.putImmutableWithPhysicalAdmission({
      ref: rejectedRef,
      value: rejectedValue,
      storedAt: "2026-07-13T07:00:00.000Z",
      maximumPhysicalByteCount: protectedRef.byteLength + orphanRef.byteLength,
    })).resolves.toMatchObject({
      status: "physical-quota-exceeded",
      usage: { recordCount: 2 },
    })

    await repository.createHead({
      createRequestId: "create-cleanup",
      requestFingerprint: fp("create-cleanup"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    })
    await expect(repository.cleanupUnreachable({
      jobId: fixture.sourcePin.jobId,
      expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      reachableRefs: [protectedRef],
      storedBefore: "2026-07-13T08:00:00.000Z",
      maximumDeleteCount: 1,
    })).resolves.toMatchObject({
      status: "invalid",
      issues: [expect.objectContaining({ code: "composition-cleanup-active-job-blocked" })],
    })
    const requestedAt = new Date(Date.parse(fixture.waitingHead.updatedAt) + 1_000).toISOString()
    const cancelled = await cancelFlowDocBackendCompositionV1({
      repository,
      expectation: {
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: fixture.waitingHead.headRevision,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
      },
      requestedAt,
    })
    expect(cancelled).toMatchObject({ status: "updated", jobHead: { status: "cancelled" } })
    if (cancelled.status !== "updated") throw new Error("cancelled head missing")
    await expect(repository.cleanupUnreachable({
      jobId: fixture.sourcePin.jobId,
      expectedHeadFingerprint: cancelled.jobHead.fingerprint,
      reachableRefs: [protectedRef],
      storedBefore: "2026-07-13T08:00:00.000Z",
      maximumDeleteCount: 1,
    })).resolves.toMatchObject({
      status: "completed",
      deletedRefs: [orphanRef],
      usage: { recordCount: 1, byteCount: protectedRef.byteLength },
    })
    await expect(repository.readImmutable({
      jobId: protectedRef.jobId,
      recordId: protectedRef.recordId,
    })).resolves.toMatchObject({ status: "found" })
    await expect(repository.readImmutable({
      jobId: orphanRef.jobId,
      recordId: orphanRef.recordId,
    })).resolves.toMatchObject({ status: "not-found" })
  })

  it("allows only one winner across independently opened SQLite handles", async () => {
    const fixture = createCompositionSchedulerFixture()
    const { root, repository } = await open()
    const other = (await open(root)).repository
    await repository.createHead({
      createRequestId: "create-two-handle-race",
      requestFingerprint: fp("create-two-handle-race"),
      sourcePin: fixture.sourcePin,
      manifest: fixture.manifest,
      head: fixture.waitingHead,
    })
    const candidates = [leasedHead(fixture, "sqlite-race-a"), leasedHead(fixture, "sqlite-race-b")]
    const results = await Promise.all([
      repository.compareAndSwapHead({
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: 0,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
        nextHead: candidates[0],
      }),
      other.compareAndSwapHead({
        jobId: fixture.sourcePin.jobId,
        expectedHeadRevision: 0,
        expectedHeadFingerprint: fixture.waitingHead.fingerprint,
        nextHead: candidates[1],
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["committed", "stale"])
  })
})
