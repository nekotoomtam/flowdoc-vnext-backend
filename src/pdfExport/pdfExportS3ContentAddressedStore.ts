import { createHash } from "node:crypto"
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import {
  FLOWDOC_BACKEND_PDF_EXPORT_CONTENT_STORE_V1_SOURCE,
  type FlowDocBackendPdfExportContentAddressedStoreV1,
  type FlowDocBackendPdfExportContentCandidateV1,
  type FlowDocBackendPdfExportContentDeleteResultV1,
  type FlowDocBackendPdfExportContentReadResultV1,
  type FlowDocBackendPdfExportContentScanPageResultV1,
  type FlowDocBackendPdfExportContentScanResultV1,
  type FlowDocBackendPdfExportContentWriteResultV1,
  type FlowDocBackendPdfExportResumableContentAddressedStoreV1,
  type FlowDocBackendPdfExportStoredContentV1,
} from "./pdfExportContentAddressedStore.js"
import {
  flowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_S3_CONTENT_STORE_V1_SOURCE =
  "flowdoc-backend-pdf-export-s3-content-store" as const

const STORAGE_KEY = /^pdf-export-v1\.sha256\.([a-f0-9]{64})\.pdf$/u
const SHA256 = /^[a-f0-9]{64}$/u
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
const DEFAULT_PREFIX = "pdf-export-content-v1/"

export interface FlowDocBackendPdfExportS3ContentStoreOptionsV1 {
  runtimeProfile: "local-integration"
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix?: string
  maximumAttempts?: number
}

export interface FlowDocBackendPdfExportS3ContentStoreFactsV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_S3_CONTENT_STORE_V1_SOURCE
  runtimeProfile: "local-integration"
  endpointIdentityFingerprint: string
  bucketIdentityFingerprint: string
  forcePathStyle: true
  loopbackOnly: true
  bucketCreationAutomaticOnImport: false
  resumableScan: true
  productionBinding: false
}

export type FlowDocBackendPdfExportS3ContentScanPageResultV1 =
  FlowDocBackendPdfExportContentScanPageResultV1

export interface FlowDocBackendPdfExportS3ContentAddressedStoreV1
extends FlowDocBackendPdfExportResumableContentAddressedStoreV1 {
  s3Source: typeof FLOWDOC_BACKEND_PDF_EXPORT_S3_CONTENT_STORE_V1_SOURCE
  facts: FlowDocBackendPdfExportS3ContentStoreFactsV1
  scanPage(input: {
    modifiedBefore: string
    maxScanCount: number
    cursor: string | null
  }): Promise<FlowDocBackendPdfExportS3ContentScanPageResultV1>
  close(): void
}

interface ValidatedS3OptionsV1 {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix: string
  maximumAttempts: number
  storeIdentity: string
  facts: FlowDocBackendPdfExportS3ContentStoreFactsV1
}

interface CursorV1 {
  v: 1
  storeIdentity: string
  continuationToken: string
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function errorIssue(code: string, path: string, message: string, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error)
  return issue(code, path, `${message}: ${reason}`)
}

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function storageKeyFor(digest: string): string {
  return `pdf-export-v1.sha256.${digest}.pdf`
}

function parsedStorageKey(storageKey: unknown): { storageKey: string; sha256: string } | null {
  if (typeof storageKey !== "string") return null
  const match = STORAGE_KEY.exec(storageKey)
  return match == null ? null : { storageKey, sha256: match[1]! }
}

function errorName(error: unknown): string {
  if (typeof error !== "object" || error == null) return ""
  if ("name" in error && typeof error.name === "string") return error.name
  if ("Code" in error && typeof error.Code === "string") return error.Code
  return ""
}

