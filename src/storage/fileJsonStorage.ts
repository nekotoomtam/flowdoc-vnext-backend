import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import {
  VNEXT_STORAGE_ADAPTER_SCHEMA_VERSION,
  createVNextStorageReadResult,
  evaluateVNextStorageWriteRequest,
} from "@flowdoc/vnext-core"
import type {
  VNextArtifactJobRecord,
  VNextArtifactManifestRecord,
  VNextDurableHistorySnapshot,
  VNextStorageOperationIssue,
  VNextStorageReadRequest,
  VNextStorageRecordEnvelope,
  VNextStorageRecordKind,
  VNextStorageWriteRequest,
} from "@flowdoc/vnext-core"
import type { FlowDocBackendRichInlineSessionRecord } from "./richInlineSessionRecord.js"
import type { FlowDocBackendSessionStorageRecord } from "./sessionRecord.js"

export const FLOWDOC_FILE_JSON_STORAGE_SOURCE = "flowdoc-file-json-storage-adapter"
export const FLOWDOC_FILE_JSON_STORAGE_MODE = "backend-file-backed-json-record-storage"
export const FLOWDOC_FILE_JSON_STORAGE_PACKAGE = "flowdoc-vnext-backend"
export const FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE = "flowdoc-file-json-artifact-byte-store"
export const FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE = "backend-file-backed-artifact-byte-store"

const ARTIFACT_BYTE_DIRECTORY_NAME = "artifact-bytes"
const ARTIFACT_BYTE_STORAGE_KEY_PREFIX = "artifact-bytes-v1"
const SHA256_HEX = /^[a-f0-9]{64}$/u
const ARTIFACT_BYTE_STORAGE_KEY = /^artifact-bytes-v1\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})\.bin$/u

export type FlowDocFileJsonStorageWriteStatus =
  | "written"
  | "idempotent-replay"
  | "conflict"
  | "invalid-request"
  | "io-error"

export type FlowDocFileJsonStorageReadStatus =
  | "found"
  | "not-found"
  | "invalid-request"
  | "io-error"

export type FlowDocFileJsonArtifactByteWriteStatus =
  | "written"
  | "invalid-request"
  | "digest-mismatch"
  | "io-error"

export type FlowDocFileJsonArtifactByteReadStatus =
  | "found"
  | "missing"
  | "invalid-request"
  | "digest-mismatch"
  | "io-error"

export type FlowDocFileJsonArtifactByteConsistencyStatus =
  | "consistent"
  | "inconsistent"
  | "missing"
  | "invalid-manifest"
  | "digest-mismatch"
  | "io-error"

export interface FlowDocFileJsonStorageAdapterContracts {
  backendOwnedModule: true
  importsCoreAsPublicPackage: true
  consumesCoreStorageContracts: true
  concreteBackend: "file-backed-json"
  filesystemWrites: true
  databaseWrites: false
  objectStorageWrites: false
  browserStorageWrites: false
  networkCalls: false
  authzExecution: false
  schemaMigration: false
  artifactByteWrites: false
  multiRecordTransactions: false
  productionStorageReady: false
}

export interface FlowDocFileJsonArtifactByteStoreContracts {
  backendOwnedModule: true
  importsCoreAsPublicPackage: true
  concreteBackend: "filesystem-artifact-bytes"
  filesystemWrites: true
  recordEnvelopeWrites: false
  databaseWrites: false
  objectStorageWrites: false
  browserStorageWrites: false
  networkCalls: false
  authzExecution: false
  schemaMigration: false
  artifactByteWrites: true
  manifestMutation: false
  multiRecordTransactions: false
  rendererExecution: false
  backendRoute: false
  productionStorageReady: false
}

export interface FlowDocFileJsonStorageCollectionPlan {
  kind: VNextStorageRecordKind
  directoryName: string
  stores: "json-record-envelope"
  artifactBytes: false
}

export interface FlowDocFileJsonStorageAdapterPlan {
  source: typeof FLOWDOC_FILE_JSON_STORAGE_SOURCE
  mode: typeof FLOWDOC_FILE_JSON_STORAGE_MODE
  status: "internal-alpha-record-adapter"
  adapterPackageName: typeof FLOWDOC_FILE_JSON_STORAGE_PACKAGE
  corePackageName: "@flowdoc/vnext-core"
  rootDirectory: string
  collections: {
    packageSessions: FlowDocFileJsonStorageCollectionPlan
    durableHistories: FlowDocFileJsonStorageCollectionPlan
    richInlineSessions: FlowDocFileJsonStorageCollectionPlan
    artifactManifests: FlowDocFileJsonStorageCollectionPlan
    artifactJobs: FlowDocFileJsonStorageCollectionPlan
  }
  concurrency: {
    expectedRevision: "null-for-create-or-exact-number-for-update"
    idempotencyKey: "replays-the-same-accepted-write-for-one-record"
    revision: "increments-on-accepted-update"
  }
  contracts: FlowDocFileJsonStorageAdapterContracts
}

