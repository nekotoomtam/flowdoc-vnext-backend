import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

function required(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

function requireLoopbackUrl(name: string, protocols: Set<string>): void {
  const value = required(name)
  const url = new URL(value)
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
  if (!protocols.has(url.protocol) || !localHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`${name} must remain on a loopback target`)
  }
}

if (process.argv[2] !== "--confirm-reset-local") {
  throw new Error("local reset requires --confirm-reset-local")
}
if (required("FLOWDOC_PDF_LOCAL_RUNTIME_PROFILE") !== "local-integration") {
  throw new Error("local reset refuses a non-local runtime profile")
}
requireLoopbackUrl("FLOWDOC_PDF_LOCAL_POSTGRES_URL", new Set(["postgres:", "postgresql:"]))
requireLoopbackUrl("FLOWDOC_PDF_LOCAL_S3_ENDPOINT", new Set(["http:"]))

const result = spawnSync("docker", [
  "compose",
  "--env-file",
  ".env.local",
  "-f",
  "docker-compose.pdf-export-local.yml",
  "down",
  "--volumes",
  "--remove-orphans",
], {
  cwd: resolve(process.cwd()),
  stdio: "inherit",
  shell: false,
})
if (result.error != null) throw result.error
if (result.status !== 0) throw new Error(`local Docker reset exited with status ${String(result.status)}`)
