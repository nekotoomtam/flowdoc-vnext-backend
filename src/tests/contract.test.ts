import { describe, expect, it } from "vitest"
import { parseBackendMutationRequest } from "../contracts/mutation.js"

describe("backend mutation contract", () => {
  it("parses node mutation requests from the editor boundary", () => {
    const parsed = parseBackendMutationRequest({
      baseRevision: 3,
      documentId: "product-report-vnext-minimal",
      operation: {
        kind: "node.reorder",
        nodeId: "summary-columns",
        toIndex: 0,
      },
      reason: "inspector-reorder",
      requestId: "request-1",
      source: "inspector",
    })

    expect(parsed).toMatchObject({
      ok: true,
      request: {
        operation: {
          kind: "node.reorder",
          nodeId: "summary-columns",
          toIndex: 0,
        },
        source: "inspector",
      },
    })
  })

  it("rejects unsupported operations before service execution", () => {
    const parsed = parseBackendMutationRequest({
      baseRevision: 3,
      documentId: "product-report-vnext-minimal",
      operation: {
        kind: "node.openTextDraft",
        nodeId: "title",
      },
      requestId: "request-2",
      source: "toolbar",
    })

    expect(parsed).toMatchObject({
      issues: [
        {
          path: "operation.kind",
        },
      ],
      ok: false,
    })
  })

  it("parses v4 rich-inline children with the core target grammar", () => {
    const parsed = parseBackendMutationRequest({
      baseRevision: 4,
      documentId: "product-report-vnext-minimal",
      operation: {
        kind: "text-block.rich-inline.replace",
        textBlockId: "title",
        children: [{ id: "title-text", type: "text", text: "Updated title" }],
      },
      requestId: "request-rich-1",
      source: "canvas",
    })

    expect(parsed).toMatchObject({
      ok: true,
      request: {
        operation: {
          kind: "text-block.rich-inline.replace",
          textBlockId: "title",
        },
      },
    })
  })

  it("rejects malformed v4 rich-inline children at the transport boundary", () => {
    const parsed = parseBackendMutationRequest({
      baseRevision: 4,
      documentId: "product-report-vnext-minimal",
      operation: {
        kind: "text-block.rich-inline.replace",
        textBlockId: "title",
        children: [{ id: "title-text", type: "unknown-inline" }],
      },
      requestId: "request-rich-invalid",
      source: "canvas",
    })

    expect(parsed).toMatchObject({
      issues: [expect.objectContaining({ path: expect.stringContaining("operation.children[0]") })],
      ok: false,
    })
  })
})
