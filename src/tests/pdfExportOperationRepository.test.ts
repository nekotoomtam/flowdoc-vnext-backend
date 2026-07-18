import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendPdfExportOperationSqliteRepositoryV1,
  createInMemoryFlowDocBackendPdfExportOperationRepositoryV1,
  supportsFlowDocBackendPdfExportOperationSqliteV1,
  type FlowDocBackendPdfExportOperationRepositoryV1,
  type FlowDocBackendPdfExportOperationSqliteRepositoryV1,
} from "../index.js"
import { createPdfExportOperationFixture } from "./helpers/pdfExportOperationFixture.js"

async function runRepositoryConformance(repository: FlowDocBackendPdfExportOperationRepositoryV1) {
  const first = createPdfExportOperationFixture({
    operationId: "operation:repository:first",
  })
  const replayCandidate = createPdfExportOperationFixture({
    operationId: "operation:repository:replay-candidate",
  })
  const created = await repository.admitOperation(first)
  expect(created).toMatchObject({
    status: "created",
    operation: { operationId: first.operationId },
    existingOperationId: first.operationId,
    issues: [],
  })
  const replay = await repository.admitOperation(replayCandidate)
  expect(replay).toMatchObject({
    status: "idempotent-replay",
    operation: {
      operationId: first.operationId,
      operationFingerprint: first.operationFingerprint,
    },
    existingOperationId: first.operationId,
    issues: [],
  })

  const conflictingPayload = createPdfExportOperationFixture({
    operationId: "operation:repository:conflicting-payload",
    revision: 8,
  })
  await expect(repository.admitOperation(conflictingPayload)).resolves.toMatchObject({
    status: "conflict",
    operation: null,
    existingOperationId: first.operationId,
    issues: [{ code: "pdf-export-operation-idempotency-conflict" }],
  })

  const operationIdConflict = createPdfExportOperationFixture({
    operationId: first.operationId,
    callerIdempotencyKey: "caller-key:other-binding",
  })
  await expect(repository.admitOperation(operationIdConflict)).resolves.toMatchObject({
    status: "conflict",
    operation: null,
    existingOperationId: first.operationId,
    issues: [{ code: "pdf-export-operation-id-conflict" }],
  })

  const tenantOperation = createPdfExportOperationFixture({
    operationId: "operation:repository:other-tenant",
    tenantId: "tenant:other",
  })
  const principalOperation = createPdfExportOperationFixture({
    operationId: "operation:repository:other-principal",
    principalId: "principal:other",
  })
  await expect(repository.admitOperation(tenantOperation)).resolves.toMatchObject({ status: "created" })
  await expect(repository.admitOperation(principalOperation)).resolves.toMatchObject({ status: "created" })

  const byId = await repository.readByOperationId({
    ...first.scope,
    operationId: first.operationId,
  })
  expect(byId).toMatchObject({ status: "found", operation: first, issues: [] })
  if (byId.status !== "found") throw new Error("operation must be readable")
  byId.operation.scope.tenantId = "tenant:mutated-read"
  await expect(repository.readByOperationId({
    ...first.scope,
    operationId: first.operationId,
  })).resolves.toMatchObject({ operation: { scope: first.scope } })
  await expect(repository.readByCallerKey({
    ...first.scope,
    callerIdempotencyKey: first.idempotency.callerKey,
  })).resolves.toMatchObject({ status: "found", operation: { operationId: first.operationId } })
  await expect(repository.readByOperationId({
    tenantId: "tenant:other",
    principalId: first.scope.principalId,
    operationId: first.operationId,
  })).resolves.toMatchObject({ status: "not-found", operation: null })
  await expect(repository.readByCallerKey({
    tenantId: first.scope.tenantId,
    principalId: "principal:other",
    callerIdempotencyKey: first.idempotency.callerKey,
  })).resolves.toMatchObject({ status: "found", operation: { operationId: principalOperation.operationId } })

  const invalid = structuredClone(first)
  invalid.operationFingerprint = `sha256:${"f".repeat(64)}`
  await expect(repository.admitOperation(invalid)).resolves.toMatchObject({
    status: "invalid",
    operation: null,
    existingOperationId: null,
  })
}

