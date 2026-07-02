import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { InlineNode } from "@flowdoc/vnext-core"
import {
  FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_MODE,
  FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_SOURCE,
  createFlowDocBackendRichInlineSessionRecord,
} from "../storage/richInlineSessionRecord.js"

const BEFORE_CHILDREN: InlineNode[] = [
  { id: "inline-before-text", type: "text", text: "Prepared for " },
  { id: "inline-before-customer", type: "field-ref", key: "customer.name" },
]

const AFTER_CHILDREN: InlineNode[] = [
  { id: "inline-after-text", type: "text", text: "Report for " },
  { id: "inline-after-customer", type: "field-ref", key: "customer.name" },
]

describe("backend rich inline session record", () => {
  it("wraps retained core replay validation facts in a backend-owned record", () => {
    const record = createFlowDocBackendRichInlineSessionRecord({
      sessionKey: "session:rich-inline",
      storageKey: "rich-inline:session:rich-inline",
      historyKey: "history:rich-inline",
      reason: "backend-rich-inline-contract-test",
      replayPatches: [{
        sourceAction: "replace-customer-heading",
        targetTextBlockId: "text-block:heading",
        beforeChildren: BEFORE_CHILDREN,
        afterChildren: AFTER_CHILDREN,
      }],
    })

    expect(record).toMatchObject({
      source: FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_SOURCE,
      mode: FLOWDOC_BACKEND_RICH_INLINE_SESSION_RECORD_MODE,
      validation: {
        facts: {
          replayPatchCount: 1,
          invalidReplayPatchCount: 0,
          fieldKeys: ["customer.name"],
          contracts: {
            replayPatchValidation: true,
            storageRecord: false,
            backendApi: false,
            replayExecution: false,
          },
        },
      },
      manifest: {
        sessionKey: "session:rich-inline",
        storageKey: "rich-inline:session:rich-inline",
        historyKey: "history:rich-inline",
        validationStatus: "ready",
        storageStatus: "not-written",
        fieldKeys: ["customer.name"],
        replay: {
          executionStatus: "not-run",
          conflictResolution: "not-run",
          selectionRestore: "not-persisted",
          backendApi: "not-called",
        },
      },
      contracts: {
        backendOwnedRecord: true,
        usesCoreRichInlineReplayValidation: true,
        storageWrites: false,
        editorSession: false,
      },
    })
    expect(JSON.parse(JSON.stringify(record))).toEqual(record)
  })

  it("keeps invalid replay facts bounded without running replay execution", () => {
    const record = createFlowDocBackendRichInlineSessionRecord({
      replayPatches: [{
        targetTextBlockId: "text-block:heading",
        beforeChildren: [
          { id: "duplicate-inline", type: "text", text: "A" },
          { id: "duplicate-inline", type: "field-ref", key: "customer.name" },
        ],
        afterChildren: AFTER_CHILDREN,
      }],
    })

    expect(record.manifest.validationStatus).toBe("blocked")
    expect(record.manifest.invalidReplayPatchCount).toBe(1)
    expect(record.validation.replayPatchValidations[0]?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate-inline-id", path: "beforeChildren[1].id" }),
    ]))
    expect(record.manifest.replay.executionStatus).toBe("not-run")
  })

  it("does not import core rich-inline persistence or session storage helpers", () => {
    const source = readFileSync(new URL("../storage/richInlineSessionRecord.ts", import.meta.url), "utf8")

    expect(source).toContain("createVNextRichInlineReplayValidation")
    expect(source).toContain("backendOwnedRecord: true")
    expect(source).not.toContain("createVNextRichInlineSessionPersistenceRecord")
    expect(source).not.toContain("createVNextSessionStorageRecord")
    expect(source).not.toMatch(/node:fs|writeFile|createWriteStream|appendFile|mkdir|rm\(/)
    expect(source).not.toContain("fetch(")
  })
})
