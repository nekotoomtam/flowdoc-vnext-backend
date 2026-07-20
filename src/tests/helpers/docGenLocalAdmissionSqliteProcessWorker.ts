import { readFileSync } from "node:fs"
import {
  createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1,
} from "../../index.js"
import {
  DOCGEN_LOCAL_IDENTITY,
  createDocGenLocalAdmissionFixture,
  docGenLocalAdaptedRequest,
  docGenLocalMapper,
} from "./docGenLocalFixture.js"

interface WorkerInput {
  databasePath: string
  callerKey: string
  payloadText: string
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2]
  if (payloadPath == null) throw new Error("worker payload path is required")
  const input = JSON.parse(readFileSync(payloadPath, "utf8")) as WorkerInput
  let mapCount = 0
  const repository = await createFlowDocBackendDocGenLocalAdmissionSqliteRepositoryV1({
    databasePath: input.databasePath,
  })
  const fixture = createDocGenLocalAdmissionFixture({
    repository,
    mapper: docGenLocalMapper({ onMap: () => { mapCount += 1 } }),
  })
  const result = await fixture.admission.admit({
    identity: DOCGEN_LOCAL_IDENTITY,
    callerIdempotencyKey: input.callerKey,
    request: docGenLocalAdaptedRequest(input.payloadText),
  })
  repository.close()
  process.stdout.write(JSON.stringify({
    pid: process.pid,
    status: result.status,
    mapCount,
    receiptFingerprint: result.receipt?.receiptFingerprint ?? null,
    instanceId: result.receipt?.instance.instanceId ?? null,
    durablePersistence: result.receipt?.contracts.durablePersistence ?? null,
  }))
}

void main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