export interface FlowDocFileJsonArtifactByteStorePlan {
  source: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE
  mode: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE
  status: "internal-alpha-byte-store"
  adapterPackageName: typeof FLOWDOC_FILE_JSON_STORAGE_PACKAGE
  corePackageName: "@flowdoc/vnext-core"
  rootDirectory: string
  byteDirectoryName: typeof ARTIFACT_BYTE_DIRECTORY_NAME
  storageKeyFormat: "artifact-bytes-v1.<base64url-artifact-id>.<sha256>.bin"
  consistencyCheck: {
    readsBytes: true
    comparesArtifactId: true
    comparesByteLength: true
    comparesSha256: true
    mutatesManifest: false
  }
  contracts: FlowDocFileJsonArtifactByteStoreContracts
}

export type FlowDocFileJsonStorageWriteResult<TRecord> =
  | {
      ok: true
      source: typeof FLOWDOC_FILE_JSON_STORAGE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_STORAGE_MODE
      status: "written" | "idempotent-replay"
      record: VNextStorageRecordEnvelope<TRecord>
      conflict: null
      issues: []
      storageKey: string
      filePath: string
      contracts: FlowDocFileJsonStorageAdapterContracts
    }
  | {
      ok: false
      source: typeof FLOWDOC_FILE_JSON_STORAGE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_STORAGE_MODE
      status: "conflict" | "invalid-request" | "io-error"
      record: null
      conflict: {
        expectedRevision: number | null
        actualRevision: number | null
      } | null
      issues: VNextStorageOperationIssue[]
      storageKey: string | null
      filePath: string | null
      contracts: FlowDocFileJsonStorageAdapterContracts
    }

export type FlowDocFileJsonStorageReadResult<TRecord> =
  | {
      ok: true
      source: typeof FLOWDOC_FILE_JSON_STORAGE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_STORAGE_MODE
      status: "found"
      record: VNextStorageRecordEnvelope<TRecord>
      issues: []
      storageKey: string
      filePath: string
      contracts: FlowDocFileJsonStorageAdapterContracts
    }
  | {
      ok: false
      source: typeof FLOWDOC_FILE_JSON_STORAGE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_STORAGE_MODE
      status: "not-found" | "invalid-request" | "io-error"
      record: null
      issues: VNextStorageOperationIssue[]
      storageKey: string | null
      filePath: string | null
      contracts: FlowDocFileJsonStorageAdapterContracts
    }

export interface FlowDocFileJsonArtifactByteMetadata {
  artifactId: string
  mediaType: string | null
  byteLength: number
  sha256: string
  storageKey: string
  filePath: string
}

export interface FlowDocFileJsonArtifactByteWriteRequest {
  artifactId: string
  mediaType: string
  bytes: Uint8Array
  expectedSha256?: string | null
}

export interface FlowDocFileJsonArtifactByteReadRequest {
  storageKey: string
}

export type FlowDocFileJsonArtifactByteWriteResult =
  | {
      ok: true
      source: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE
      status: "written"
      artifact: FlowDocFileJsonArtifactByteMetadata
      issues: []
      contracts: FlowDocFileJsonArtifactByteStoreContracts
    }
  | {
      ok: false
      source: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE
      status: "invalid-request" | "digest-mismatch" | "io-error"
      artifact: null
      issues: VNextStorageOperationIssue[]
      contracts: FlowDocFileJsonArtifactByteStoreContracts
    }

export type FlowDocFileJsonArtifactByteReadResult =
  | {
      ok: true
      source: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE
      status: "found"
      artifact: FlowDocFileJsonArtifactByteMetadata
      bytes: Uint8Array
      issues: []
      contracts: FlowDocFileJsonArtifactByteStoreContracts
    }
  | {
      ok: false
      source: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE
      status: "missing" | "invalid-request" | "digest-mismatch" | "io-error"
      artifact: FlowDocFileJsonArtifactByteMetadata | null
      bytes: null
      issues: VNextStorageOperationIssue[]
      contracts: FlowDocFileJsonArtifactByteStoreContracts
    }

