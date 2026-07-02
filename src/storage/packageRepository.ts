import {
  safeCreateVNextRuntimeSession,
  serializeFlowDocPackageV2DocumentVNext,
  type FlowDocPackageParseIssue,
  type FlowDocPackageV2DocumentVNext,
} from "@flowdoc/vnext-core"

export interface BackendPackageRecord {
  documentId: string
  packageValue: FlowDocPackageV2DocumentVNext
  revision: number
  updatedAt: string
}

export interface BackendPackageSeedRecord {
  packageValue: FlowDocPackageV2DocumentVNext
  revision: number
  updatedAt: string
}

export type BackendPackageWriteResult =
  | {
      record: BackendPackageRecord
      status: "written"
    }
  | {
      currentRevision: number | null
      issues: FlowDocPackageParseIssue[]
      status: "invalid-package" | "not-found" | "revision-conflict"
    }

export interface BackendPackageWriteRequest {
  documentId: string
  expectedRevision: number
  packageValue: FlowDocPackageV2DocumentVNext
  updatedAt: string
}

export interface BackendPackageRepository {
  read(documentId: string): Promise<BackendPackageRecord | null>
  write(request: BackendPackageWriteRequest): Promise<BackendPackageWriteResult>
}

function clonePackage(value: FlowDocPackageV2DocumentVNext): FlowDocPackageV2DocumentVNext {
  return serializeFlowDocPackageV2DocumentVNext(value)
}

function cloneRecord(record: BackendPackageRecord): BackendPackageRecord {
  return {
    ...record,
    packageValue: clonePackage(record.packageValue),
  }
}

function invalidPackageIssue(message: string): FlowDocPackageParseIssue {
  return {
    code: "invalid-package",
    message,
    path: "package",
    severity: "error",
  }
}

export function createInMemoryPackageRepository(
  seeds: readonly BackendPackageSeedRecord[],
): BackendPackageRepository {
  const records = new Map<string, BackendPackageRecord>()

  seeds.forEach((seed) => {
    const session = safeCreateVNextRuntimeSession(seed.packageValue, {
      source: "fixture",
    })
    if (!session.ok) {
      throw new Error(session.issues.map((issue) => `[${issue.path}] ${issue.message}`).join("\n"))
    }

    records.set(session.session.package.id, {
      documentId: session.session.package.id,
      packageValue: clonePackage(session.session.package),
      revision: seed.revision,
      updatedAt: seed.updatedAt,
    })
  })

  return {
    async read(documentId) {
      const record = records.get(documentId)
      return record ? cloneRecord(record) : null
    },

    async write(request) {
      const current = records.get(request.documentId)
      if (!current) {
        return {
          currentRevision: null,
          issues: [],
          status: "not-found",
        }
      }

      if (current.revision !== request.expectedRevision) {
        return {
          currentRevision: current.revision,
          issues: [],
          status: "revision-conflict",
        }
      }

      const session = safeCreateVNextRuntimeSession(request.packageValue, {
        source: "canonical-vnext-package",
      })
      if (!session.ok) {
        return {
          currentRevision: current.revision,
          issues: session.issues,
          status: "invalid-package",
        }
      }
      if (session.session.package.id !== request.documentId) {
        return {
          currentRevision: current.revision,
          issues: [invalidPackageIssue("package id must match the requested document id")],
          status: "invalid-package",
        }
      }

      const record: BackendPackageRecord = {
        documentId: request.documentId,
        packageValue: clonePackage(session.session.package),
        revision: current.revision + 1,
        updatedAt: request.updatedAt,
      }
      records.set(request.documentId, cloneRecord(record))

      return {
        record: cloneRecord(record),
        status: "written",
      }
    },
  }
}