describe("PDF export operation repository", () => {
  const roots: string[] = []
  const sqliteRepositories: FlowDocBackendPdfExportOperationSqliteRepositoryV1[] = []

  afterEach(() => {
    sqliteRepositories.splice(0).forEach((repository) => {
      try {
        repository.close()
      } catch {
        // A restart test can close a handle before cleanup.
      }
    })
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  async function openSqlite(root?: string) {
    const selectedRoot = root ?? mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-operation-"))
    if (root == null) roots.push(selectedRoot)
    const repository = await createFlowDocBackendPdfExportOperationSqliteRepositoryV1({
      databasePath: join(selectedRoot, "pdf-export-operation.sqlite"),
    })
    sqliteRepositories.push(repository)
    return { root: selectedRoot, repository }
  }

  it("passes caller-key and scope conformance through the in-memory adapter", async () => {
    await runRepositoryConformance(createInMemoryFlowDocBackendPdfExportOperationRepositoryV1())
  })

  it("passes the same conformance through the SQLite adapter", async () => {
    const { repository } = await openSqlite()
    await runRepositoryConformance(repository)
  })

  it("keeps the SQLite adapter behind an explicit runtime floor", () => {
    expect(supportsFlowDocBackendPdfExportOperationSqliteV1("24.15.0")).toBe(true)
    expect(supportsFlowDocBackendPdfExportOperationSqliteV1("24.14.9")).toBe(false)
    expect(supportsFlowDocBackendPdfExportOperationSqliteV1("22.13.0")).toBe(false)
    expect(supportsFlowDocBackendPdfExportOperationSqliteV1()).toBe(true)
  })

  it("retains exact idempotent replay across close and reopen", async () => {
    const { root, repository } = await openSqlite()
    const first = createPdfExportOperationFixture({ operationId: "operation:restart:first" })
    await expect(repository.admitOperation(first)).resolves.toMatchObject({ status: "created" })
    repository.close()

    const reopened = await createFlowDocBackendPdfExportOperationSqliteRepositoryV1({
      databasePath: join(root, "pdf-export-operation.sqlite"),
    })
    sqliteRepositories.push(reopened)
    const replayCandidate = createPdfExportOperationFixture({ operationId: "operation:restart:replay" })
    await expect(reopened.admitOperation(replayCandidate)).resolves.toMatchObject({
      status: "idempotent-replay",
      operation: {
        operationId: first.operationId,
        operationFingerprint: first.operationFingerprint,
      },
    })
  })

  it("keeps admission on one exact side of before/after commit faults", async () => {
    for (const point of ["before-commit", "after-commit"] as const) {
      const root = mkdtempSync(join(tmpdir(), `flowdoc-pdf-export-operation-${point}-`))
      roots.push(root)
      const databasePath = join(root, "pdf-export-operation.sqlite")
      let injected = false
      const faulted = await createFlowDocBackendPdfExportOperationSqliteRepositoryV1({
        databasePath,
        faultInjector(context) {
          if (!injected && context.point === point) {
            injected = true
            throw new Error(`injected-${point}`)
          }
        },
      })
      sqliteRepositories.push(faulted)
      const operation = createPdfExportOperationFixture({
        operationId: `operation:fault:${point}`,
        callerIdempotencyKey: `caller-key:fault:${point}`,
      })
      await expect(faulted.admitOperation(operation)).rejects.toThrow(`injected-${point}`)
      faulted.close()

      const reopened = await createFlowDocBackendPdfExportOperationSqliteRepositoryV1({ databasePath })
      sqliteRepositories.push(reopened)
      const read = await reopened.readByOperationId({ ...operation.scope, operationId: operation.operationId })
      expect(read.status).toBe(point === "before-commit" ? "not-found" : "found")
      await expect(reopened.admitOperation(operation)).resolves.toMatchObject({
        status: point === "before-commit" ? "created" : "idempotent-replay",
      })
    }
  })

  it("admits one durable owner across independent SQLite handles", async () => {
    const { root, repository: firstRepository } = await openSqlite()
    const secondRepository = await createFlowDocBackendPdfExportOperationSqliteRepositoryV1({
      databasePath: join(root, "pdf-export-operation.sqlite"),
    })
    sqliteRepositories.push(secondRepository)
    const first = createPdfExportOperationFixture({ operationId: "operation:handles:first" })
    const second = createPdfExportOperationFixture({ operationId: "operation:handles:second" })
    const results = await Promise.all([
      firstRepository.admitOperation(first),
      secondRepository.admitOperation(second),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["created", "idempotent-replay"])
    expect(results.map((result) => result.existingOperationId)).toEqual([
      first.operationId,
      first.operationId,
    ])

    const conflict = createPdfExportOperationFixture({
      operationId: "operation:handles:conflict",
      revision: 8,
    })
    await expect(secondRepository.admitOperation(conflict)).resolves.toMatchObject({
      status: "conflict",
      existingOperationId: first.operationId,
    })
  })
})