export type FlowDocFileJsonArtifactByteConsistencyResult =
  | {
      ok: true
      source: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE
      status: "consistent"
      manifest: VNextArtifactManifestRecord
      artifact: FlowDocFileJsonArtifactByteMetadata
      issues: []
      contracts: FlowDocFileJsonArtifactByteStoreContracts
    }
  | {
      ok: false
      source: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE
      mode: typeof FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE
      status: "inconsistent" | "missing" | "invalid-manifest" | "digest-mismatch" | "io-error"
      manifest: VNextArtifactManifestRecord | null
      artifact: FlowDocFileJsonArtifactByteMetadata | null
      issues: VNextStorageOperationIssue[]
      contracts: FlowDocFileJsonArtifactByteStoreContracts
    }

export interface FlowDocFileJsonStorageAdapter {
  source: typeof FLOWDOC_FILE_JSON_STORAGE_SOURCE
  mode: typeof FLOWDOC_FILE_JSON_STORAGE_MODE
  rootDirectory: string
  contracts: FlowDocFileJsonStorageAdapterContracts
  packageSessions: FlowDocFileJsonStorageCollection<FlowDocBackendSessionStorageRecord>
  durableHistories: FlowDocFileJsonStorageCollection<VNextDurableHistorySnapshot>
  richInlineSessions: FlowDocFileJsonStorageCollection<FlowDocBackendRichInlineSessionRecord>
  artifactManifests: FlowDocFileJsonStorageCollection<VNextArtifactManifestRecord>
  artifactJobs: FlowDocFileJsonStorageCollection<VNextArtifactJobRecord>
  plan(): FlowDocFileJsonStorageAdapterPlan
}

export interface FlowDocFileJsonStorageAdapterInput {
  rootDirectory: string
}

export interface FlowDocFileJsonArtifactByteStoreInput {
  rootDirectory: string
}

function contracts(): FlowDocFileJsonStorageAdapterContracts {
  return {
    backendOwnedModule: true,
    importsCoreAsPublicPackage: true,
    consumesCoreStorageContracts: true,
    concreteBackend: "file-backed-json",
    filesystemWrites: true,
    databaseWrites: false,
    objectStorageWrites: false,
    browserStorageWrites: false,
    networkCalls: false,
    authzExecution: false,
    schemaMigration: false,
    artifactByteWrites: false,
    multiRecordTransactions: false,
    productionStorageReady: false,
  }
}

function artifactByteContracts(): FlowDocFileJsonArtifactByteStoreContracts {
  return {
    backendOwnedModule: true,
    importsCoreAsPublicPackage: true,
    concreteBackend: "filesystem-artifact-bytes",
    filesystemWrites: true,
    recordEnvelopeWrites: false,
    databaseWrites: false,
    objectStorageWrites: false,
    browserStorageWrites: false,
    networkCalls: false,
    authzExecution: false,
    schemaMigration: false,
    artifactByteWrites: true,
    manifestMutation: false,
    multiRecordTransactions: false,
    rendererExecution: false,
    backendRoute: false,
    productionStorageReady: false,
  }
}