function notFound(error: unknown): boolean {
  const name = errorName(error)
  if (name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket") return true
  return typeof error === "object"
    && error != null
    && "$metadata" in error
    && typeof error.$metadata === "object"
    && error.$metadata != null
    && "httpStatusCode" in error.$metadata
    && error.$metadata.httpStatusCode === 404
}

function preconditionFailed(error: unknown): boolean {
  const name = errorName(error)
  if (name === "PreconditionFailed" || name === "ConditionalRequestConflict") return true
  return typeof error === "object"
    && error != null
    && "$metadata" in error
    && typeof error.$metadata === "object"
    && error.$metadata != null
    && "httpStatusCode" in error.$metadata
    && (error.$metadata.httpStatusCode === 409 || error.$metadata.httpStatusCode === 412)
}

function validatedOptions(options: FlowDocBackendPdfExportS3ContentStoreOptionsV1): ValidatedS3OptionsV1 {
  if (options.runtimeProfile !== "local-integration") {
    throw new Error("local S3-compatible storage requires runtimeProfile=local-integration")
  }
  let endpoint: URL
  try {
    endpoint = new URL(options.endpoint)
  } catch {
    throw new Error("local S3-compatible endpoint must be a valid URL")
  }
  if (
    endpoint.protocol !== "http:"
    || !LOCAL_HOSTS.has(endpoint.hostname.toLowerCase())
    || endpoint.username !== ""
    || endpoint.password !== ""
    || (endpoint.pathname !== "" && endpoint.pathname !== "/")
  ) throw new Error("local S3-compatible endpoint must be an unauthenticated loopback HTTP origin")
  if (!BUCKET.test(options.bucket)) throw new Error("local S3-compatible bucket name is invalid")
  if (typeof options.region !== "string" || options.region.trim().length === 0 || options.region.length > 64) {
    throw new Error("local S3-compatible region must be a bounded non-empty string")
  }
  if (
    typeof options.accessKeyId !== "string"
    || options.accessKeyId.length < 3
    || typeof options.secretAccessKey !== "string"
    || options.secretAccessKey.length < 8
  ) throw new Error("local S3-compatible credentials are required")
  const prefix = options.prefix ?? DEFAULT_PREFIX
  if (!/^[a-z0-9][a-z0-9/_-]{0,126}\/$/u.test(prefix) || prefix.includes("//")) {
    throw new Error("local S3-compatible prefix must be a bounded normalized path ending in slash")
  }
  const maximumAttempts = options.maximumAttempts ?? 2
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 4) {
    throw new Error("local S3-compatible maximumAttempts must be an integer from 1 through 4")
  }
  const storeFacts = {
    endpoint: endpoint.origin.toLowerCase(),
    bucket: options.bucket,
    prefix,
  }
  const storeIdentity = `sha256:${createHash("sha256").update(JSON.stringify(storeFacts)).digest("hex")}`
  return {
    endpoint: endpoint.origin,
    region: options.region,
    bucket: options.bucket,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    prefix,
    maximumAttempts,
    storeIdentity,
    facts: {
      source: FLOWDOC_BACKEND_PDF_EXPORT_S3_CONTENT_STORE_V1_SOURCE,
      runtimeProfile: "local-integration",
      endpointIdentityFingerprint: `sha256:${createHash("sha256").update(endpoint.origin.toLowerCase()).digest("hex")}`,
      bucketIdentityFingerprint: `sha256:${createHash("sha256").update(JSON.stringify({ bucket: options.bucket, prefix })).digest("hex")}`,
      forcePathStyle: true,
      loopbackOnly: true,
      bucketCreationAutomaticOnImport: false,
      resumableScan: true,
      productionBinding: false,
    },
  }
}

function createClient(options: ValidatedS3OptionsV1): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    maxAttempts: options.maximumAttempts,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  })
}

function encodeCursor(cursor: CursorV1): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

function decodeCursor(value: string | null, storeIdentity: string): string | undefined | null {
  if (value == null) return undefined
  if (value.length <= 0 || value.length > 4096) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorV1>
    if (
      parsed.v !== 1
      || parsed.storeIdentity !== storeIdentity
      || typeof parsed.continuationToken !== "string"
      || parsed.continuationToken.length <= 0
      || parsed.continuationToken.length > 2048
    ) return null
    return parsed.continuationToken
  } catch {
    return null
  }
}

