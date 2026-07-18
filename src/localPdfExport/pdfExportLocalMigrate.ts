import {
  ensureFlowDocBackendPdfExportLocalS3BucketV1,
  migrateFlowDocBackendPdfExportLocalPostgresV1,
} from "../index.js"

function required(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

const runtimeProfile = required("FLOWDOC_PDF_LOCAL_RUNTIME_PROFILE")
if (runtimeProfile !== "local-integration") throw new Error("local migration requires local-integration runtime profile")

const postgres = await migrateFlowDocBackendPdfExportLocalPostgresV1({
  runtimeProfile,
  connectionString: required("FLOWDOC_PDF_LOCAL_POSTGRES_URL"),
  appliedAt: new Date().toISOString(),
})
const s3 = await ensureFlowDocBackendPdfExportLocalS3BucketV1({
  runtimeProfile,
  endpoint: required("FLOWDOC_PDF_LOCAL_S3_ENDPOINT"),
  region: required("FLOWDOC_PDF_LOCAL_S3_REGION"),
  bucket: required("FLOWDOC_PDF_LOCAL_S3_BUCKET"),
  accessKeyId: required("FLOWDOC_PDF_LOCAL_S3_ACCESS_KEY_ID"),
  secretAccessKey: required("FLOWDOC_PDF_LOCAL_S3_SECRET_ACCESS_KEY"),
})

process.stdout.write(`${JSON.stringify({
  status: "ready",
  postgres: {
    schemaVersion: postgres.schemaVersion,
    databaseIdentityFingerprint: postgres.databaseIdentityFingerprint,
  },
  s3: {
    endpointIdentityFingerprint: s3.endpointIdentityFingerprint,
    bucketIdentityFingerprint: s3.bucketIdentityFingerprint,
  },
  productionBinding: false,
})}\n`)
