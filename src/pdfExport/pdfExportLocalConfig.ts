import { resolve } from "node:path"
import type { FlowDocBackendPdfExportLocalPostgresRepositoriesOptionsV1 } from "./pdfExportLocalPostgresRepositories.js"
import type { FlowDocBackendPdfExportS3ContentStoreOptionsV1 } from "./pdfExportS3ContentAddressedStore.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CONFIG_V1_SOURCE =
  "flowdoc-backend-pdf-export-local-config" as const

export interface FlowDocBackendPdfExportLocalCompositionConfigV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CONFIG_V1_SOURCE
  runtimeProfile: "local-integration"
  integrationEnabled: true
  postgres: FlowDocBackendPdfExportLocalPostgresRepositoriesOptionsV1
  s3: FlowDocBackendPdfExportS3ContentStoreOptionsV1
  evidence: {
    coreRoot: string
    reportRoot: string
  }
  productionBinding: false
}

export interface FlowDocBackendPdfExportLocalHttpConfigV1
extends FlowDocBackendPdfExportLocalCompositionConfigV1 {
  http: {
    host: "127.0.0.1"
    port: number
    bearerToken: string
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value == null || value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

function optionalInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]
  if (raw == null || raw.trim().length === 0) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

export function loadFlowDocBackendPdfExportLocalCompositionConfigV1(input: {
  env?: NodeJS.ProcessEnv
  cwd?: string
} = {}): FlowDocBackendPdfExportLocalCompositionConfigV1 {
  const env = input.env ?? process.env
  const cwd = resolve(input.cwd ?? process.cwd())
  if (required(env, "FLOWDOC_PDF_LOCAL_RUNTIME_PROFILE") !== "local-integration") {
    throw new Error("local PDF composition requires runtimeProfile=local-integration")
  }
  if (required(env, "FLOWDOC_PDF_LOCAL_INTEGRATION") !== "1") {
    throw new Error("local PDF composition requires FLOWDOC_PDF_LOCAL_INTEGRATION=1")
  }
  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_LOCAL_CONFIG_V1_SOURCE,
    runtimeProfile: "local-integration",
    integrationEnabled: true,
    postgres: {
      runtimeProfile: "local-integration",
      connectionString: required(env, "FLOWDOC_PDF_LOCAL_POSTGRES_URL"),
      maximumPoolSize: optionalInteger(env, "FLOWDOC_PDF_LOCAL_POSTGRES_POOL_SIZE", 4, 1, 16),
      connectionTimeoutMs: optionalInteger(
        env,
        "FLOWDOC_PDF_LOCAL_POSTGRES_CONNECTION_TIMEOUT_MS",
        5_000,
        100,
        60_000,
      ),
      statementTimeoutMs: optionalInteger(
        env,
        "FLOWDOC_PDF_LOCAL_POSTGRES_STATEMENT_TIMEOUT_MS",
        15_000,
        100,
        60_000,
      ),
      lockTimeoutMs: optionalInteger(env, "FLOWDOC_PDF_LOCAL_POSTGRES_LOCK_TIMEOUT_MS", 5_000, 100, 60_000),
      applicationName: "flowdoc-pdf-export-local-e",
    },
    s3: {
      runtimeProfile: "local-integration",
      endpoint: required(env, "FLOWDOC_PDF_LOCAL_S3_ENDPOINT"),
      region: required(env, "FLOWDOC_PDF_LOCAL_S3_REGION"),
      bucket: required(env, "FLOWDOC_PDF_LOCAL_S3_BUCKET"),
      accessKeyId: required(env, "FLOWDOC_PDF_LOCAL_S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "FLOWDOC_PDF_LOCAL_S3_SECRET_ACCESS_KEY"),
      prefix: env.FLOWDOC_PDF_LOCAL_S3_PREFIX?.trim() || undefined,
      maximumAttempts: 2,
    },
    evidence: {
      coreRoot: resolve(cwd, env.FLOWDOC_PDF_LOCAL_CORE_ROOT?.trim() || "../flowdoc-vnext-core"),
      reportRoot: resolve(
        cwd,
        env.FLOWDOC_PDF_LOCAL_CANONICAL_REPORT_ROOT?.trim()
          || "../ocr-benchmark-skeleton/reports/INV_9437125258",
      ),
    },
    productionBinding: false,
  }
}

export function loadFlowDocBackendPdfExportLocalHttpConfigV1(input: {
  env?: NodeJS.ProcessEnv
  cwd?: string
} = {}): FlowDocBackendPdfExportLocalHttpConfigV1 {
  const env = input.env ?? process.env
  const common = loadFlowDocBackendPdfExportLocalCompositionConfigV1(input)
  const host = required(env, "FLOWDOC_PDF_LOCAL_HTTP_HOST")
  if (host !== "127.0.0.1") throw new Error("local PDF HTTP host must be exactly 127.0.0.1")
  const bearerToken = required(env, "FLOWDOC_PDF_LOCAL_BEARER_TOKEN")
  if (bearerToken.length < 32 || bearerToken.length > 512 || /\s/u.test(bearerToken)) {
    throw new Error("FLOWDOC_PDF_LOCAL_BEARER_TOKEN must contain 32 through 512 non-whitespace characters")
  }
  return {
    ...common,
    http: {
      host,
      port: optionalInteger(env, "FLOWDOC_PDF_LOCAL_HTTP_PORT", 4012, 1, 65_535),
      bearerToken,
    },
  }
}