function storageLocator(options: ValidatedS3OptionsV1, storageKey: string): string {
  return `s3-compatible://${options.bucket}/${options.prefix}${storageKey}`
}

function storedContent(
  options: ValidatedS3OptionsV1,
  storageKey: string,
  digest: string,
  byteLength: number,
): FlowDocBackendPdfExportStoredContentV1 {
  return {
    storageKey,
    sha256: digest,
    byteLength,
    mediaType: "application/pdf",
    storageLocator: storageLocator(options, storageKey),
  }
}

function objectKey(options: ValidatedS3OptionsV1, storageKey: string): string {
  return `${options.prefix}${storageKey}`
}

export async function ensureFlowDocBackendPdfExportLocalS3BucketV1(
  options: FlowDocBackendPdfExportS3ContentStoreOptionsV1,
): Promise<FlowDocBackendPdfExportS3ContentStoreFactsV1> {
  const validated = validatedOptions(options)
  const client = createClient(validated)
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: validated.bucket }))
    } catch (error) {
      if (!notFound(error)) throw error
      await client.send(new CreateBucketCommand({ Bucket: validated.bucket }))
      await client.send(new HeadBucketCommand({ Bucket: validated.bucket }))
    }
    return validated.facts
  } finally {
    client.destroy()
  }
}

