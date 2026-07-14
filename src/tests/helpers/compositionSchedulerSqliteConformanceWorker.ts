import { readFileSync } from "node:fs"
import {
  createFlowDocBackendCompositionSqliteRepositoryV1,
  type FlowDocBackendCompositionSqliteFaultContextV1,
} from "../../index.js"

interface WorkerPayload {
  databasePath: string
  action: "create-head" | "compare-and-swap-head" | "put-immutable-admitted"
  input: unknown
  fault?: FlowDocBackendCompositionSqliteFaultContextV1 | null
}

const payloadPath = process.argv[2]
if (payloadPath == null) throw new Error("SQLite conformance worker requires one payload file")
const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as WorkerPayload
const repository = await createFlowDocBackendCompositionSqliteRepositoryV1({
  databasePath: payload.databasePath,
  busyTimeoutMs: 10_000,
  faultInjector: (context) => {
    if (
      payload.fault?.transactionKind === context.transactionKind
      && payload.fault.point === context.point
    ) process.exit(86)
  },
})

let result: unknown
if (payload.action === "create-head") {
  result = await repository.createHead(payload.input as Parameters<typeof repository.createHead>[0])
} else if (payload.action === "compare-and-swap-head") {
  result = await repository.compareAndSwapHead(
    payload.input as Parameters<typeof repository.compareAndSwapHead>[0],
  )
} else {
  result = await repository.putImmutableWithPhysicalAdmission(
    payload.input as Parameters<typeof repository.putImmutableWithPhysicalAdmission>[0],
  )
}

repository.close()
process.stdout.write(JSON.stringify({ pid: process.pid, result }))
