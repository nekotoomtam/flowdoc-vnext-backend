import { writeFile } from "node:fs/promises"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { createFlowDocBackendPdfExportFileContentAddressedStoreV1 } from "../index.js"
import { deterministicPdfBytes } from "./helpers/pdfExportRendererFixture.js"

describe("PDF export content-addressed store", () => {
  const roots: string[] = []

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
  })

  function store() {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-pdf-export-content-"))
    roots.push(root)
    return createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root })
  }

  it("publishes one SHA-256 identity and verifies exact bytes on replay", async () => {
    const contentStore = store()
    const bytes = deterministicPdfBytes()
    const digest = createHash("sha256").update(bytes).digest("hex")
    const first = await contentStore.write({ bytes, expectedSha256: digest, expectedByteLength: bytes.byteLength })
    const replay = await contentStore.write({ bytes, expectedSha256: digest, expectedByteLength: bytes.byteLength })
    expect(first).toMatchObject({
      status: "written",
      content: { storageKey: `pdf-export-v1.sha256.${digest}.pdf`, sha256: digest, byteLength: bytes.byteLength },
    })
    expect(replay).toMatchObject({ status: "idempotent-replay", content: first.content })
    if (first.content == null) throw new Error("content write fixture failed")
    await expect(contentStore.read({ storageKey: first.content.storageKey })).resolves.toMatchObject({
      status: "found",
      bytes,
    })
  })

  it("allows concurrent identical publishers without creating a second identity", async () => {
    const contentStore = store()
    const bytes = deterministicPdfBytes()
    const digest = createHash("sha256").update(bytes).digest("hex")
    const results = await Promise.all(Array.from({ length: 8 }, () => contentStore.write({
      bytes,
      expectedSha256: digest,
      expectedByteLength: bytes.byteLength,
    })))
    expect(results.every((result) => result.content?.storageKey === `pdf-export-v1.sha256.${digest}.pdf`)).toBe(true)
    expect(results.filter((result) => result.status === "written")).toHaveLength(1)
  })

  it("fails closed when retained content no longer matches its address", async () => {
    const contentStore = store()
    const bytes = deterministicPdfBytes()
    const digest = createHash("sha256").update(bytes).digest("hex")
    const written = await contentStore.write({ bytes, expectedSha256: digest, expectedByteLength: bytes.byteLength })
    if (written.content == null) throw new Error("content write fixture failed")
    await writeFile(written.content.storageLocator, new TextEncoder().encode("corrupted"))
    await expect(contentStore.read({ storageKey: written.content.storageKey })).resolves.toMatchObject({
      status: "digest-mismatch",
      bytes: null,
      issues: [{ code: "pdf-export-content-stored-digest-mismatch" }],
    })
  })
})
