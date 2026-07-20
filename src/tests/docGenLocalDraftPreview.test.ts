import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createVNextDraftStructurePreviewSnapshotV1,
  type VNextPublishedStructureTestInputProjectionV1,
} from "@flowdoc/vnext-core"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1,
  createFlowDocBackendDocGenLocalDraftPreviewRegistryV1,
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportLocalHttpServerV1,
} from "../index.js"
import {
  DOCGEN_LOCAL_AUTHORIZATION,
  DOCGEN_LOCAL_EMPTY_ASSETS,
  DOCGEN_LOCAL_IDENTITY,
  createDocGenLocalAdmissionFixture,
  docGenLocalDataContract,
  docGenLocalMappingProfile,
  docGenLocalStructureRef,
} from "./helpers/docGenLocalFixture.js"
import { createPdfExportRouteFixture } from "./helpers/pdfExportRouteFixture.js"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function projection(): VNextPublishedStructureTestInputProjectionV1 {
  const contract = docGenLocalDataContract()
  return {
    source: "vnext-published-structure-test-input-projection",
    contractVersion: 1,
    kind: "published-structure-test-input-projection",
    status: "ready",
    owner: docGenLocalStructureRef(),
    structureFingerprint: contract.publishedStructureFingerprint,
    dataContract: {
      dataContractId: contract.dataContractId,
      dataContractFingerprint: contract.dataContractFingerprint,
      fieldContractId: contract.fieldContract.fieldContractId,
      collectionItemContractId: contract.collectionItemContract?.collectionItemContractId ?? null,
    },
    tableContracts: [], groups: [], fields: [],
    summary: {
      documentFieldCount: 0, placedDocumentFieldCount: 0, unplacedDocumentFieldCount: 0,
      collectionFieldCount: 0, collectionItemFieldCount: 0, placedCollectionItemFieldCount: 0,
      imageFieldCount: 0, unavailableConstraintFactCount: 0,
    },
    execution: {
      valueCollection: "not-run", snapshotCreation: "not-run", validation: "not-run",
      materialization: "not-run", resolution: "not-run", artifact: "not-run",
    },
    contracts: {
      uiNeutral: true, oneDocumentValuePerFieldKey: true,
      presentationPlacementControlsInputIdentity: false,
      authoredFallbackPromotedToGenerationDefault: false,
      businessValuesAccepted: false, productionBinding: false,
    },
    projectionFingerprint: `sha256:${"8".repeat(64)}`,
    issues: [],
  }
}

function snapshot() {
  return createVNextDraftStructurePreviewSnapshotV1({
    snapshotId: "draft-preview:docgen-report:3",
    draft: {
      contractVersion: 1,
      kind: "structure-definition-draft",
      structureId: "structure:docgen-report",
      draftId: "draft:docgen-report",
      revision: 3,
    },
    authoring: { documentId: "document:preview-qa", documentRevision: 3 },
    sourcePackage: {
      packageId: "package:docgen-report",
      packageVersion: 3,
      documentVersion: 4,
      packageFingerprint: `sha256:${"a".repeat(64)}`,
    },
  })
}

function registry() {
  return createFlowDocBackendDocGenLocalDraftPreviewRegistryV1([{
    snapshot: snapshot(),
    projection: projection(),
    mappingProfiles: [{ label: "Report JSON", profile: docGenLocalMappingProfile() }],
    assets: DOCGEN_LOCAL_EMPTY_ASSETS,
  }])
}

function request(payloadText = JSON.stringify({ title: "Draft value", name: "Draft item", amount: 8 })) {
  const value = snapshot()
  const profile = docGenLocalMappingProfile()
  return {
    contractVersion: 1,
    kind: "docgen-local-draft-preview-admission-request",
    snapshot: { snapshotId: value.snapshotId, snapshotFingerprint: value.snapshotFingerprint },
    input: {
      kind: "adapted-json",
      mappingProfile: {
        mappingProfileId: profile.mappingProfileId,
        mappingProfileVersion: profile.mappingProfileVersion,
        profileFingerprint: profile.profileFingerprint,
      },
      payloadText,
    },
  }
}

