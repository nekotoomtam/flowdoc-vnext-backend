import type {
  VNextSessionPackageSnapshotPersistedState,
  VNextSessionPackageSnapshotRecord,
} from "@flowdoc/vnext-core"

export const FLOWDOC_BACKEND_SESSION_STORAGE_RECORD_SOURCE = "flowdoc-backend-session-storage-record"
export const FLOWDOC_BACKEND_SESSION_STORAGE_RECORD_MODE = "backend-owned-session-storage-record"

export interface FlowDocBackendSessionStorageRecordOptions {
  storageKey?: string | null
  reason?: string | null
}

export interface FlowDocBackendSessionStorageRecordContracts {
  backendOwnedRecord: true
  importsCoreAsPublicPackage: true
  usesCoreSessionPackageSnapshot: true
  canonicalPackage: true
  storageRecord: true
  storageWrites: false
  routeDispatch: false
  backendApi: false
  editorSession: false
  packageSchemaChange: false
}

export interface FlowDocBackendSessionStorageManifest {
  schemaVersion: 1
  packageId: string
  packageVersion: 2
  documentVersion: 3
  documentRevision: number
  dirtyScopeCount: number
  storageKey: string | null
  reason: string
  storageStatus: "not-written"
  persistedState: VNextSessionPackageSnapshotPersistedState
}

export interface FlowDocBackendSessionStorageSnapshotEvidence {
  source: VNextSessionPackageSnapshotRecord["source"]
  mode: VNextSessionPackageSnapshotRecord["mode"]
  facts: VNextSessionPackageSnapshotRecord["facts"]
}

export interface FlowDocBackendSessionStorageRecord {
  source: typeof FLOWDOC_BACKEND_SESSION_STORAGE_RECORD_SOURCE
  mode: typeof FLOWDOC_BACKEND_SESSION_STORAGE_RECORD_MODE
  package: VNextSessionPackageSnapshotRecord["package"]
  snapshot: FlowDocBackendSessionStorageSnapshotEvidence
  manifest: FlowDocBackendSessionStorageManifest
  contracts: FlowDocBackendSessionStorageRecordContracts
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nonEmptyString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function contracts(): FlowDocBackendSessionStorageRecordContracts {
  return {
    backendOwnedRecord: true,
    importsCoreAsPublicPackage: true,
    usesCoreSessionPackageSnapshot: true,
    canonicalPackage: true,
    storageRecord: true,
    storageWrites: false,
    routeDispatch: false,
    backendApi: false,
    editorSession: false,
    packageSchemaChange: false,
  }
}

export function createFlowDocBackendSessionStorageRecord(
  snapshot: VNextSessionPackageSnapshotRecord,
  options: FlowDocBackendSessionStorageRecordOptions = {},
): FlowDocBackendSessionStorageRecord {
  return {
    source: FLOWDOC_BACKEND_SESSION_STORAGE_RECORD_SOURCE,
    mode: FLOWDOC_BACKEND_SESSION_STORAGE_RECORD_MODE,
    package: cloneJson(snapshot.package),
    snapshot: {
      source: snapshot.source,
      mode: snapshot.mode,
      facts: cloneJson(snapshot.facts),
    },
    manifest: {
      schemaVersion: 1,
      packageId: snapshot.facts.packageId,
      packageVersion: snapshot.facts.packageVersion,
      documentVersion: snapshot.facts.documentVersion,
      documentRevision: snapshot.facts.documentRevision,
      dirtyScopeCount: snapshot.facts.dirtyScopeCount,
      storageKey: nonEmptyString(options.storageKey),
      reason: nonEmptyString(options.reason) ?? "backend-session-save-boundary",
      storageStatus: "not-written",
      persistedState: cloneJson(snapshot.facts.persistedState),
    },
    contracts: contracts(),
  }
}
