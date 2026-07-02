import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  FLOWDOC_BACKEND_SUBMISSION_ROUTE_MODE,
  FLOWDOC_BACKEND_SUBMISSION_ROUTE_SOURCE,
  createFlowDocBackendSubmissionRouteResponse,
} from "../routes/submissionRoute.js"

function permission() {
  return {
    principalId: "user:backend-submission-route",
    tenantId: "tenant:flowdoc",
    scope: "submission:assess",
  }
}

describe("backend submission route contract", () => {
  it("wraps retained core submission identity status in a backend-owned route response", () => {
    const response = createFlowDocBackendSubmissionRouteResponse({
      method: "POST",
      body: {
        requestId: "request:submission-assess",
        idempotencyKey: "idem:submission-assess",
        permission: permission(),
        submission: {
          templateId: "template:product-report",
          submissionId: "submission:product-report",
          workflowStatus: "submitted",
          documentRevision: 2,
          dataRevision: 5,
          actorId: "user:backend-submission-route",
          reason: "backend-submission-contract-test",
        },
      },
    })

    expect(response).toMatchObject({
      ok: true,
      source: FLOWDOC_BACKEND_SUBMISSION_ROUTE_SOURCE,
      mode: FLOWDOC_BACKEND_SUBMISSION_ROUTE_MODE,
      action: "submission.assess",
      method: "POST",
      allowedMethods: ["POST"],
      httpStatus: 200,
      body: {
        result: {
          status: "ready",
          requestId: "request:submission-assess",
          idempotencyKey: "idem:submission-assess",
          workflowStatus: "submitted",
          permission: {
            required: true,
            checked: false,
            context: {
              principalId: "user:backend-submission-route",
              tenantId: "tenant:flowdoc",
              scope: "submission:assess",
              checked: false,
            },
          },
          workflow: {
            engine: "not-run",
            approvalGates: "not-run",
            notificationAudit: "not-written",
          },
          storage: {
            reads: false,
            writes: false,
          },
        },
        identityStatus: {
          facts: {
            status: "ready",
            workflowStatus: "submitted",
            templateId: "template:product-report",
            submissionId: "submission:product-report",
            documentRevision: 2,
            dataRevision: 5,
            contracts: {
              submissionIdentityFacts: true,
              workflowEngine: false,
              permissions: false,
              storageWrite: false,
              routeDispatch: false,
            },
          },
        },
      },
      contracts: {
        backendOwnedModule: true,
        usesCoreSubmissionIdentityStatus: true,
        workflowEngine: false,
        storageWrites: false,
        productionRouteReady: false,
      },
    })
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
  })

  it("maps blocked submission facts and wrong methods to bounded route responses", () => {
    const blocked = createFlowDocBackendSubmissionRouteResponse({
      method: "POST",
      body: {
        submission: {
          templateId: "template:product-report",
          workflowStatus: "submitted",
          documentRevision: 2,
          dataRevision: 5,
        },
      },
    })
    const wrongMethod = createFlowDocBackendSubmissionRouteResponse({
      method: "GET",
      body: {
        submission: {
          templateId: "template:product-report",
        },
      },
    })

    expect(blocked).toMatchObject({
      ok: false,
      httpStatus: 400,
      body: {
        result: {
          status: "blocked",
          workflowStatus: "submitted",
          storage: {
            writes: false,
          },
        },
        identityStatus: {
          facts: {
            status: "blocked",
          },
        },
        issues: [expect.objectContaining({ code: "missing-submission-id", path: "submission.submissionId" })],
      },
    })
    expect(wrongMethod).toMatchObject({
      ok: false,
      method: "GET",
      allowedMethods: ["POST"],
      httpStatus: 405,
      body: {
        result: null,
        identityStatus: null,
        issues: [expect.objectContaining({ code: "method-not-allowed" })],
      },
    })
  })

  it("does not import core submission state records or execute workflow concerns", () => {
    const source = readFileSync(new URL("../routes/submissionRoute.ts", import.meta.url), "utf8")

    expect(source).toContain("createVNextSubmissionIdentityStatus")
    expect(source).toContain("backendOwnedModule: true")
    expect(source).not.toContain("createVNextSubmissionStateRecord")
    expect(source).not.toMatch(/node:fs|writeFile|createWriteStream|appendFile|mkdir|rm\(/)
    expect(source).not.toContain("fetch(")
    expect(source).not.toMatch(/express|fastify|node:http|node:https/)
  })
})