export async function createFlowDocBackendPdfExportS3ContentAddressedStoreV1(
  input: FlowDocBackendPdfExportS3ContentStoreOptionsV1,
): Promise<FlowDocBackendPdfExportS3ContentAddressedStoreV1> {
  const options = validatedOptions(input)
  const client = createClient(options)
  try {
    await client.send(new HeadBucketCommand({ Bucket: options.bucket }))
  } catch (error) {
    client.destroy()
    throw new Error("local S3-compatible bucket is unavailable; run the explicit LOCAL-C bucket setup first", {
      cause: error,
    })
  }

  const read = async (readInput: { storageKey: string }): Promise<FlowDocBackendPdfExportContentReadResultV1> => {
    const parsed = parsedStorageKey(readInput.storageKey)
    if (parsed == null) return {
      status: "invalid",
      content: null,
      bytes: null,
      issues: [issue(
        "pdf-export-content-storage-key-invalid",
        "storageKey",
        "storage key must be a V1 SHA-256 PDF content identity",
      )],
    }
    try {
      const result = await client.send(new GetObjectCommand({
        Bucket: options.bucket,
        Key: objectKey(options, parsed.storageKey),
      }))
      if (result.Body == null) return {
        status: "storage-unavailable",
        content: null,
        bytes: null,
        issues: [issue("pdf-export-s3-content-body-missing", "contentStore", "S3 object response did not contain bytes")],
      }
      const bytes = new Uint8Array(await result.Body.transformToByteArray())
      const actualSha256 = sha256(bytes)
      const content = storedContent(options, parsed.storageKey, actualSha256, bytes.byteLength)
      if (actualSha256 !== parsed.sha256) return {
        status: "digest-mismatch",
        content,
        bytes: null,
        issues: [issue(
          "pdf-export-content-stored-digest-mismatch",
          "storageKey",
          "stored S3 bytes do not match their content-addressed key",
        )],
      }
      if (result.ContentLength != null && result.ContentLength !== bytes.byteLength) return {
        status: "digest-mismatch",
        content,
        bytes: null,
        issues: [issue(
          "pdf-export-content-stored-length-mismatch",
          "storageKey",
          "stored S3 response length does not match returned bytes",
        )],
      }
      return { status: "found", content, bytes, issues: [] }
    } catch (error) {
      if (notFound(error)) return { status: "not-found", content: null, bytes: null, issues: [] }
      return {
        status: "storage-unavailable",
        content: null,
        bytes: null,
        issues: [errorIssue("pdf-export-s3-content-read-failed", "contentStore", "S3 content read failed", error)],
      }
    }
  }

  const scanPage = async (scanInput: {
    modifiedBefore: string
    maxScanCount: number
    cursor: string | null
  }): Promise<FlowDocBackendPdfExportS3ContentScanPageResultV1> => {
    const continuationToken = decodeCursor(scanInput.cursor, options.storeIdentity)
    if (
      !exactIso(scanInput.modifiedBefore)
      || !Number.isSafeInteger(scanInput.maxScanCount)
      || scanInput.maxScanCount <= 0
      || scanInput.maxScanCount > 10_000
      || continuationToken === null
    ) return {
      status: "invalid",
      candidates: [],
      scannedCount: 0,
      truncated: false,
      nextCursor: null,
      issues: [issue(
        "pdf-export-s3-content-scan-input-invalid",
        "scan",
        "S3 scan requires an exact time, bounded count, and matching continuation cursor",
      )],
    }
    try {
      const result = await client.send(new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: options.prefix,
        MaxKeys: scanInput.maxScanCount,
        ContinuationToken: continuationToken,
      }))
      const objects = result.Contents ?? []
      const candidates: FlowDocBackendPdfExportContentCandidateV1[] = []
      for (const object of objects) {
        if (object.Key == null || !object.Key.startsWith(options.prefix)) continue
        const storageKey = object.Key.slice(options.prefix.length)
        const parsed = parsedStorageKey(storageKey)
        if (parsed == null || object.LastModified == null || object.Size == null) continue
        if (object.LastModified.getTime() >= Date.parse(scanInput.modifiedBefore)) continue
        candidates.push({
          storageKey: parsed.storageKey,
          sha256: parsed.sha256,
          byteLength: object.Size,
          modifiedAt: object.LastModified.toISOString(),
          storageLocator: storageLocator(options, parsed.storageKey),
        })
      }
      const nextCursor = result.IsTruncated === true && typeof result.NextContinuationToken === "string"
        ? encodeCursor({
            v: 1,
            storeIdentity: options.storeIdentity,
            continuationToken: result.NextContinuationToken,
          })
        : null
      return {
        status: "ready",
        candidates,
        scannedCount: objects.length,
        truncated: nextCursor != null,
        nextCursor,
        issues: [],
      }
    } catch (error) {
      return {
        status: "storage-unavailable",
        candidates: [],
        scannedCount: 0,
        truncated: false,
        nextCursor: null,
        issues: [errorIssue("pdf-export-s3-content-scan-failed", "contentStore", "S3 content scan failed", error)],
      }
    }
  }

  return {
    source: FLOWDOC_BACKEND_PDF_EXPORT_CONTENT_STORE_V1_SOURCE,
    s3Source: FLOWDOC_BACKEND_PDF_EXPORT_S3_CONTENT_STORE_V1_SOURCE,
    facts: options.facts,

    async write(writeInput): Promise<FlowDocBackendPdfExportContentWriteResultV1> {
      if (!(writeInput.bytes instanceof Uint8Array) || writeInput.bytes.byteLength <= 0) return {
        status: "invalid",
        content: null,
        issues: [issue("pdf-export-content-bytes-invalid", "bytes", "content bytes must be a non-empty Uint8Array")],
      }
      if (!SHA256.test(writeInput.expectedSha256)) return {
        status: "invalid",
        content: null,
        issues: [issue("pdf-export-content-sha256-invalid", "expectedSha256", "expected SHA-256 must be lowercase hexadecimal")],
      }
      if (!Number.isSafeInteger(writeInput.expectedByteLength) || writeInput.expectedByteLength <= 0) return {
        status: "invalid",
        content: null,
        issues: [issue("pdf-export-content-byte-length-invalid", "expectedByteLength", "expected byte length must be a positive integer")],
      }
      const actualSha256 = sha256(writeInput.bytes)
      if (
        actualSha256 !== writeInput.expectedSha256
        || writeInput.bytes.byteLength !== writeInput.expectedByteLength
      ) return {
        status: "digest-mismatch",
        content: null,
        issues: [issue(
          "pdf-export-content-input-evidence-mismatch",
          "bytes",
          "supplied bytes must match the exact expected SHA-256 and byte length",
        )],
      }
      const storageKey = storageKeyFor(actualSha256)
      const existing = await read({ storageKey })
      if (existing.status === "found") return existing.content.byteLength === writeInput.expectedByteLength
        ? { status: "idempotent-replay", content: existing.content, issues: [] }
        : {
            status: "digest-mismatch",
            content: null,
            issues: [issue(
              "pdf-export-content-existing-length-mismatch",
              "storageKey",
              "existing S3 content-addressed bytes have a different length",
            )],
          }
      if (existing.status !== "not-found") return {
        status: existing.status === "invalid" ? "invalid" : existing.status,
        content: null,
        issues: existing.issues,
      }
      let publishedByThisWrite = true
      try {
        await client.send(new PutObjectCommand({
          Bucket: options.bucket,
          Key: objectKey(options, storageKey),
          Body: writeInput.bytes,
          ContentLength: writeInput.bytes.byteLength,
          ContentType: "application/pdf",
          IfNoneMatch: "*",
          Metadata: {
            "flowdoc-sha256": actualSha256,
            "flowdoc-byte-length": String(writeInput.bytes.byteLength),
          },
        }))
      } catch (error) {
        if (!preconditionFailed(error)) return {
          status: "storage-unavailable",
          content: null,
          issues: [errorIssue("pdf-export-s3-content-write-failed", "contentStore", "S3 content write failed", error)],
        }
        publishedByThisWrite = false
      }
      const published = await read({ storageKey })
      if (
        published.status !== "found"
        || published.content.byteLength !== writeInput.expectedByteLength
        || published.content.sha256 !== writeInput.expectedSha256
      ) return {
        status: published.status === "invalid"
          ? "invalid"
          : published.status === "digest-mismatch"
            ? "digest-mismatch"
            : "storage-unavailable",
        content: null,
        issues: published.status === "found" ? [issue(
          "pdf-export-content-published-length-mismatch",
          "storageKey",
          "published S3 content-addressed bytes have a different length",
        )] : published.issues,
      }
      return {
        status: publishedByThisWrite ? "written" : "idempotent-replay",
        content: published.content,
        issues: [],
      }
    },

    read,

    async scan(scanInput): Promise<FlowDocBackendPdfExportContentScanResultV1> {
      const page = await scanPage({ ...scanInput, cursor: null })
      if (page.status !== "ready") return {
        status: page.status,
        candidates: [],
        scannedCount: page.scannedCount,
        truncated: false,
        issues: page.issues,
      }
      return {
        status: "ready",
        candidates: page.candidates,
        scannedCount: page.scannedCount,
        truncated: page.truncated,
        issues: [],
      }
    },

    scanPage,

    async delete(deleteInput): Promise<FlowDocBackendPdfExportContentDeleteResultV1> {
      const retained = await read(deleteInput)
      if (retained.status === "not-found") return { status: "not-found", issues: [] }
      if (retained.status !== "found") return { status: retained.status, issues: retained.issues }
      try {
        await client.send(new DeleteObjectCommand({
          Bucket: options.bucket,
          Key: objectKey(options, retained.content.storageKey),
        }))
        return { status: "deleted", issues: [] }
      } catch (error) {
        if (notFound(error)) return { status: "not-found", issues: [] }
        return {
          status: "storage-unavailable",
          issues: [errorIssue("pdf-export-s3-content-delete-failed", "contentStore", "S3 content delete failed", error)],
        }
      }
    },

    close() {
      client.destroy()
    },
  }
}
