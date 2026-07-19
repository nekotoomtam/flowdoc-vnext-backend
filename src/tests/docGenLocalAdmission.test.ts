import { describe, expect, it } from "vitest"
import {
  createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1,
  type FlowDocBackendDocGenLocalAdmissionRequestV1,
} from "../index.js"
import {
  DOCGEN_LOCAL_IDEMPOTENCY_KEY,
  DOCGEN_LOCAL_IDENTITY,
  createDocGenLocalAdmissionFixture,
  docGenLocalAdaptedRequest,
  docGenLocalAsset,
  docGenLocalCanonicalInput,
  docGenLocalDirectRequest,
  docGenLocalMapper,
} from "./helpers/docGenLocalFixture.js"

describe("PDF export REALDOC-E.3 local DocGen admission", () => {
  it("admits direct canonical data into a protected revision-zero record", async () => {
    const fixture = createDocGenLocalAdmissionFixture()
    const result = await fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalDirectRequest(),
    })

    expect(result.status).toBe("created")
    if (result.status !== "created") throw new Error(JSON.stringify(result.issues))
    expect(result.receipt).toMatchObject({
      status: "ready",
      lane: "direct",
      instance: { revision: 0 },
      nextStep: "materialization",
      execution: {
        mapping: "not-required",
        runtimeValidation: "run-valid",
        materialization: "not-run",
        artifact: "not-run",
      },
      contracts: {
        backendOwnedInstance: true,
        trustedMapperOnly: true,
        exactAssetBytesVerified: true,
        rawPayloadRetained: false,
        canonicalBusinessDataExposed: false,
        durablePersistence: false,
        workerEnqueued: false,
        productionBinding: false,
      },
    })
    const publicJson = JSON.stringify(result.receipt)
    expect(publicJson).not.toContain("Private report")
    expect(publicJson).not.toContain("Private item")
    expect(publicJson).not.toContain(DOCGEN_LOCAL_IDEMPOTENCY_KEY)

    const record = await fixture.repository.readByAdmissionId(result.receipt.admissionId)
    expect(record).not.toBeNull()
    expect(record?.canonicalInput.dataSnapshot.data.values["report.title"]).toBe("Private report")
    expect(record?.canonicalInput.collectionSnapshots[0]
      ?.collections["report.items"]?.items[0]?.values.name).toBe("Private item")
    expect(record?.idempotency.callerKey).toBe(DOCGEN_LOCAL_IDEMPOTENCY_KEY)
    await expect(fixture.repository.readByInstanceId(result.receipt.instance.instanceId))
      .resolves.toEqual(record)
  })

  it("uses one trusted mapper, replays without rerunning it, and retains no raw payload", async () => {
    let mapperCalls = 0
    const fixture = createDocGenLocalAdmissionFixture({
      mapper: docGenLocalMapper({ onMap: () => { mapperCalls += 1 } }),
    })
    const payloadText = JSON.stringify({ title: "Mapped private report", name: "Mapped item", amount: 81 })
    const request = docGenLocalAdaptedRequest(payloadText)

    const created = await fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request,
    })
    const replayed = await fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request,
    })

    expect(created.status).toBe("created")
    expect(replayed.status).toBe("replayed")
    expect(mapperCalls).toBe(1)
    if (created.status !== "created" || replayed.status !== "replayed") throw new Error("admission failed")
    expect(replayed.receipt).toEqual(created.receipt)
    expect(created.receipt).toMatchObject({
      lane: "adapted",
      mappingProfile: {
        mappingProfileId: "mapping:docgen-report-json",
        mappingProfileVersion: 1,
      },
      execution: { mapping: "executed", runtimeValidation: "run-valid" },
    })
    expect(JSON.stringify(created.receipt)).not.toContain("Mapped private report")
    const record = await fixture.repository.readByAdmissionId(created.receipt.admissionId)
    expect(record?.canonicalInput.dataSnapshot.data.values["report.title"]).toBe("Mapped private report")
    expect(JSON.stringify(record)).not.toContain("payloadText")
    expect(JSON.stringify(record)).not.toContain(payloadText)
  })

  it("keeps direct and adapted lanes on the same canonical business-data shape", async () => {
    const payload = { title: "Shared title", name: "Shared item", amount: 17 }
    const directFixture = createDocGenLocalAdmissionFixture()
    const adaptedFixture = createDocGenLocalAdmissionFixture()
    const direct = await directFixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:parity:direct",
      request: docGenLocalDirectRequest(payload),
    })
    const adapted = await adaptedFixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:parity:adapted",
      request: docGenLocalAdaptedRequest(JSON.stringify(payload)),
    })
    if (direct.status !== "created" || adapted.status !== "created") throw new Error("parity admission failed")

    const directRecord = await directFixture.repository.readByAdmissionId(direct.receipt.admissionId)
    const adaptedRecord = await adaptedFixture.repository.readByAdmissionId(adapted.receipt.admissionId)
    expect(adaptedRecord?.canonicalInput.dataSnapshot.data).toEqual(directRecord?.canonicalInput.dataSnapshot.data)
    expect(adaptedRecord?.canonicalInput.collectionSnapshots[0]?.collections)
      .toEqual(directRecord?.canonicalInput.collectionSnapshots[0]?.collections)
  })

  it("rejects caller-owned identities and binds one idempotency key to one strict request", async () => {
    const fixture = createDocGenLocalAdmissionFixture()
    const request = docGenLocalDirectRequest()
    const callerOwnedInstance = {
      ...request,
      instance: { instanceId: "caller-instance", revision: 99 },
    }
    await expect(fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: callerOwnedInstance,
    })).resolves.toMatchObject({ status: "invalid-request", receipt: null })

    await expect(fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request,
    })).resolves.toMatchObject({ status: "created" })
    await expect(fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: DOCGEN_LOCAL_IDEMPOTENCY_KEY,
      request: docGenLocalDirectRequest({ title: "Changed", name: "Private item", amount: 42 }),
    })).resolves.toMatchObject({
      status: "idempotency-conflict",
      issues: [{ code: "docgen-idempotency-conflict" }],
    })
  })

  it("fails closed for unknown Structures, profiles, mapping rejection, and asset drift", async () => {
    const fixture = createDocGenLocalAdmissionFixture()
    const unknownStructure = docGenLocalDirectRequest() as FlowDocBackendDocGenLocalAdmissionRequestV1
    unknownStructure.structure = { ...unknownStructure.structure, versionOrdinal: 2 }
    await expect(fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:unknown-structure",
      request: unknownStructure,
    })).resolves.toMatchObject({
      status: "blocked",
      issues: [{ code: "docgen-structure-not-found" }],
    })

    const unknownProfile = docGenLocalAdaptedRequest("{}")
    if (unknownProfile.input.kind !== "adapted-json") throw new Error("fixture lane changed")
    unknownProfile.input.mappingProfile.mappingProfileVersion = 2
    await expect(fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:unknown-profile",
      request: unknownProfile,
    })).resolves.toMatchObject({
      status: "blocked",
      issues: [{ code: "docgen-mapping-profile-not-found" }],
    })

    const rejecting = createDocGenLocalAdmissionFixture({
      mapper: docGenLocalMapper({
        map: () => ({ status: "blocked", canonicalInput: null, issues: [{ code: "source-invalid", path: "$.title" }] }),
      }),
    })
    await expect(rejecting.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:mapping-rejected",
      request: docGenLocalAdaptedRequest("{}"),
    })).resolves.toMatchObject({
      status: "blocked",
      issues: [{ code: "docgen-runtime-mapping-rejected" }],
    })

    const bytes = new Uint8Array([1, 2, 3, 4])
    const asset = docGenLocalAsset(bytes)
    const assetFixture = createDocGenLocalAdmissionFixture({ trustedAssets: [asset] })
    const driftedAssets = { version: 1 as const, images: {
      [asset.definition.id]: { ...asset.definition, intrinsic: { widthPx: 2, heightPx: 1 } },
    } }
    await expect(assetFixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:asset-drift",
      request: docGenLocalDirectRequest(undefined, driftedAssets),
    })).resolves.toMatchObject({
      status: "blocked",
      issues: [{ code: "docgen-asset-definition-mismatch" }],
    })
  })

  it("verifies trusted bytes at registry creation and mapped media at admission", async () => {
    const bytes = new Uint8Array([10, 20, 30])
    const asset = docGenLocalAsset(bytes)
    expect(() => createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1([{
      definition: asset.definition,
      bytes: new Uint8Array([10, 20, 31]),
    }])).toThrow("trusted asset digest")

    const copiedSource = new Uint8Array(bytes)
    const copiedRegistry = createFlowDocBackendDocGenInMemoryTrustedAssetRegistryV1([{
      definition: asset.definition,
      bytes: copiedSource,
    }])
    copiedSource[0] = 99
    await expect(copiedRegistry.verify({
      version: 1,
      images: { [asset.definition.id]: asset.definition },
    })).resolves.toMatchObject({ status: "ready", verifiedByteCount: bytes.byteLength })
    const firstRead = await copiedRegistry.resolve({
      version: 1,
      images: { [asset.definition.id]: asset.definition },
    })
    expect(firstRead).toMatchObject({ status: "ready", assets: [{ definition: asset.definition }] })
    if (firstRead.status !== "ready") throw new Error("trusted asset read failed")
    firstRead.assets[0]!.bytes[0] = 77
    await expect(copiedRegistry.resolve({
      version: 1,
      images: { [asset.definition.id]: asset.definition },
    })).resolves.toMatchObject({ status: "ready", assets: [{ bytes }] })

    const assets = { version: 1 as const, images: { [asset.definition.id]: asset.definition } }
    const fixture = createDocGenLocalAdmissionFixture({
      trustedAssets: [asset],
      mapper: docGenLocalMapper({
        map(payload, context) {
          return {
            status: "mapped",
            canonicalInput: docGenLocalCanonicalInput(context.instance, payload as {
              title: string; name: string; amount: number
            }),
            warnings: [],
          }
        },
      }),
    })
    await expect(fixture.admission.admit({
      identity: DOCGEN_LOCAL_IDENTITY,
      callerIdempotencyKey: "docgen:mapped-media-drift",
      request: docGenLocalAdaptedRequest(
        JSON.stringify({ title: "Title", name: "Item", amount: 2 }),
        assets,
      ),
    })).resolves.toMatchObject({
      status: "blocked",
      issues: [{ code: "docgen-canonical-assets-mismatch" }],
    })
  })
})