function collectionPlan(kind: VNextStorageRecordKind, directoryName: string): FlowDocFileJsonStorageCollectionPlan {
  return {
    kind,
    directoryName,
    stores: "json-record-envelope",
    artifactBytes: false,
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function issue(code: string, path: string, message: string): VNextStorageOperationIssue {
  return {
    severity: "blocking",
    code,
    path,
    message,
  }
}

function storageKeyFor(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url")
}

function artifactByteStorageKeyFor(artifactId: string, sha256: string): string {
  return `${ARTIFACT_BYTE_STORAGE_KEY_PREFIX}.${Buffer.from(artifactId, "utf8").toString("base64url")}.${sha256}.bin`
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function isNoEntryError(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && error.code === "ENOENT"
}

function issueFromError(code: string, path: string, message: string, error: unknown): VNextStorageOperationIssue {
  const reason = error instanceof Error ? error.message : String(error)
  return issue(code, path, `${message}: ${reason}`)
}

function nonEmptyValue(value: unknown, path: string, issues: VNextStorageOperationIssue[]): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value

  issues.push(issue("invalid-string", path, `${path} must be a non-empty string`))
  return null
}

function validateExpectedSha256(value: unknown, issues: VNextStorageOperationIssue[]): string | null {
  if (value == null) return null
  if (typeof value === "string" && SHA256_HEX.test(value)) return value

  issues.push(issue("invalid-sha256", "expectedSha256", "expectedSha256 must be null or a 64 character lowercase hex digest"))
  return null
}

function validateBytes(value: unknown, issues: VNextStorageOperationIssue[]): Uint8Array | null {
  if (value instanceof Uint8Array && value.byteLength > 0) return value

  issues.push(issue("invalid-bytes", "bytes", "bytes must be a non-empty Uint8Array"))
  return null
}

function parseArtifactByteStorageKey(storageKey: string, issues: VNextStorageOperationIssue[]): {
  artifactId: string
  sha256: string
} | null {
  const match = ARTIFACT_BYTE_STORAGE_KEY.exec(storageKey)

  if (match == null) {
    issues.push(issue("invalid-storage-key", "storageKey", "storageKey must use artifact-bytes-v1.<base64url-artifact-id>.<sha256>.bin"))
    return null
  }

  const encodedArtifactId = match[1]
  const sha256 = match[2]
  const artifactId = Buffer.from(encodedArtifactId, "base64url").toString("utf8")

  if (artifactId.trim().length === 0) {
    issues.push(issue("invalid-storage-key-artifact-id", "storageKey", "storageKey must encode a non-empty artifact id"))
    return null
  }

  return {
    artifactId,
    sha256,
  }
}

function artifactByteWriteResult(
  artifact: FlowDocFileJsonArtifactByteMetadata,
): FlowDocFileJsonArtifactByteWriteResult {
  return {
    ok: true,
    source: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE,
    mode: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE,
    status: "written",
    artifact,
    issues: [],
    contracts: artifactByteContracts(),
  }
}

function blockedArtifactByteWriteResult(
  status: "invalid-request" | "digest-mismatch" | "io-error",
  issues: VNextStorageOperationIssue[],
): FlowDocFileJsonArtifactByteWriteResult {
  return {
    ok: false,
    source: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE,
    mode: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE,
    status,
    artifact: null,
    issues,
    contracts: artifactByteContracts(),
  }
}

function artifactByteReadResult(
  artifact: FlowDocFileJsonArtifactByteMetadata,
  bytes: Uint8Array,
): FlowDocFileJsonArtifactByteReadResult {
  return {
    ok: true,
    source: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE,
    mode: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE,
    status: "found",
    artifact,
    bytes: new Uint8Array(bytes),
    issues: [],
    contracts: artifactByteContracts(),
  }
}

function blockedArtifactByteReadResult(
  status: "missing" | "invalid-request" | "digest-mismatch" | "io-error",
  issues: VNextStorageOperationIssue[],
  artifact: FlowDocFileJsonArtifactByteMetadata | null,
): FlowDocFileJsonArtifactByteReadResult {
  return {
    ok: false,
    source: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE,
    mode: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE,
    status,
    artifact,
    bytes: null,
    issues,
    contracts: artifactByteContracts(),
  }
}

function artifactByteConsistencyResult(
  manifest: VNextArtifactManifestRecord,
  artifact: FlowDocFileJsonArtifactByteMetadata,
): FlowDocFileJsonArtifactByteConsistencyResult {
  return {
    ok: true,
    source: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE,
    mode: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE,
    status: "consistent",
    manifest: cloneJson(manifest),
    artifact,
    issues: [],
    contracts: artifactByteContracts(),
  }
}

function blockedArtifactByteConsistencyResult(
  status: "inconsistent" | "missing" | "invalid-manifest" | "digest-mismatch" | "io-error",
  issues: VNextStorageOperationIssue[],
  manifest: VNextArtifactManifestRecord | null,
  artifact: FlowDocFileJsonArtifactByteMetadata | null,
): FlowDocFileJsonArtifactByteConsistencyResult {
  return {
    ok: false,
    source: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE,
    mode: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE,
    status,
    manifest: manifest == null ? null : cloneJson(manifest),
    artifact,
    issues,
    contracts: artifactByteContracts(),
  }
}

function validateStoredEnvelope<TRecord>(
  value: unknown,
  kind: VNextStorageRecordKind,
  key: string,
): VNextStorageRecordEnvelope<TRecord> | VNextStorageOperationIssue[] {
  const issues: VNextStorageOperationIssue[] = []

  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return [issue("invalid-json-record", "record", "stored record envelope must be a JSON object")]
  }

  const envelope = value as Partial<VNextStorageRecordEnvelope<TRecord>>

  if (envelope.schemaVersion !== VNEXT_STORAGE_ADAPTER_SCHEMA_VERSION) {
    issues.push(issue("invalid-schema-version", "schemaVersion", "stored record envelope has an unsupported schema version"))
  }

  if (envelope.kind !== kind) {
    issues.push(issue("kind-mismatch", "kind", "stored record envelope kind does not match the collection"))
  }

  if (envelope.key !== key) {
    issues.push(issue("key-mismatch", "key", "stored record envelope key does not match the requested key"))
  }

  if (typeof envelope.revision !== "number" || !Number.isInteger(envelope.revision) || envelope.revision < 0) {
    issues.push(issue("invalid-revision", "revision", "stored record revision must be a non-negative integer"))
  }

  if (typeof envelope.metadata !== "object" || envelope.metadata == null) {
    issues.push(issue("invalid-metadata", "metadata", "stored record metadata must be a JSON object"))
  }

  if (issues.length > 0) return issues

  return cloneJson(envelope as VNextStorageRecordEnvelope<TRecord>)
}

function writeResult<TRecord>(
  status: "written" | "idempotent-replay",
  record: VNextStorageRecordEnvelope<TRecord>,
  storageKey: string,
  filePath: string,
): FlowDocFileJsonStorageWriteResult<TRecord> {
  return {
    ok: true,
    source: FLOWDOC_FILE_JSON_STORAGE_SOURCE,
    mode: FLOWDOC_FILE_JSON_STORAGE_MODE,
    status,
    record: cloneJson(record),
    conflict: null,
    issues: [],
    storageKey,
    filePath,
    contracts: contracts(),
  }
}

function blockedWriteResult<TRecord>(
  status: "conflict" | "invalid-request" | "io-error",
  issues: VNextStorageOperationIssue[],
  storageKey: string | null,
  filePath: string | null,
  conflict: { expectedRevision: number | null; actualRevision: number | null } | null,
): FlowDocFileJsonStorageWriteResult<TRecord> {
  return {
    ok: false,
    source: FLOWDOC_FILE_JSON_STORAGE_SOURCE,
    mode: FLOWDOC_FILE_JSON_STORAGE_MODE,
    status,
    record: null,
    conflict,
    issues,
    storageKey,
    filePath,
    contracts: contracts(),
  }
}

function readResult<TRecord>(
  record: VNextStorageRecordEnvelope<TRecord>,
  storageKey: string,
  filePath: string,
): FlowDocFileJsonStorageReadResult<TRecord> {
  return {
    ok: true,
    source: FLOWDOC_FILE_JSON_STORAGE_SOURCE,
    mode: FLOWDOC_FILE_JSON_STORAGE_MODE,
    status: "found",
    record: cloneJson(record),
    issues: [],
    storageKey,
    filePath,
    contracts: contracts(),
  }
}

function blockedReadResult<TRecord>(
  status: "not-found" | "invalid-request" | "io-error",
  issues: VNextStorageOperationIssue[],
  storageKey: string | null,
  filePath: string | null,
): FlowDocFileJsonStorageReadResult<TRecord> {
  return {
    ok: false,
    source: FLOWDOC_FILE_JSON_STORAGE_SOURCE,
    mode: FLOWDOC_FILE_JSON_STORAGE_MODE,
    status,
    record: null,
    issues,
    storageKey,
    filePath,
    contracts: contracts(),
  }
}

export class FlowDocFileJsonStorageCollection<TRecord> {
  readonly kind: VNextStorageRecordKind
  readonly directoryName: string

  private readonly rootDirectory: string

  constructor(rootDirectory: string, kind: VNextStorageRecordKind, directoryName: string) {
    this.rootDirectory = rootDirectory
    this.kind = kind
    this.directoryName = directoryName
  }

  async read(request: VNextStorageReadRequest): Promise<FlowDocFileJsonStorageReadResult<TRecord>> {
    const location = this.locationForRequest(request)

    if (location == null) {
      return blockedReadResult("invalid-request", [
        issue("kind-mismatch", "kind", "request kind must match the selected storage collection"),
      ], null, null)
    }

    const existing = await this.readEnvelope(location.storageKey, location.filePath, request.key)

    if (Array.isArray(existing)) {
      return blockedReadResult("io-error", existing, location.storageKey, location.filePath)
    }

    const coreResult = createVNextStorageReadResult(existing, request)

    if (coreResult.ok) {
      return readResult(coreResult.record, location.storageKey, location.filePath)
    }

    return blockedReadResult(coreResult.status, coreResult.issues, location.storageKey, location.filePath)
  }

  async write(request: VNextStorageWriteRequest<TRecord>): Promise<FlowDocFileJsonStorageWriteResult<TRecord>> {
    const location = this.locationForRequest(request)

    if (location == null) {
      return blockedWriteResult("invalid-request", [
        issue("kind-mismatch", "kind", "request kind must match the selected storage collection"),
      ], null, null, null)
    }

    const existing = await this.readEnvelope(location.storageKey, location.filePath, request.key)

    if (Array.isArray(existing)) {
      return blockedWriteResult("io-error", existing, location.storageKey, location.filePath, null)
    }

    const coreResult = evaluateVNextStorageWriteRequest(existing, request)

    if (!coreResult.ok) {
      return blockedWriteResult(coreResult.status, coreResult.issues, location.storageKey, location.filePath, coreResult.conflict)
    }

    if (coreResult.status === "written") {
      try {
        await mkdir(join(this.rootDirectory, this.directoryName), { recursive: true })
        await writeFile(location.filePath, `${JSON.stringify(coreResult.record, null, 2)}\n`, "utf8")
      } catch (error) {
        return blockedWriteResult("io-error", [
          issueFromError("storage-write-failed", "filePath", "failed to write storage record", error),
        ], location.storageKey, location.filePath, null)
      }
    }

    return writeResult(coreResult.status, coreResult.record, location.storageKey, location.filePath)
  }

  private locationForRequest(request: VNextStorageReadRequest | VNextStorageWriteRequest<TRecord>): {
    storageKey: string
    filePath: string
  } | null {
    if (request.kind !== this.kind) return null

    const storageKey = storageKeyFor(request.key)

    return {
      storageKey,
      filePath: join(this.rootDirectory, this.directoryName, `${storageKey}.json`),
    }
  }

  private async readEnvelope(
    storageKey: string,
    filePath: string,
    key: string,
  ): Promise<VNextStorageRecordEnvelope<TRecord> | null | VNextStorageOperationIssue[]> {
    try {
      const content = await readFile(filePath, "utf8")
      const parsed = JSON.parse(content) as unknown
      const envelope = validateStoredEnvelope<TRecord>(parsed, this.kind, key)

      return envelope
    } catch (error) {
      if (isNoEntryError(error)) return null

      if (error instanceof SyntaxError) {
        return [issueFromError("invalid-json-record", "filePath", "stored record is not parseable JSON", error)]
      }

      return [issueFromError("storage-read-failed", "filePath", "failed to read storage record", error)]
    }
  }
}

export class FlowDocFileJsonArtifactByteStore {
  readonly source = FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE
  readonly mode = FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE
  readonly rootDirectory: string
  readonly byteDirectory: string
  readonly contracts = artifactByteContracts()

  constructor(rootDirectory: string) {
    this.rootDirectory = rootDirectory
    this.byteDirectory = join(rootDirectory, ARTIFACT_BYTE_DIRECTORY_NAME)
  }

  plan(): FlowDocFileJsonArtifactByteStorePlan {
    return createFlowDocFileJsonArtifactByteStorePlan(this.rootDirectory)
  }

  async write(request: FlowDocFileJsonArtifactByteWriteRequest): Promise<FlowDocFileJsonArtifactByteWriteResult> {
    const issues: VNextStorageOperationIssue[] = []
    const artifactId = nonEmptyValue(request.artifactId, "artifactId", issues)
    const mediaType = nonEmptyValue(request.mediaType, "mediaType", issues)
    const bytes = validateBytes(request.bytes, issues)
    const expectedSha256 = validateExpectedSha256(request.expectedSha256, issues)

    if (artifactId == null || mediaType == null || bytes == null || issues.length > 0) {
      return blockedArtifactByteWriteResult("invalid-request", issues)
    }

    const sha256 = sha256Hex(bytes)

    if (expectedSha256 != null && expectedSha256 !== sha256) {
      return blockedArtifactByteWriteResult("digest-mismatch", [
        issue("expected-sha256-mismatch", "expectedSha256", "expectedSha256 does not match the supplied bytes"),
      ])
    }

    const storageKey = artifactByteStorageKeyFor(artifactId, sha256)
    const filePath = this.filePathForStorageKey(storageKey)
    const artifact: FlowDocFileJsonArtifactByteMetadata = {
      artifactId,
      mediaType,
      byteLength: bytes.byteLength,
      sha256,
      storageKey,
      filePath,
    }

    try {
      await mkdir(this.byteDirectory, { recursive: true })
      await writeFile(filePath, Buffer.from(bytes))
    } catch (error) {
      return blockedArtifactByteWriteResult("io-error", [
        issueFromError("artifact-byte-write-failed", "filePath", "failed to write artifact bytes", error),
      ])
    }

    return artifactByteWriteResult(artifact)
  }

  async read(request: FlowDocFileJsonArtifactByteReadRequest): Promise<FlowDocFileJsonArtifactByteReadResult> {
    const issues: VNextStorageOperationIssue[] = []
    const storageKey = nonEmptyValue(request.storageKey, "storageKey", issues)

    if (storageKey == null || issues.length > 0) {
      return blockedArtifactByteReadResult("invalid-request", issues, null)
    }

    const parsed = parseArtifactByteStorageKey(storageKey, issues)

    if (parsed == null || issues.length > 0) {
      return blockedArtifactByteReadResult("invalid-request", issues, null)
    }

    const filePath = this.filePathForStorageKey(storageKey)

    try {
      const bytes = await readFile(filePath)
      const actualSha256 = sha256Hex(bytes)
      const artifact: FlowDocFileJsonArtifactByteMetadata = {
        artifactId: parsed.artifactId,
        mediaType: null,
        byteLength: bytes.byteLength,
        sha256: actualSha256,
        storageKey,
        filePath,
      }

      if (actualSha256 !== parsed.sha256) {
        return blockedArtifactByteReadResult("digest-mismatch", [
          issue("stored-byte-digest-mismatch", "sha256", "stored artifact bytes do not match the storageKey digest"),
        ], artifact)
      }

      return artifactByteReadResult(artifact, bytes)
    } catch (error) {
      if (isNoEntryError(error)) {
        return blockedArtifactByteReadResult("missing", [
          issue("artifact-bytes-missing", "storageKey", "artifact bytes were not found for storageKey"),
        ], {
          artifactId: parsed.artifactId,
          mediaType: null,
          byteLength: 0,
          sha256: parsed.sha256,
          storageKey,
          filePath,
        })
      }

      return blockedArtifactByteReadResult("io-error", [
        issueFromError("artifact-byte-read-failed", "filePath", "failed to read artifact bytes", error),
      ], null)
    }
  }

  async verifyManifestConsistency(
    manifest: VNextArtifactManifestRecord,
  ): Promise<FlowDocFileJsonArtifactByteConsistencyResult> {
    const issues = this.validateManifestForConsistency(manifest)

    if (issues.length > 0 || manifest.storageKey == null) {
      return blockedArtifactByteConsistencyResult("invalid-manifest", issues, manifest, null)
    }

    const readResult = await this.read({ storageKey: manifest.storageKey })

    if (!readResult.ok) {
      const status = readResult.status === "invalid-request" ? "invalid-manifest" : readResult.status
      return blockedArtifactByteConsistencyResult(status, readResult.issues, manifest, readResult.artifact)
    }

    if (readResult.artifact.artifactId !== manifest.artifactId) {
      issues.push(issue("artifact-id-mismatch", "artifactId", "manifest artifactId does not match byte-store artifactId"))
    }

    if (readResult.artifact.byteLength !== manifest.byteLength) {
      issues.push(issue("byte-length-mismatch", "byteLength", "manifest byteLength does not match stored bytes"))
    }

    if (readResult.artifact.sha256 !== manifest.sha256) {
      issues.push(issue("sha256-mismatch", "sha256", "manifest sha256 does not match stored bytes"))
    }

    if (readResult.artifact.storageKey !== manifest.storageKey) {
      issues.push(issue("storage-key-mismatch", "storageKey", "manifest storageKey does not match byte-store storageKey"))
    }

    if (issues.length > 0) {
      return blockedArtifactByteConsistencyResult("inconsistent", issues, manifest, readResult.artifact)
    }

    return artifactByteConsistencyResult(manifest, readResult.artifact)
  }

  private validateManifestForConsistency(manifest: VNextArtifactManifestRecord): VNextStorageOperationIssue[] {
    const issues: VNextStorageOperationIssue[] = []

    nonEmptyValue(manifest.artifactId, "artifactId", issues)

    if (manifest.status !== "rendered") {
      issues.push(issue("artifact-not-rendered", "status", "only rendered artifact manifests can be checked against stored bytes"))
    }

    if (manifest.byteLength == null || !Number.isInteger(manifest.byteLength) || manifest.byteLength <= 0) {
      issues.push(issue("invalid-byte-length", "byteLength", "rendered artifact manifests require a positive byteLength"))
    }

    if (typeof manifest.sha256 !== "string" || !SHA256_HEX.test(manifest.sha256)) {
      issues.push(issue("invalid-sha256", "sha256", "rendered artifact manifests require a 64 character lowercase hex digest"))
    }

    if (typeof manifest.storageKey !== "string" || manifest.storageKey.trim().length === 0) {
      issues.push(issue("invalid-storage-key", "storageKey", "rendered artifact manifests require a storageKey"))
    }

    return issues
  }

  private filePathForStorageKey(storageKey: string): string {
    return join(this.byteDirectory, storageKey)
  }
}

export function createFlowDocFileJsonStorageAdapterPlan(rootDirectory: string): FlowDocFileJsonStorageAdapterPlan {
  return {
    source: FLOWDOC_FILE_JSON_STORAGE_SOURCE,
    mode: FLOWDOC_FILE_JSON_STORAGE_MODE,
    status: "internal-alpha-record-adapter",
    adapterPackageName: FLOWDOC_FILE_JSON_STORAGE_PACKAGE,
    corePackageName: "@flowdoc/vnext-core",
    rootDirectory: resolve(rootDirectory),
    collections: {
      packageSessions: collectionPlan("package-session", "package-session"),
      durableHistories: collectionPlan("durable-history", "durable-history"),
      richInlineSessions: collectionPlan("rich-inline-session", "rich-inline-session"),
      artifactManifests: collectionPlan("artifact-manifest", "artifact-manifest"),
      artifactJobs: collectionPlan("artifact-job", "artifact-job"),
    },
    concurrency: {
      expectedRevision: "null-for-create-or-exact-number-for-update",
      idempotencyKey: "replays-the-same-accepted-write-for-one-record",
      revision: "increments-on-accepted-update",
    },
    contracts: contracts(),
  }
}

export function createFlowDocFileJsonArtifactByteStorePlan(
  rootDirectory: string,
): FlowDocFileJsonArtifactByteStorePlan {
  return {
    source: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_SOURCE,
    mode: FLOWDOC_FILE_JSON_ARTIFACT_BYTE_STORE_MODE,
    status: "internal-alpha-byte-store",
    adapterPackageName: FLOWDOC_FILE_JSON_STORAGE_PACKAGE,
    corePackageName: "@flowdoc/vnext-core",
    rootDirectory: resolve(rootDirectory),
    byteDirectoryName: ARTIFACT_BYTE_DIRECTORY_NAME,
    storageKeyFormat: "artifact-bytes-v1.<base64url-artifact-id>.<sha256>.bin",
    consistencyCheck: {
      readsBytes: true,
      comparesArtifactId: true,
      comparesByteLength: true,
      comparesSha256: true,
      mutatesManifest: false,
    },
    contracts: artifactByteContracts(),
  }
}

export function createFlowDocFileJsonStorageAdapter(
  input: FlowDocFileJsonStorageAdapterInput,
): FlowDocFileJsonStorageAdapter {
  const rootDirectory = resolve(input.rootDirectory)

  return {
    source: FLOWDOC_FILE_JSON_STORAGE_SOURCE,
    mode: FLOWDOC_FILE_JSON_STORAGE_MODE,
    rootDirectory,
    contracts: contracts(),
    packageSessions: new FlowDocFileJsonStorageCollection(rootDirectory, "package-session", "package-session"),
    durableHistories: new FlowDocFileJsonStorageCollection(rootDirectory, "durable-history", "durable-history"),
    richInlineSessions: new FlowDocFileJsonStorageCollection(rootDirectory, "rich-inline-session", "rich-inline-session"),
    artifactManifests: new FlowDocFileJsonStorageCollection(rootDirectory, "artifact-manifest", "artifact-manifest"),
    artifactJobs: new FlowDocFileJsonStorageCollection(rootDirectory, "artifact-job", "artifact-job"),
    plan: () => createFlowDocFileJsonStorageAdapterPlan(rootDirectory),
  }
}

export function createFlowDocFileJsonArtifactByteStore(
  input: FlowDocFileJsonArtifactByteStoreInput,
): FlowDocFileJsonArtifactByteStore {
  return new FlowDocFileJsonArtifactByteStore(resolve(input.rootDirectory))
}
