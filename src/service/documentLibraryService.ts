import type {
  BackendDocumentLibraryIssue,
  BackendDocumentLibraryItemV1,
  BackendDocumentLibraryReadResult,
} from "../contracts/documentLibrary.js"
import {
  isBackendActivePackage,
  type BackendPackageListCursor,
  type BackendPackageRecord,
  type BackendPackageRepository,
} from "../storage/packageRepository.js"

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

export interface ReadBackendDocumentLibraryOptions {
  cursor?: string | null
  limit?: string | null
  repository: BackendPackageRepository
}

function issue(
  path: BackendDocumentLibraryIssue["path"],
  message: string,
  code: BackendDocumentLibraryIssue["code"],
): BackendDocumentLibraryIssue {
  return { code, message, path, severity: "error" }
}

function parseLimit(value: string | null | undefined): number | BackendDocumentLibraryIssue {
  if (value == null || value.length === 0) return DEFAULT_LIMIT
  if (!/^\d+$/.test(value)) {
    return issue("limit", "limit must be an integer from 1 through 100", "invalid-limit")
  }

  const limit = Number(value)
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_LIMIT
    ? limit
    : issue("limit", "limit must be an integer from 1 through 100", "invalid-limit")
}

function isCursorRecord(value: unknown): value is BackendPackageListCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 2
    && typeof record.documentId === "string"
    && record.documentId.length > 0
    && typeof record.updatedAt === "string"
    && record.updatedAt.length > 0
    && Number.isFinite(Date.parse(record.updatedAt))
}

function parseCursor(value: string | null | undefined): BackendPackageListCursor | null | BackendDocumentLibraryIssue {
  if (value == null || value.length === 0) return null
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return issue("cursor", "cursor is not a valid document-library cursor", "invalid-cursor")
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    return isCursorRecord(parsed)
      ? parsed
      : issue("cursor", "cursor is not a valid document-library cursor", "invalid-cursor")
  } catch {
    return issue("cursor", "cursor is not a valid document-library cursor", "invalid-cursor")
  }
}

function encodeCursor(cursor: BackendPackageListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

function projectItem(record: BackendPackageRecord): BackendDocumentLibraryItemV1 {
  const migrationRequired = isBackendActivePackage(record.packageValue)
  const authoring = migrationRequired
    ? { draft: null, status: "migration-required" as const }
    : record.authoringContext == null
      ? { draft: null, status: "unavailable" as const }
      : {
          draft: {
            draftId: record.authoringContext.artifact.draftId,
            revision: record.authoringContext.artifact.revision,
            structureId: record.authoringContext.artifact.structureId,
          },
          status: "ready" as const,
        }

  return {
    authoring,
    capabilities: {
      design: { status: "available" },
      preview: {
        reason: migrationRequired ? "migration-required" : "preview-not-implemented",
        status: "unavailable",
      },
    },
    contractVersion: 1,
    documentId: record.documentId,
    kind: "local-document-library-item",
    published: {
      latestVersion: null,
      status: "unavailable",
    },
    revision: record.revision,
    thumbnail: { status: "placeholder" },
    title: record.packageValue.meta.title,
    updatedAt: record.updatedAt,
  }
}

export async function readBackendDocumentLibrary(
  options: ReadBackendDocumentLibraryOptions,
): Promise<BackendDocumentLibraryReadResult> {
  const limit = parseLimit(options.limit)
  if (typeof limit !== "number") return { issues: [limit], status: "invalid-request" }

  const cursor = parseCursor(options.cursor)
  if (cursor != null && "severity" in cursor) {
    return { issues: [cursor], status: "invalid-request" }
  }

  const result = await options.repository.list({ after: cursor, limit })
  const last = result.records.at(-1)

  return {
    page: {
      contractVersion: 1,
      items: result.records.map(projectItem),
      kind: "local-document-library-page",
      nextCursor: result.hasMore && last
        ? encodeCursor({ documentId: last.documentId, updatedAt: last.updatedAt })
        : null,
      scope: {
        authorization: "not-configured",
        kind: "local-workspace",
        workspaceId: "local-development",
      },
      status: "ready",
    },
    status: "ready",
  }
}