describe("PDF export REALDOC-E.5.7 Draft Preview", () => {
  it("retains a separate immutable draft target and rejects stale or cross-lineage bindings", () => {
    const value = registry().resolve({ documentId: "document:preview-qa", documentRevision: 3 })
    expect(value).toMatchObject({
      target: { kind: "draft-preview", snapshot: { draft: { revision: 3 } } },
      executionBridge: { sharedGenerationValidation: true, publishedApiParity: false },
      contracts: {
        immutableDraftSnapshot: true,
        separateDraftAdmission: true,
        publishedStructureVersion: false,
        publishedApiParity: false,
        productionBinding: false,
      },
    })
    expect(registry().resolve({ documentId: "document:preview-qa", documentRevision: 2 })).toBeNull()

    const drifted = snapshot()
    drifted.draft.structureId = "structure:other"
    drifted.snapshotFingerprint = `sha256:${"b".repeat(64)}`
    expect(() => createFlowDocBackendDocGenLocalDraftPreviewRegistryV1([{
      snapshot: drifted,
      projection: projection(),
      mappingProfiles: [],
      assets: DOCGEN_LOCAL_EMPTY_ASSETS,
    }])).toThrow("canonical immutable snapshot")
  })

  it("uses the separate admission boundary and converges on shared validation without exposing values", async () => {
    const base = createDocGenLocalAdmissionFixture()
    const service = createFlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1({
      registry: registry(),
      admission: base.admission,
    })
    const created = await service.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "draft-preview:test:1",
      request: request(),
    })
    const replayed = await service.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "draft-preview:test:1",
      request: request(),
    })
    expect(created.status).toBe("created")
    expect(replayed.status).toBe("replayed")
    if (created.status !== "created") throw new Error(JSON.stringify(created.issues))
    expect(created.receipt).toMatchObject({
      kind: "docgen-local-draft-preview-admission-receipt",
      draftSnapshot: { draft: { draftId: "draft:docgen-report", revision: 3 } },
      generation: {
        lane: "adapted",
        execution: { mapping: "executed", runtimeValidation: "run-valid" },
      },
      contracts: {
        separateDraftAdmission: true,
        sharedGenerationValidation: true,
        sharedArtifactLifecycle: true,
        canonicalBusinessDataExposed: false,
        publishedApiParity: false,
      },
    })
    expect(JSON.stringify(created.receipt)).not.toContain("Draft value")
    await expect(service.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "draft-preview:test:missing",
      request: { ...request(), snapshot: { ...request().snapshot, snapshotFingerprint: `sha256:${"f".repeat(64)}` } },
    })).resolves.toMatchObject({ status: "blocked", issues: [{ code: "draft-preview-snapshot-not-found" }] })
  })

  it("mounts neither route by default and protects exact context/admission pins", async () => {
    const root = mkdtempSync(join(tmpdir(), "flowdoc-draft-preview-"))
    roots.push(root)
    const pdf = createPdfExportRouteFixture({
      contentStore: createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root }),
    })
    const absent = createFlowDocBackendPdfExportLocalHttpServerV1({
      host: "127.0.0.1", port: 0, routeOptions: pdf.options,
    })
    const absentEvidence = await absent.start()
    try {
      expect(absentEvidence.draftPreviewMounted).toBe(false)
      expect((await fetch(`http://127.0.0.1:${absentEvidence.listenerPort}/docgen-local/draft-preview-context`)).status).toBe(404)
    } finally {
      await absent.close()
    }

    const trustedRegistry = registry()
    const base = createDocGenLocalAdmissionFixture()
    const local = createFlowDocBackendPdfExportLocalHttpServerV1({
      host: "127.0.0.1", port: 0, routeOptions: pdf.options,
      draftPreviewOptions: {
        registry: trustedRegistry,
        admission: createFlowDocBackendDocGenLocalDraftPreviewAdmissionServiceV1({
          registry: trustedRegistry,
          admission: base.admission,
        }),
        authenticator: {
          async authenticate({ authorization }) {
            return authorization === DOCGEN_LOCAL_AUTHORIZATION
              ? { status: "authenticated", identity: DOCGEN_LOCAL_IDENTITY, issues: [] }
              : { status: "unauthenticated", identity: null, issues: [] }
          },
        },
        authorizer: {
          async authorize({ draft }) {
            return draft?.draftId === "draft:docgen-report"
              ? { status: "authorized", authorizationId: "authorization:draft-preview", issues: [] }
              : { status: "denied", authorizationId: null, issues: [] }
          },
        },
      },
    })
    const evidence = await local.start()
    const origin = `http://127.0.0.1:${evidence.listenerPort}`
    try {
      expect(evidence.draftPreviewMounted).toBe(true)
      const query = "documentId=document%3Apreview-qa&documentRevision=3"
      expect((await fetch(`${origin}/docgen-local/draft-preview-context?${query}`)).status).toBe(401)
      expect((await fetch(`${origin}/docgen-local/draft-preview-context?documentId=document%3Apreview-qa&documentRevision=2`, {
        headers: { authorization: DOCGEN_LOCAL_AUTHORIZATION },
      })).status).toBe(403)
      const contextResponse = await fetch(`${origin}/docgen-local/draft-preview-context?${query}`, {
        headers: { authorization: DOCGEN_LOCAL_AUTHORIZATION },
      })
      expect(contextResponse.status).toBe(200)
      expect(contextResponse.headers.get("cache-control")).toBe("no-store")

      const admissionResponse = await fetch(`${origin}/docgen-local/draft-preview-admissions`, {
        method: "POST",
        headers: {
          authorization: DOCGEN_LOCAL_AUTHORIZATION,
          "content-type": "application/json",
          "idempotency-key": "draft-preview:http:1",
        },
        body: JSON.stringify(request()),
      })
      expect(admissionResponse.status).toBe(202)
      expect(await admissionResponse.json()).toMatchObject({
        status: "created",
        admission: { kind: "docgen-local-draft-preview-admission-receipt" },
      })
    } finally {
      await local.close()
    }
  })
})
