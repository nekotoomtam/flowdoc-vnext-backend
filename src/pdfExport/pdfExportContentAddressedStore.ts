import { createHash, randomUUID } from "node:crypto"
import { link, mkdir, open, opendir, readFile, stat, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"
import {
  flowDocBackendPdfExportOperationIssueV1,
  type FlowDocBackendPdfExportOperationIssueV1,
} from "./pdfExportOperation.js"

export const FLOWDOC_BACKEND_PDF_EXPORT_CONTENT_STORE_V1_SOURCE =
  "flowdoc-backend-pdf-export-content-store" as const
export const FLOWDOC_BACKEND_PDF_EXPORT_CONTENT_STORE_V1_MODE =
  "filesystem-content-addressed-pdf-bytes" as const

const DIRECTORY_NAME = "pdf-export-content-v1"
const STORAGE_KEY = /^pdf-export-v1\.sha256\.([a-f0-9]{64})\.pdf$/u
const SHA256 = /^[a-f0-9]{64}$/u

export interface FlowDocBackendPdfExportStoredContentV1 {
  storageKey: string
  sha256: string
  byteLength: number
  mediaType: "application/pdf"
  storageLocator: string
}

export type FlowDocBackendPdfExportContentWriteResultV1 =
  | {
      status: "written" | "idempotent-replay"
      content: FlowDocBackendPdfExportStoredContentV1
      issues: []
    }
  | {
      status: "invalid" | "digest-mismatch" | "storage-unavailable"
      content: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportContentReadResultV1 =
  | {
      status: "found"
      content: FlowDocBackendPdfExportStoredContentV1
      bytes: Uint8Array
      issues: []
    }
  | {
      status: "not-found" | "invalid" | "digest-mismatch" | "storage-unavailable"
      content: FlowDocBackendPdfExportStoredContentV1 | null
      bytes: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export interface FlowDocBackendPdfExportContentCandidateV1 {
  storageKey: string
  sha256: string
  byteLength: number
  modifiedAt: string
  storageLocator: string
}

export type FlowDocBackendPdfExportContentScanResultV1 =
  | {
      status: "ready"
      candidates: FlowDocBackendPdfExportContentCandidateV1[]
      scannedCount: number
      truncated: boolean
      issues: []
    }
  | {
      status: "invalid" | "storage-unavailable"
      candidates: []
      scannedCount: number
      truncated: false
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportContentScanPageResultV1 =
  | {
      status: "ready"
      candidates: FlowDocBackendPdfExportContentCandidateV1[]
      scannedCount: number
      truncated: boolean
      nextCursor: string | null
      issues: []
    }
  | {
      status: "invalid" | "storage-unavailable"
      candidates: []
      scannedCount: number
      truncated: false
      nextCursor: null
      issues: FlowDocBackendPdfExportOperationIssueV1[]
    }

export type FlowDocBackendPdfExportContentDeleteResultV1 =
  | { status: "deleted" | "not-found"; issues: [] }
  | { status: "invalid" | "digest-mismatch" | "storage-unavailable"; issues: FlowDocBackendPdfExportOperationIssueV1[] }

export interface FlowDocBackendPdfExportContentAddressedStoreV1 {
  source: typeof FLOWDOC_BACKEND_PDF_EXPORT_CONTENT_STORE_V1_SOURCE
  write(input: {
    bytes: Uint8Array
    expectedSha256: string
    expectedByteLength: number
  }): Promise<FlowDocBackendPdfExportContentWriteResultV1>
  read(input: { storageKey: string }): Promise<FlowDocBackendPdfExportContentReadResultV1>
  scan(input: {
    modifiedBefore: string
    maxScanCount: number
  }): Promise<FlowDocBackendPdfExportContentScanResultV1>
  delete(input: { storageKey: string }): Promise<FlowDocBackendPdfExportContentDeleteResultV1>
}

export interface FlowDocBackendPdfExportResumableContentAddressedStoreV1
extends FlowDocBackendPdfExportContentAddressedStoreV1 {
  scanPage(input: {
    modifiedBefore: string
    maxScanCount: number
    cursor: string | null
  }): Promise<FlowDocBackendPdfExportContentScanPageResultV1>
}

export interface FlowDocBackendPdfExportFileContentStoreOptionsV1 {
  rootDirectory: string
}

function issue(code: string, path: string, message: string): FlowDocBackendPdfExportOperationIssueV1 {
  return flowDocBackendPdfExportOperationIssueV1(code, path, message)
}

function errorIssue(code: string, path: string, message: string, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error)
  return issue(code, path, `${message}: ${reason}`)
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

function exactIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function noEntry(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && error.code === "ENOENT"
}

function alreadyExists(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && error.code === "EEXIST"
}

export class FlowDocBackendPdfExportFileContentAddressedStoreV1
implements FlowDocBackendPdfExportContentAddressedStoreV1 {
  readonly source = FLOWDOC_BACKEND_PDF_EXPORT_CONTENT_STORE_V1_SOURCE
  readonly rootDirectory: string
  readonly contentDirectory: string

  constructor(options: FlowDocBackendPdfExportFileContentStoreOptionsV1) {
    this.rootDirectory = resolve(options.rootDirectory)
    this.contentDirectory = join(this.rootDirectory, DIRECTORY_NAME)
  }

  async write(input: {
    bytes: Uint8Array
    expectedSha256: string
    expectedByteLength: number
  }): Promise<FlowDocBackendPdfExportContentWriteResultV1> {
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength <= 0) return {
      status: "invalid",
      content: null,
      issues: [issue("pdf-export-content-bytes-invalid", "bytes", "content bytes must be a non-empty Uint8Array")],
    }
    if (!SHA256.test(input.expectedSha256)) return {
      status: "invalid",
      content: null,
      issues: [issue("pdf-export-content-sha256-invalid", "expectedSha256", "expected SHA-256 must be lowercase hexadecimal")],
    }
    if (!Number.isInteger(input.expectedByteLength) || input.expectedByteLength <= 0) return {
      status: "invalid",
      content: null,
      issues: [issue("pdf-export-content-byte-length-invalid", "expectedByteLength", "expected byte length must be a positive integer")],
    }
    const actualSha256 = sha256(input.bytes)
    if (actualSha256 !== input.expectedSha256 || input.bytes.byteLength !== input.expectedByteLength) return {
      status: "digest-mismatch",
      content: null,
      issues: [issue(
        "pdf-export-content-input-evidence-mismatch",
        "bytes",
        "supplied bytes must match the exact expected SHA-256 and byte length",
      )],
    }

    const storageKey = storageKeyFor(actualSha256)
    const filePath = join(this.contentDirectory, storageKey)
    const content: FlowDocBackendPdfExportStoredContentV1 = {
      storageKey,
      sha256: actualSha256,
      byteLength: input.bytes.byteLength,
      mediaType: "application/pdf",
      storageLocator: filePath,
    }
    try {
      await mkdir(this.contentDirectory, { recursive: true })
      const existing = await this.read({ storageKey })
      if (existing.status === "found") {
        if (existing.content.byteLength !== input.expectedByteLength) return {
          status: "digest-mismatch",
          content: null,
          issues: [issue("pdf-export-content-existing-length-mismatch", "storageKey", "existing content-addressed bytes have a different length")],
        }
        return { status: "idempotent-replay", content: existing.content, issues: [] }
      }
      if (existing.status !== "not-found") return {
        status: existing.status === "invalid" ? "invalid" : existing.status,
        content: null,
        issues: existing.issues,
      }

      const temporaryPath = join(this.contentDirectory, `.pending.${actualSha256}.${randomUUID()}`)
      const handle = await open(temporaryPath, "wx", 0o600)
      try {
        await handle.writeFile(input.bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      let publishedByThisWrite = true
      try {
        await link(temporaryPath, filePath)
      } catch (error) {
        if (!alreadyExists(error)) throw error
        publishedByThisWrite = false
      } finally {
        await unlink(temporaryPath).catch(() => undefined)
      }
      const published = await this.read({ storageKey })
      if (published.status !== "found" || published.content.byteLength !== input.expectedByteLength) return {
        status: published.status === "invalid"
          ? "invalid"
          : published.status === "digest-mismatch"
            ? "digest-mismatch"
            : "storage-unavailable",
        content: null,
        issues: published.status === "found" ? [issue(
          "pdf-export-content-published-length-mismatch",
          "storageKey",
          "published content-addressed bytes have a different length",
        )] : published.issues,
      }
      return {
        status: publishedByThisWrite ? "written" : "idempotent-replay",
        content: published.content,
        issues: [],
      }
    } catch (error) {
      return {
        status: "storage-unavailable",
        content: null,
        issues: [errorIssue("pdf-export-content-write-failed", "contentStore", "content-addressed write failed", error)],
      }
    }
  }

  async read(input: { storageKey: string }): Promise<FlowDocBackendPdfExportContentReadResultV1> {
    const parsed = parsedStorageKey(input.storageKey)
    if (parsed == null) return {
      status: "invalid",
      content: null,
      bytes: null,
      issues: [issue("pdf-export-content-storage-key-invalid", "storageKey", "storage key must be a V1 SHA-256 PDF content identity")],
    }
    const filePath = join(this.contentDirectory, parsed.storageKey)
    try {
      const bytes = new Uint8Array(await readFile(filePath))
      const actualSha256 = sha256(bytes)
      const content: FlowDocBackendPdfExportStoredContentV1 = {
        storageKey: parsed.storageKey,
        sha256: actualSha256,
        byteLength: bytes.byteLength,
        mediaType: "application/pdf",
        storageLocator: filePath,
      }
      if (actualSha256 !== parsed.sha256) return {
        status: "digest-mismatch",
        content,
        bytes: null,
        issues: [issue("pdf-export-content-stored-digest-mismatch", "storageKey", "stored bytes do not match their content-addressed key")],
      }
      return { status: "found", content, bytes, issues: [] }
    } catch (error) {
      if (noEntry(error)) return { status: "not-found", content: null, bytes: null, issues: [] }
      return {
        status: "storage-unavailable",
        content: null,
        bytes: null,
        issues: [errorIssue("pdf-export-content-read-failed", "contentStore", "content-addressed read failed", error)],
      }
    }
  }

  async scan(input: {
    modifiedBefore: string
    maxScanCount: number
  }): Promise<FlowDocBackendPdfExportContentScanResultV1> {
    if (!exactIso(input.modifiedBefore) || !Number.isInteger(input.maxScanCount) || input.maxScanCount <= 0) return {
      status: "invalid",
      candidates: [],
      scannedCount: 0,
      truncated: false,
      issues: [issue("pdf-export-content-scan-input-invalid", "scan", "scan requires an exact time and positive bounded count")],
    }
    const candidates: FlowDocBackendPdfExportContentCandidateV1[] = []
    let scannedCount = 0
    try {
      const directory = await opendir(this.contentDirectory)
      for await (const entry of directory) {
        if (!entry.isFile() || parsedStorageKey(entry.name) == null) continue
        if (scannedCount >= input.maxScanCount) return {
          status: "ready",
          candidates,
          scannedCount,
          truncated: true,
          issues: [],
        }
        scannedCount += 1
        const filePath = join(this.contentDirectory, entry.name)
        const file = await stat(filePath)
        if (file.mtimeMs >= Date.parse(input.modifiedBefore)) continue
        const parsed = parsedStorageKey(entry.name)!
        candidates.push({
          storageKey: entry.name,
          sha256: parsed.sha256,
          byteLength: file.size,
          modifiedAt: file.mtime.toISOString(),
          storageLocator: filePath,
        })
      }
      return { status: "ready", candidates, scannedCount, truncated: false, issues: [] }
    } catch (error) {
      if (noEntry(error)) return { status: "ready", candidates: [], scannedCount: 0, truncated: false, issues: [] }
      return {
        status: "storage-unavailable",
        candidates: [],
        scannedCount,
        truncated: false,
        issues: [errorIssue("pdf-export-content-scan-failed", "contentStore", "content-addressed scan failed", error)],
      }
    }
  }

  async delete(input: { storageKey: string }): Promise<FlowDocBackendPdfExportContentDeleteResultV1> {
    const read = await this.read(input)
    if (read.status === "not-found") return { status: "not-found", issues: [] }
    if (read.status !== "found") return { status: read.status, issues: read.issues }
    try {
      await unlink(read.content.storageLocator)
      return { status: "deleted", issues: [] }
    } catch (error) {
      if (noEntry(error)) return { status: "not-found", issues: [] }
      return {
        status: "storage-unavailable",
        issues: [errorIssue("pdf-export-content-delete-failed", "contentStore", "content-addressed delete failed", error)],
      }
    }
  }
}

export function createFlowDocBackendPdfExportFileContentAddressedStoreV1(
  options: FlowDocBackendPdfExportFileContentStoreOptionsV1,
): FlowDocBackendPdfExportContentAddressedStoreV1 {
  return new FlowDocBackendPdfExportFileContentAddressedStoreV1(options)
}
