import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendDocGenLocalArtifactBindingV1,
  createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1,
  createFlowDocBackendDocGenLocalDurablePdfExportRuntimeV1,
} from "../index.js"
import {
  DOCGEN_LOCAL_IDENTITY,
  createDocGenLocalAdmissionFixture,
  docGenLocalDirectRequest,
} from "./helpers/docGenLocalFixture.js"
import { docGenLocalPdfMaterializer } from "./helpers/docGenLocalPdfExportFixture.js"

const AUTHORIZATION = "Bearer docgen-e63-durable-runtime-owner"
const ADMISSION_KEY = "docgen:e63:durable-runtime"
const EXPORT_KEY = "pdf-export:e63:durable-runtime"

describe("PDF export REALDOC-E.6.3 durable HTTP runtime", () => {
  const roots: string[] = []

  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  function root(): string {
    const value = mkdtempSync(join(tmpdir(), "flowdoc-docgen-e63-runtime-"))
    roots.push(value)
    return value
  }

  async function open(rootDirectory: string, dispatchDelayMs: number, suffix: string) {
    const composition = await createFlowDocBackendDocGenLocalDurablePdfExportCompositionV1({ rootDirectory })
    const fixture = createDocGenLocalAdmissionFixture({ repository: composition.admissionRepository })
    const binding = createFlowDocBackendDocGenLocalArtifactBindingV1({
      repository: composition.admissionRepository,
      assets: fixture.assets,
      materializer: docGenLocalPdfMaterializer(),
      operationIdFactory: () => suffix,
    })
    const authenticator = {
      async authenticate({ authorization }: { authorization: string | null }) {
        return authorization === AUTHORIZATION
          ? { status: "authenticated" as const, identity: DOCGEN_LOCAL_IDENTITY, issues: [] as [] }
          : { status: "unauthenticated" as const, identity: null, issues: [] as [] }
      },
    }
    const runtime = createFlowDocBackendDocGenLocalDurablePdfExportRuntimeV1({
      composition,
      binding,
      host: "127.0.0.1",
      port: 0,
      routeOptions: {
        authenticator,
        authorizer: {
          async authorize() {
            return { status: "authorized" as const, authorizationId: "authorization:e63", issues: [] as [] }
          },
        },
      },
      operationDispatchDelayMs: dispatchDelayMs,
    })
    await runtime.start()
    const origin = runtime.origin()
    if (origin == null) throw new Error("durable runtime did not start")
    return { runtime, fixture, origin }
  }

  async function admit(fixture: ReturnType<typeof createDocGenLocalAdmissionFixture>) {
    const result = await fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: ADMISSION_KEY,
      request: docGenLocalDirectRequest(),
    })
    if (result.status !== "created" && result.status !== "replayed") {
      throw new Error(`durable admission failed: ${result.status}`)
    }
    return result.receipt
  }

  async function request(origin: string, pin: { documentId: string; documentRevision: number }) {
    return fetch(`${origin}/pdf-exports`, {
      method: "POST",
      headers: {
        authorization: AUTHORIZATION,
        "content-type": "application/json",
        "idempotency-key": EXPORT_KEY,
      },
      body: JSON.stringify(pin),
    })
  }

  async function readStatus(origin: string, operationId: string) {
    const response = await fetch(`${origin}/pdf-exports/${encodeURIComponent(operationId)}`, {
      headers: { authorization: AUTHORIZATION },
    })
    return { response, body: await response.json() as Record<string, any> }
  }

  it("leaves pending work durable, then resumes only when the exact request is replayed", async () => {
    const rootDirectory = root()
    const first = await open(rootDirectory, 60_000, "e63-reconnect")
    const receipt = await admit(first.fixture)
    const pin = {
      documentId: receipt.instance.instanceId,
      documentRevision: receipt.instance.revision,
    }
    const created = await request(first.origin, pin)
    expect(created.status).toBe(202)
    const createdBody = await created.json() as Record<string, any>
    const operationId = createdBody.export.operationId as string
    expect(createdBody.export.state).toBe("pending")
    expect(first.runtime.readDispatchEvidence()).toMatchObject({
      scheduledCount: 1,
      completedCount: 0,
      pendingTimerCount: 1,
    })
    await first.runtime.close()

    const second = await open(rootDirectory, 0, "unused-on-idempotent-replay")
    expect(second.runtime.readDispatchEvidence().scheduledCount).toBe(0)
    const replay = await request(second.origin, pin)
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({
      status: "idempotent-replay",
      export: { operationId },
    })
    const deadline = Date.now() + 15_000
    let status = await readStatus(second.origin, operationId)
    while (status.body.export.state !== "completed") {
      if (Date.now() >= deadline) throw new Error("durable replay did not complete")
      await new Promise((resolveWait) => setTimeout(resolveWait, 25))
      status = await readStatus(second.origin, operationId)
    }
    expect(status.response.status).toBe(200)
    expect(status.body.export).toMatchObject({ state: "completed", pageCount: 1 })
    const download = await fetch(`${second.origin}/pdf-exports/${encodeURIComponent(operationId)}/download`, {
      headers: { authorization: AUTHORIZATION },
    })
    expect(download.status).toBe(200)
    expect(download.headers.get("content-type")).toBe("application/pdf")
    expect(new Uint8Array(await download.arrayBuffer()).subarray(0, 5)).toEqual(
      new TextEncoder().encode("%PDF-"),
    )
    expect(second.runtime.readDispatchEvidence()).toMatchObject({
      scheduledCount: 1,
      completedCount: 1,
      failedCount: 0,
    })
    await second.runtime.close()
  }, 30_000)

  it("reconciles an uncertain cancellation with the same retained cancel key", async () => {
    const rootDirectory = root()
    const first = await open(rootDirectory, 60_000, "e63-cancel")
    const receipt = await admit(first.fixture)
    const pin = {
      documentId: receipt.instance.instanceId,
      documentRevision: receipt.instance.revision,
    }
    const created = await request(first.origin, pin)
    const createdBody = await created.json() as Record<string, any>
    const operationId = createdBody.export.operationId as string
    const cancelKey = "pdf-export:e63:cancel:retained"
    const cancel = await fetch(`${first.origin}/pdf-exports/${encodeURIComponent(operationId)}/cancel`, {
      method: "POST",
      headers: { authorization: AUTHORIZATION, "idempotency-key": cancelKey },
    })
    expect([200, 202]).toContain(cancel.status)
    await first.runtime.close()

    const second = await open(rootDirectory, 0, "unused-after-cancel")
    const replay = await request(second.origin, pin)
    expect(replay.status).toBe(200)
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    const status = await readStatus(second.origin, operationId)
    expect(status.body.export.state).toBe("cancelled")
    const reconciled = await fetch(`${second.origin}/pdf-exports/${encodeURIComponent(operationId)}/cancel`, {
      method: "POST",
      headers: { authorization: AUTHORIZATION, "idempotency-key": cancelKey },
    })
    expect(reconciled.status).toBe(200)
    await expect(reconciled.json()).resolves.toMatchObject({
      status: "idempotent-replay",
      operationId,
      state: "cancelled",
    })
    expect(second.runtime.readDispatchEvidence()).toMatchObject({ failedCount: 0 })
    await second.runtime.close()
  }, 30_000)
})
