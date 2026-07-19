export interface BackendDocumentLibraryIssue {
  code: "invalid-cursor" | "invalid-limit"
  message: string
  path: "cursor" | "limit"
  severity: "error"
}

export interface BackendDocumentLibraryItemV1 {
  authoring:
    | {
        draft: null
        status: "migration-required" | "unavailable"
      }
    | {
        draft: {
          draftId: string
          revision: number
          structureId: string
        }
        status: "ready"
      }
  capabilities: {
    design: {
      status: "available"
    }
    preview: {
      reason: "migration-required" | "preview-not-implemented"
      status: "unavailable"
    }
  }
  contractVersion: 1
  documentId: string
  kind: "local-document-library-item"
  published: {
    latestVersion: null
    status: "unavailable"
  }
  revision: number
  thumbnail: {
    status: "placeholder"
  }
  title: string
  updatedAt: string
}

export interface BackendDocumentLibraryPageV1 {
  contractVersion: 1
  items: BackendDocumentLibraryItemV1[]
  kind: "local-document-library-page"
  nextCursor: string | null
  scope: {
    authorization: "not-configured"
    kind: "local-workspace"
    workspaceId: "local-development"
  }
  status: "ready"
}

export type BackendDocumentLibraryReadResult =
  | {
      page: BackendDocumentLibraryPageV1
      status: "ready"
    }
  | {
      issues: BackendDocumentLibraryIssue[]
      status: "invalid-request"
    }
