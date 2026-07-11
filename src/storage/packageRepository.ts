import {
  parseFlowDocPackageV3DocumentV4,
  safeCreateVNextRuntimeSession,
  serializeFlowDocPackageV2DocumentVNext,
  serializeFlowDocPackageV3DocumentV4,
  type FlowDocPackageV2DocumentVNext,
  type FlowDocPackageV3DocumentV4,
  type VNextPackageV2ToV3MigrationSummary,
} from "@flowdoc/vnext-core"

export type BackendStoredPackage = FlowDocPackageV2DocumentVNext | FlowDocPackageV3DocumentV4

export interface BackendPackageIssue {
  code: string
  message: string
  path: string
  severity: "error"
}

export interface BackendPackageRecord {
  documentId: string
  packageValue: BackendStoredPackage
  revision: number
  updatedAt: string
}

export interface BackendPackageSeedRecord {
  packageValue: FlowDocPackageV2DocumentVNext
  revision: number
  updatedAt: string
}

export interface BackendMigrationSourceSnapshot {
  documentId: string
  packageValue: FlowDocPackageV2DocumentVNext
  requestId: string
  retainedAt: string
  sourceRevision: number
  targetRevision: number
}

export interface BackendMigrationReceipt {
  baseRevision: number
  changeCount: number
  documentId: string
  record: BackendPackageRecord
  requestId: string
  requestFingerprint: string
  snapshot: BackendMigrationSourceSnapshot
  summary: VNextPackageV2ToV3MigrationSummary
}

export type BackendPackageWriteResult =
  | { record: BackendPackageRecord; status: "written" }
  | {
      currentRevision: number | null
      issues: BackendPackageIssue[]
      status: "invalid-package" | "not-found" | "revision-conflict" | "unsupported-version"
    }

export interface BackendPackageWriteRequest {
  documentId: string
  expectedRevision: number
  packageValue: FlowDocPackageV2DocumentVNext
  updatedAt: string
}

export interface BackendPackageMigrationWriteRequest {
  changeCount: number
  documentId: string
  expectedRevision: number
  packageValue: FlowDocPackageV3DocumentV4
  requestId: string
  requestFingerprint: string
  summary: VNextPackageV2ToV3MigrationSummary
  updatedAt: string
}

export type BackendPackageMigrationWriteResult =
  | { receipt: BackendMigrationReceipt; status: "written" | "idempotent-replay" }
  | {
      currentRevision: number | null
      issues: BackendPackageIssue[]
      status: "idempotency-conflict" | "invalid-package" | "not-found" | "revision-conflict" | "unsupported-version"
    }

export interface BackendPackageRepository {
  migrate(request: BackendPackageMigrationWriteRequest): Promise<BackendPackageMigrationWriteResult>
  read(documentId: string): Promise<BackendPackageRecord | null>
  readMigrationReceipt(documentId: string, requestId: string): Promise<BackendMigrationReceipt | null>
  readMigrationSourceSnapshot(documentId: string, targetRevision: number): Promise<BackendMigrationSourceSnapshot | null>
  write(request: BackendPackageWriteRequest): Promise<BackendPackageWriteResult>
}

