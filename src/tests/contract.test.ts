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
      reason: "keyboard-reorder",
      requestId: "request-1",
      source: "keyboard",
    })

    expect(parsed).toMatchObject({
      ok: true,
      request: {
        operation: {
          kind: "node.reorder",
          nodeId: "summary-columns",
          toIndex: 0,
        },
        source: "keyboard",
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
})
