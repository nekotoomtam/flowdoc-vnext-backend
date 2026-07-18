import { createHash, randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import { access, mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { spawn, type ChildProcess } from "node:child_process"
import EmbeddedPostgres from "embedded-postgres"

const MINIO_RELEASE = "RELEASE.2025-06-13T11-33-47Z"
const MINIO_SHA256 = "ef7f328339d931adbc9c06155bce92102b12be455c63f38235b7af86db4d0163"
const MINIO_URL = `https://dl.min.io/server/minio/release/windows-amd64/archive/minio.${MINIO_RELEASE}`

async function availablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || address == null) {
        server.close(() => reject(new Error("portable evidence could not allocate a loopback port")))
        return
      }
      server.close((error) => error == null ? resolvePort(address.port) : reject(error))
    })
  })
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256")
  await pipeline(createReadStream(path), hash)
  return hash.digest("hex")
}

async function ensureMinioBinary(): Promise<string> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("portable LOCAL-C evidence currently supports Windows x64 only")
  }
  const toolsRoot = join(tmpdir(), "flowdoc-pdf-export-local-tools")
  await mkdir(toolsRoot, { recursive: true })
  const target = join(toolsRoot, `minio.${MINIO_RELEASE}.exe`)
  try {
    await access(target)
    if (await fileSha256(target) === MINIO_SHA256) return target
    await rm(target, { force: true })
  } catch {
    // The pinned binary is not cached yet.
  }
  const pending = `${target}.pending.${randomBytes(6).toString("hex")}`
  const response = await fetch(MINIO_URL)
  if (!response.ok || response.body == null) {
    throw new Error(`pinned MinIO download failed with HTTP ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), await import("node:fs").then(({ createWriteStream }) => createWriteStream(pending, { flags: "wx" })))
  const digest = await fileSha256(pending)
  if (digest !== MINIO_SHA256) {
    await rm(pending, { force: true })
    throw new Error(`pinned MinIO SHA-256 mismatch: ${digest}`)
  }
  await rename(pending, target)
  return target
}

async function waitForMinio(endpoint: string, processHandle: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (processHandle.exitCode != null) {
      throw new Error(`portable MinIO exited before readiness with code ${processHandle.exitCode}`)
    }
    try {
      const response = await fetch(`${endpoint}/minio/health/ready`)
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error("portable MinIO did not become ready within 30 seconds")
}

async function runIntegration(env: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(process.execPath, [
    resolve(process.cwd(), "node_modules", "vitest", "vitest.mjs"),
    "run",
    "--config",
    "vitest.config.ts",
    "src/tests/pdfExportLocalProviders.integration.test.ts",
  ], {
    cwd: resolve(process.cwd()),
    env,
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  })
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`portable PDF local integration exited with status ${exitCode}`)
}

const root = await mkdtemp(join(tmpdir(), "flowdoc-pdf-export-portable-"))
const databaseDir = join(root, "postgres")
const minioData = join(root, "minio")
await mkdir(minioData, { recursive: true })
const postgresPort = await availablePort()
const minioPort = await availablePort()
const minioConsolePort = await availablePort()
const postgresUser = "flowdoc_pdf_local"
const postgresPassword = randomBytes(24).toString("hex")
const postgresDatabase = "flowdoc_pdf_local"
const s3AccessKeyId = `flowdoclocal${randomBytes(6).toString("hex")}`
const s3SecretAccessKey = randomBytes(32).toString("base64url")
const minioBinary = await ensureMinioBinary()
const postgres = new EmbeddedPostgres({
  databaseDir,
  port: postgresPort,
  user: postgresUser,
  password: postgresPassword,
  authMethod: "scram-sha-256",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--no-locale"],
  postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
  onLog: () => undefined,
  onError: () => undefined,
})
let postgresStarted = false
let minio: ChildProcess | null = null
try {
  await postgres.initialise()
  await postgres.start()
  postgresStarted = true
  await postgres.createDatabase(postgresDatabase)
  minio = spawn(minioBinary, [
    "server",
    minioData,
    "--address",
    `127.0.0.1:${minioPort}`,
    "--console-address",
    `127.0.0.1:${minioConsolePort}`,
  ], {
    cwd: root,
    env: {
      ...process.env,
      MINIO_ROOT_USER: s3AccessKeyId,
      MINIO_ROOT_PASSWORD: s3SecretAccessKey,
    },
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  })
  const endpoint = `http://127.0.0.1:${minioPort}`
  await waitForMinio(endpoint, minio)
  await runIntegration({
    ...process.env,
    FLOWDOC_PDF_LOCAL_RUNTIME_PROFILE: "local-integration",
    FLOWDOC_PDF_LOCAL_INTEGRATION: "1",
    FLOWDOC_PDF_LOCAL_POSTGRES_URL:
      `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${postgresPort}/${postgresDatabase}`,
    FLOWDOC_PDF_LOCAL_S3_ENDPOINT: endpoint,
    FLOWDOC_PDF_LOCAL_S3_REGION: "us-east-1",
    FLOWDOC_PDF_LOCAL_S3_BUCKET: "flowdoc-pdf-local-portable",
    FLOWDOC_PDF_LOCAL_S3_ACCESS_KEY_ID: s3AccessKeyId,
    FLOWDOC_PDF_LOCAL_S3_SECRET_ACCESS_KEY: s3SecretAccessKey,
  })
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    phases: [
      "PDF-EXPORT-LOCAL-C",
      "PDF-EXPORT-LOCAL-D",
      "PDF-EXPORT-LOCAL-E",
      "PDF-EXPORT-LOCAL-F",
    ],
    postgres: "embedded-postgres-17.10",
    minioRelease: MINIO_RELEASE,
    minioSha256: MINIO_SHA256,
    runtimeProfile: "local-integration",
    loopbackOnly: true,
    productionBinding: false,
  })}\n`)
} finally {
  if (minio != null && minio.exitCode == null) {
    minio.kill()
    await new Promise<void>((resolveExit) => {
      minio!.once("exit", () => resolveExit())
      setTimeout(resolveExit, 5_000).unref()
    })
  }
  if (postgresStarted) await postgres.stop().catch(() => undefined)
  const resolvedRoot = resolve(root)
  const resolvedTemp = resolve(tmpdir())
  if (resolvedRoot.startsWith(`${resolvedTemp}\\`) && basename(resolvedRoot).startsWith("flowdoc-pdf-export-portable-")) {
    await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}
