import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { parseBackendMutationRequest, type BackendMutationResultEnvelope } from "../contracts/mutation.js"
import { parseBackendMigrationRequest, type BackendMigrationResultEnvelope } from "../contracts/migration.js"
import { createBackendVersionCapabilityEnvelope } from "../contracts/versionCapability.js"
import { executeBackendMutation } from "../service/mutationService.js"
import { executeBackendMigration } from "../service/migrationService.js"
import type { BackendPackageRepository } from "../storage/packageRepository.js"

export interface CreateFlowDocBackendServerOptions {
  now?: () => number
  repository: BackendPackageRepository
}

const CORS_HEADERS = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-origin": "*",
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(value))
}

function mutationStatusCode(result: BackendMutationResultEnvelope): number {
  if (result.status === "applied") return 200
  if (result.status === "stale") return 409
  return 422
}

function migrationStatusCode(result: BackendMigrationResultEnvelope): number {
  if (result.status === "applied") return 200
  if (result.status === "stale") return 409
  return 422
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on("error", reject)
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      if (raw.trim().length === 0) {
        resolve(null)
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function documentIdFromPath(pathname: string, suffix: string): string | null {
  const prefix = "/documents/"
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null

  const documentId = pathname.slice(prefix.length, pathname.length - suffix.length)
  return documentId.length > 0 ? decodeURIComponent(documentId) : null
}

export function createFlowDocBackendServer(options: CreateFlowDocBackendServerOptions): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")

    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS)
      response.end()
      return
    }

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        service: "flowdoc-vnext-backend",
        status: "ready",
      })
      return
    }

    if (request.method === "GET" && url.pathname === "/capabilities/versions") {
      writeJson(response, 200, createBackendVersionCapabilityEnvelope())
      return
    }

    if (request.method === "GET") {
      const documentId = documentIdFromPath(url.pathname, "")
      if (documentId) {
        const record = await options.repository.read(documentId)
        if (!record) {
          writeJson(response, 404, {
            documentId,
            status: "not-found",
          })
          return
        }

        writeJson(response, 200, {
          documentId,
          packageValue: record.packageValue,
          revision: record.revision,
          status: "found",
          updatedAt: record.updatedAt,
        })
        return
      }
    }

    if (request.method === "POST") {
      const migrationDocumentId = documentIdFromPath(url.pathname, "/migrations/package-v3-document-v4")
      if (migrationDocumentId) {
        try {
          const parsed = parseBackendMigrationRequest(await readBody(request))
          if (!parsed.ok) {
            writeJson(response, 400, { issues: parsed.issues, status: "invalid-request" })
            return
          }
          if (parsed.request.documentId !== migrationDocumentId) {
            writeJson(response, 400, {
              issues: [{
                code: "document-mismatch",
                message: "request documentId must match the route document id",
                path: "documentId",
                severity: "error",
              }],
              status: "invalid-request",
            })
            return
          }
          const result = await executeBackendMigration(parsed.request, options)
          writeJson(response, migrationStatusCode(result), result)
          return
        } catch (error) {
          writeJson(response, 400, {
            issues: [{
              code: "invalid-json",
              message: error instanceof Error ? error.message : "request body must be valid JSON",
              path: "",
              severity: "error",
            }],
            status: "invalid-request",
          })
          return
        }
      }

      const documentId = documentIdFromPath(url.pathname, "/mutations")
      if (documentId) {
        try {
          const parsed = parseBackendMutationRequest(await readBody(request))
          if (!parsed.ok) {
            writeJson(response, 400, {
              issues: parsed.issues,
              status: "invalid-request",
            })
            return
          }

          if (parsed.request.documentId !== documentId) {
            writeJson(response, 400, {
              issues: [
                {
                  code: "document-mismatch",
                  message: "request documentId must match the route document id",
                  path: "documentId",
                  severity: "error",
                },
              ],
              status: "invalid-request",
            })
            return
          }

          const result = await executeBackendMutation(parsed.request, options)
          writeJson(response, mutationStatusCode(result), result)
          return
        } catch (error) {
          writeJson(response, 400, {
            issues: [
              {
                code: "invalid-json",
                message: error instanceof Error ? error.message : "request body must be valid JSON",
                path: "",
                severity: "error",
              },
            ],
            status: "invalid-request",
          })
          return
        }
      }
    }

    writeJson(response, 404, {
      status: "not-found",
    })
  })
}
