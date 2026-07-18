import { randomBytes } from "node:crypto"
import { appendFile, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const target = resolve(process.cwd(), ".env.local")
const postgresPassword = randomBytes(24).toString("hex")
const s3AccessKeyId = `flowdoclocal${randomBytes(6).toString("hex")}`
const s3SecretAccessKey = randomBytes(32).toString("base64url")
const bearerToken = randomBytes(32).toString("base64url")

const lines = [
  "FLOWDOC_PDF_LOCAL_RUNTIME_PROFILE=local-integration",
  "FLOWDOC_PDF_LOCAL_INTEGRATION=1",
  "FLOWDOC_PDF_LOCAL_POSTGRES_PORT=55432",
  "FLOWDOC_PDF_LOCAL_POSTGRES_USER=flowdoc_pdf_local",
  `FLOWDOC_PDF_LOCAL_POSTGRES_PASSWORD=${postgresPassword}`,
  "FLOWDOC_PDF_LOCAL_POSTGRES_DATABASE=flowdoc_pdf_local",
  `FLOWDOC_PDF_LOCAL_POSTGRES_URL=postgresql://flowdoc_pdf_local:${postgresPassword}@127.0.0.1:55432/flowdoc_pdf_local`,
  "FLOWDOC_PDF_LOCAL_S3_PORT=59000",
  "FLOWDOC_PDF_LOCAL_S3_CONSOLE_PORT=59001",
  "FLOWDOC_PDF_LOCAL_S3_ENDPOINT=http://127.0.0.1:59000",
  "FLOWDOC_PDF_LOCAL_S3_REGION=us-east-1",
  "FLOWDOC_PDF_LOCAL_S3_BUCKET=flowdoc-pdf-local",
  `FLOWDOC_PDF_LOCAL_S3_ACCESS_KEY_ID=${s3AccessKeyId}`,
  `FLOWDOC_PDF_LOCAL_S3_SECRET_ACCESS_KEY=${s3SecretAccessKey}`,
  "FLOWDOC_PDF_LOCAL_HTTP_HOST=127.0.0.1",
  "FLOWDOC_PDF_LOCAL_HTTP_PORT=4012",
  `FLOWDOC_PDF_LOCAL_BEARER_TOKEN=${bearerToken}`,
  "FLOWDOC_PDF_LOCAL_CORE_ROOT=../flowdoc-vnext-core",
  "FLOWDOC_PDF_LOCAL_CANONICAL_REPORT_ROOT=../ocr-benchmark-skeleton/reports/INV_9437125258",
  "FLOWDOC_PDF_LOCAL_WORKER_FACTORY_MODULE=src/localPdfExport/pdfExportLocalCompositionFactory.ts",
  "",
]

const localE = lines.slice(-7)

try {
  await writeFile(target, lines.join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 })
  process.stdout.write("Created ignored .env.local with random local-only credentials.\n")
} catch (error) {
  if (typeof error === "object" && error != null && "code" in error && error.code === "EEXIST") {
    const existing = await readFile(target, "utf8")
    const names = new Set(existing
      .split(/\r?\n/u)
      .map((line) => line.split("=", 1)[0]?.trim())
      .filter((name): name is string => name != null && name.length > 0))
    const additions = localE.filter((line) => {
      const name = line.split("=", 1)[0]?.trim()
      return name != null && name.length > 0 && !names.has(name)
    })
    if (additions.length > 0) {
      const separator = existing.endsWith("\n") ? "" : "\n"
      await appendFile(target, `${separator}${additions.join("\n")}\n`, { encoding: "utf8", mode: 0o600 })
      process.stdout.write("Added missing LOCAL-E settings to ignored .env.local.\n")
    } else process.stdout.write("Retained complete ignored .env.local.\n")
  } else throw error
}
