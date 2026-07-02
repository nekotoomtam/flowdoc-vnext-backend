import {
  createVNextRichInlineReplayValidation,
  type VNextRichInlineReplayValidationOptions,
  type VNextRichInlineReplayValidationRecord,
} from "@flowdoc/vnext-core"

export const FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_SOURCE = "flowdoc-backend-rich-inline-session-record"
export const FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_MODE = "backend-owned-rich-inline-replay-validation-record"

export interface FlowDocBackendRichInlineSessionRecordInput extends VNextRichInlineReplayValidationOptions {
  sessionKey?: string | null
  storageKey?: string | null
  historyKey?: string | null
  reason?: string | null
}

export interface FlowDocBackendRichInlineSessionRecordContracts {
  backendOwnedRecord: true
  importsCoreAsPublicPackage: true
  usesCoreRichInlineReplayValidation: true
  storageRecord: true
  storageWrites: false
  routeDispatch: false
  backendApi: false
  replayExecution: false
  conflictResolution: false
  selectionRestore: false
  editorSession: false
  packageStorageRecord: false
  durableHistoryStorageRecord: false
}

export interface FlowDocBackendRichInlineSessionManifest {
  schemaVersion: 1
  sessionKey: string | null
  storageKey: string | null
  historyKey: string | null
  reason: string
  storageStatus: "not-written"
  validationStatus: "ready" | "blocked"
  richHistoryRecordCount: number
  replayPatchCount: number
  invalidReplayPatchCount: number
  fieldKeys: string[]
  replay: {
    executionStatus: "not-run"
    conflictResolution: "not-run"
    selectionRestore: "not-persisted"
    storageAdapter: "not-bound"
    backendApi: "not-called"
  }
}

export interface FlowDocBackendRichInlineSessionRecord {
  source: typeof FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_SOURCE
  mode: typeof FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_MODE
  validation: VNextRichInlineReplayValidationRecord
  manifest: FlowDocBackendRichInlineSessionManifest
  contracts: FlowDocBackendRichInlineSessionRecordContracts
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nonEmptyString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function contracts(): FlowDocBackendRichInlineSessionRecordContracts {
  return {
    backendOwnedRecord: true,
    importsCoreAsPublicPackage: true,
    usesCoreRichInlineReplayValidation: true,
    storageRecord: true,
    storageWrites: false,
    routeDispatch: false,
    backendApi: false,
    replayExecution: false,
    conflictResolution: false,
    selectionRestore: false,
    editorSession: false,
    packageStorageRecord: false,
    durableHistoryStorageRecord: false,
  }
}

export function createFlowDocBackendRichInlineSessionRecord(
  input: FlowDocBackendRichInlineSessionRecordInput = {},
): FlowDocBackendRichInlineSessionRecord {
  const validation = createVNextRichInlineReplayValidation({
    historyRecords: input.historyRecords,
    replayPatches: input.replayPatches,
  })
  const validationStatus = validation.facts.invalidReplayPatchCount > 0 ? "blocked" : "ready"

  return {
    source: FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_SOURCE,
    mode: FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_MODE,
    validation: cloneJson(validation),
    manifest: {
      schemaVersion: 1,
      sessionKey: nonEmptyString(input.sessionKey),
      storageKey: nonEmptyString(input.storageKey),
      historyKey: nonEmptyString(input.historyKey),
      reason: nonEmptyString(input.reason) ?? "backend-rich-inline-session-boundary",
      storageStatus: "not-written",
      validationStatus,
      richHistoryRecordCount: validation.facts.richHistoryRecordCount,
      replayPatchCount: validation.facts.replayPatchCount,
      invalidReplayPatchCount: validation.facts.invalidReplayPatchCount,
      fieldKeys: [...validation.facts.fieldKeys],
      replay: {
        executionStatus: "not-run",
        conflictResolution: "not-run",
        selectionRestore: "not-persisted",
        storageAdapter: "not-bound",
        backendApi: "not-called",
      },
    },
    contracts: contracts(),
  }
}
