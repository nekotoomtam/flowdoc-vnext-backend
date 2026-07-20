import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createVNextPublishedStructureMappingProfileV1,
  type VNextPublishedStructureTestInputProjectionV1,
} from "@flowdoc/vnext-core"
import { afterEach, describe, expect, it } from "vitest"
import {
  createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1,
  createFlowDocBackendPdfExportFileContentAddressedStoreV1,
  createFlowDocBackendPdfExportLocalHttpServerV1,
  type FlowDocBackendDocGenLocalPublishedPreviewHttpHandlerOptionsV1,
} from "../index.js"
import {
  DOCGEN_LOCAL_AUTHORIZATION,
  DOCGEN_LOCAL_IDENTITY,
  DOCGEN_LOCAL_EMPTY_ASSETS,
  docGenLocalDataContract,
  docGenLocalMappingProfile,
  docGenLocalStructureRef,
} from "./helpers/docGenLocalFixture.js"
import { createPdfExportRouteFixture } from "./helpers/pdfExportRouteFixture.js"

const roots: string[] = []

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

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
    tableContracts: [],
    groups: [],
    fields: [],
    summary: {
      documentFieldCount: 0,
      placedDocumentFieldCount: 0,
      unplacedDocumentFieldCount: 0,
      collectionFieldCount: 0,
      collectionItemFieldCount: 0,
      placedCollectionItemFieldCount: 0,
      imageFieldCount: 0,
      unavailableConstraintFactCount: 0,
    },
    execution: {
      valueCollection: "not-run",
      snapshotCreation: "not-run",
      validation: "not-run",
      materialization: "not-run",
      resolution: "not-run",
      artifact: "not-run",
    },
    contracts: {
      uiNeutral: true,
      oneDocumentValuePerFieldKey: true,
      presentationPlacementControlsInputIdentity: false,
      authoredFallbackPromotedToGenerationDefault: false,
      businessValuesAccepted: false,
      productionBinding: false,
    },
    projectionFingerprint: `sha256:${"8".repeat(64)}`,
    issues: [],
  }
}

function options(): FlowDocBackendDocGenLocalPublishedPreviewHttpHandlerOptionsV1 {
  const contract = docGenLocalDataContract()
  const registry = createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1([{
    authoring: { documentId: "document:preview-qa", documentRevision: 7 },
    projection: projection(),
    mappingProfiles: [{ label: "Report JSON", profile: docGenLocalMappingProfile(contract) }],
    assets: DOCGEN_LOCAL_EMPTY_ASSETS,
  }])
  return {
    registry,
    authenticator: {
      async authenticate({ authorization }) {
        return authorization === DOCGEN_LOCAL_AUTHORIZATION
          ? { status: "authenticated", identity: DOCGEN_LOCAL_IDENTITY, issues: [] }
          : { status: "unauthenticated", identity: null, issues: [] }
      },
    },
    authorizer: {
      async authorize({ identity, action, documentId, documentRevision }) {
        return identity.principalId === DOCGEN_LOCAL_IDENTITY.principalId
          && action === "docgen:inspect-published-preview"
          && documentId === "document:preview-qa"
          && documentRevision === 7
          ? { status: "authorized", authorizationId: "authorization:preview-qa", issues: [] }
          : { status: "denied", authorizationId: null, issues: [] }
      },
    },
  }
}

async function server(publishedPreviewContextOptions?: FlowDocBackendDocGenLocalPublishedPreviewHttpHandlerOptionsV1) {
  const root = mkdtempSync(join(tmpdir(), "flowdoc-published-preview-"))
  roots.push(root)
  const pdf = createPdfExportRouteFixture({
    contentStore: createFlowDocBackendPdfExportFileContentAddressedStoreV1({ rootDirectory: root }),
  })
  const local = createFlowDocBackendPdfExportLocalHttpServerV1({
    host: "127.0.0.1",
    port: 0,
    routeOptions: pdf.options,
    ...(publishedPreviewContextOptions == null ? {} : { publishedPreviewContextOptions }),
  })
  const evidence = await local.start()
  return { local, evidence, origin: `http://127.0.0.1:${evidence.listenerPort}` }
}

