import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { openFlowDocBackendCompositionSqliteDatabaseV1 } from "../../index.js"

interface WorkerPayload {
  databasePath: string
  readyPath: string
  releasePath: string
}

const payloadPath = process.argv[2]
if (payloadPath == null) throw new Error("SQLite lock worker requires one payload file")
const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as WorkerPayload

async function waitForRelease(path: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error("SQLite lock worker release barrier timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const database = await openFlowDocBackendCompositionSqliteDatabaseV1({
  databasePath: payload.databasePath,
  busyTimeoutMs: 10_000,
})
database.exec("BEGIN IMMEDIATE")
writeFileSync(payload.readyPath, JSON.stringify({ pid: process.pid }), "utf8")
try {
  await waitForRelease(payload.releasePath, 30_000)
  database.exec("ROLLBACK")
  process.stdout.write(JSON.stringify({ pid: process.pid, released: true }))
} finally {
  if (database.isTransaction) database.exec("ROLLBACK")
  database.close()
}