export function isBackendActivePackage(
  value: BackendStoredPackage,
): value is FlowDocPackageV2DocumentVNext {
  return value.packageVersion === 2 && value.document.version === 3
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clonePackage(value: BackendStoredPackage): BackendStoredPackage {
  return isBackendActivePackage(value)
    ? serializeFlowDocPackageV2DocumentVNext(value)
    : serializeFlowDocPackageV3DocumentV4(value)
}

function cloneRecord(record: BackendPackageRecord): BackendPackageRecord {
  return { ...record, packageValue: clonePackage(record.packageValue) }
}

function cloneSnapshot(snapshot: BackendMigrationSourceSnapshot): BackendMigrationSourceSnapshot {
  return { ...snapshot, packageValue: serializeFlowDocPackageV2DocumentVNext(snapshot.packageValue) }
}

function cloneReceipt(receipt: BackendMigrationReceipt): BackendMigrationReceipt {
  return {
    ...receipt,
    record: cloneRecord(receipt.record),
    snapshot: cloneSnapshot(receipt.snapshot),
    summary: cloneJson(receipt.summary),
  }
}

function packageIssue(message: string, code = "invalid-package", path = "package"): BackendPackageIssue {
  return { code, message, path, severity: "error" }
}

function sameMigrationRequest(
  receipt: BackendMigrationReceipt,
  request: BackendPackageMigrationWriteRequest,
): boolean {
  return receipt.baseRevision === request.expectedRevision
    && receipt.requestFingerprint === request.requestFingerprint
    && JSON.stringify(receipt.record.packageValue) === JSON.stringify(request.packageValue)
}

export function createInMemoryPackageRepository(
  seeds: readonly BackendPackageSeedRecord[],
): BackendPackageRepository {
  const records = new Map<string, BackendPackageRecord>()
  const receipts = new Map<string, BackendMigrationReceipt>()
  const snapshots = new Map<string, BackendMigrationSourceSnapshot>()

  seeds.forEach((seed) => {
    const session = safeCreateVNextRuntimeSession(seed.packageValue, { source: "fixture" })
    if (!session.ok) {
      throw new Error(session.issues.map((item) => `[${item.path}] ${item.message}`).join("\n"))
    }
    records.set(session.session.package.id, {
      documentId: session.session.package.id,
      packageValue: serializeFlowDocPackageV2DocumentVNext(session.session.package),
      revision: seed.revision,
      updatedAt: seed.updatedAt,
    })
  })

  return {
    async read(documentId) {
      const record = records.get(documentId)
      return record ? cloneRecord(record) : null
    },

    async readMigrationReceipt(documentId, requestId) {
      const receipt = receipts.get(`${documentId}:${requestId}`)
      return receipt ? cloneReceipt(receipt) : null
    },

    async readMigrationSourceSnapshot(documentId, targetRevision) {
      const snapshot = snapshots.get(`${documentId}:${targetRevision}`)
      return snapshot ? cloneSnapshot(snapshot) : null
    },

    async write(request) {
      const current = records.get(request.documentId)
      if (!current) return { currentRevision: null, issues: [], status: "not-found" }
      if (current.revision !== request.expectedRevision) {
        return { currentRevision: current.revision, issues: [], status: "revision-conflict" }
      }
      if (!isBackendActivePackage(current.packageValue)) {
        return {
          currentRevision: current.revision,
          issues: [packageIssue("active package writes require package 2/document 3", "unsupported-version")],
          status: "unsupported-version",
        }
      }

      const session = safeCreateVNextRuntimeSession(request.packageValue, { source: "canonical-vnext-package" })
      if (!session.ok) {
        return {
          currentRevision: current.revision,
          issues: session.issues.map((item) => ({ ...item, severity: "error" as const })),
          status: "invalid-package",
        }
      }
      if (session.session.package.id !== request.documentId) {
        return {
          currentRevision: current.revision,
          issues: [packageIssue("package id must match the requested document id")],
          status: "invalid-package",
        }
      }

      const record: BackendPackageRecord = {
        documentId: request.documentId,
        packageValue: serializeFlowDocPackageV2DocumentVNext(session.session.package),
        revision: current.revision + 1,
        updatedAt: request.updatedAt,
      }
      records.set(request.documentId, cloneRecord(record))
      return { record: cloneRecord(record), status: "written" }
    },

    async migrate(request) {
      const receiptKey = `${request.documentId}:${request.requestId}`
      const replay = receipts.get(receiptKey)
      if (replay) {
        return sameMigrationRequest(replay, request)
          ? { receipt: cloneReceipt(replay), status: "idempotent-replay" }
          : {
              currentRevision: replay.record.revision,
              issues: [packageIssue("requestId was already used for a different migration", "idempotency-conflict", "requestId")],
              status: "idempotency-conflict",
            }
      }

      const current = records.get(request.documentId)
      if (!current) return { currentRevision: null, issues: [], status: "not-found" }
      if (current.revision !== request.expectedRevision) {
        return { currentRevision: current.revision, issues: [], status: "revision-conflict" }
      }
      if (!isBackendActivePackage(current.packageValue)) {
        return {
          currentRevision: current.revision,
          issues: [packageIssue("migration source must be package 2/document 3", "unsupported-version")],
          status: "unsupported-version",
        }
      }

      let target: FlowDocPackageV3DocumentV4
      try {
        target = parseFlowDocPackageV3DocumentV4(request.packageValue)
      } catch (error) {
        return {
          currentRevision: current.revision,
          issues: [packageIssue(error instanceof Error ? error.message : "migration target is invalid")],
          status: "invalid-package",
        }
      }
      if (target.id !== request.documentId) {
        return {
          currentRevision: current.revision,
          issues: [packageIssue("migration target id must match the requested document id")],
          status: "invalid-package",
        }
      }

      const targetRevision = current.revision + 1
      const snapshot: BackendMigrationSourceSnapshot = {
        documentId: request.documentId,
        packageValue: serializeFlowDocPackageV2DocumentVNext(current.packageValue),
        requestId: request.requestId,
        retainedAt: request.updatedAt,
        sourceRevision: current.revision,
        targetRevision,
      }
      const record: BackendPackageRecord = {
        documentId: request.documentId,
        packageValue: serializeFlowDocPackageV3DocumentV4(target),
        revision: targetRevision,
        updatedAt: request.updatedAt,
      }
      const receipt: BackendMigrationReceipt = {
        baseRevision: request.expectedRevision,
        changeCount: request.changeCount,
        documentId: request.documentId,
        record,
        requestId: request.requestId,
        requestFingerprint: request.requestFingerprint,
        snapshot,
        summary: cloneJson(request.summary),
      }

      records.set(request.documentId, cloneRecord(record))
      snapshots.set(`${request.documentId}:${targetRevision}`, cloneSnapshot(snapshot))
      receipts.set(receiptKey, cloneReceipt(receipt))
      return { receipt: cloneReceipt(receipt), status: "written" }
    },
  }
}