describe("PDF export REALDOC-E.5.6 Published Preview context", () => {
  it("retains exact value-free context and rejects owner or target drift", () => {
    const exactProjection = projection()
    const baseProfile = docGenLocalMappingProfile()
    const exact = createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1([{
      authoring: { documentId: "document:preview-qa", documentRevision: 7 },
      projection: exactProjection,
      mappingProfiles: [{ label: "Report JSON", profile: baseProfile }],
      assets: DOCGEN_LOCAL_EMPTY_ASSETS,
    }]).resolve({ documentId: "document:preview-qa", documentRevision: 7 })

    expect(exact).toMatchObject({
      status: "ready",
      authoring: { documentId: "document:preview-qa", documentRevision: 7 },
      admission: { structure: docGenLocalStructureRef(), assets: { version: 1, images: {} } },
      contracts: {
        businessValuesIncluded: false,
        rawPayloadIncluded: false,
        executableMapperIncluded: false,
        productionBinding: false,
      },
    })
    expect(exact?.contextFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(JSON.stringify(exact)).not.toContain("Private report")
    expect(() => createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1([{
      authoring: { documentId: "document:preview-qa", documentRevision: 7 },
      projection: exactProjection,
      mappingProfiles: [{
        label: "Drifted",
        profile: createVNextPublishedStructureMappingProfileV1({
          mappingProfileId: baseProfile.mappingProfileId,
          mappingProfileVersion: baseProfile.mappingProfileVersion,
          owner: { ...docGenLocalStructureRef(), structureVersionId: "structure-version:other" },
          sourceContract: baseProfile.sourceContract,
          target: baseProfile.target,
          execution: baseProfile.execution,
        }),
      }],
      assets: DOCGEN_LOCAL_EMPTY_ASSETS,
    }])).toThrow("owner does not match")
    expect(() => createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1([{
      authoring: { documentId: "document:preview-qa", documentRevision: 7 },
      projection: exactProjection,
      mappingProfiles: [{
        label: "Invalid fingerprint",
        profile: { ...baseProfile, profileFingerprint: `sha256:${"0".repeat(64)}` },
      }],
      assets: DOCGEN_LOCAL_EMPTY_ASSETS,
    }])).toThrow("canonical profile")
    expect(() => createFlowDocBackendDocGenLocalPublishedPreviewRegistryV1([{
      authoring: { documentId: "document:preview-qa", documentRevision: 7 },
      projection: exactProjection,
      mappingProfiles: [
        { label: "First", profile: baseProfile },
        { label: "Duplicate", profile: baseProfile },
      ],
      assets: DOCGEN_LOCAL_EMPTY_ASSETS,
    }])).toThrow("identity is duplicated")
  })

  it("is absent by default and serves only an authenticated exact authoring pin", async () => {
    const absent = await server()
    try {
      expect(absent.evidence.publishedPreviewContextMounted).toBe(false)
      expect((await fetch(`${absent.origin}/docgen-local/published-preview-context`)).status).toBe(404)
    } finally {
      await absent.local.close()
    }

    const mounted = await server(options())
    try {
      expect(mounted.evidence.publishedPreviewContextMounted).toBe(true)
      const query = "documentId=document%3Apreview-qa&documentRevision=7"
      expect((await fetch(`${mounted.origin}/docgen-local/published-preview-context?${query}`)).status).toBe(401)
      expect((await fetch(`${mounted.origin}/docgen-local/published-preview-context?${query}&extra=1`, {
        headers: { authorization: DOCGEN_LOCAL_AUTHORIZATION },
      })).status).toBe(400)
      expect((await fetch(`${mounted.origin}/docgen-local/published-preview-context?documentId=document%3Apreview-qa&documentRevision=6`, {
        headers: { authorization: DOCGEN_LOCAL_AUTHORIZATION },
      })).status).toBe(403)
      const response = await fetch(`${mounted.origin}/docgen-local/published-preview-context?${query}`, {
        headers: { authorization: DOCGEN_LOCAL_AUTHORIZATION },
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ status: "ready", context: { status: "ready" } })
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("access-control-allow-origin")).toBeNull()
    } finally {
      await mounted.local.close()
    }
  })
})
