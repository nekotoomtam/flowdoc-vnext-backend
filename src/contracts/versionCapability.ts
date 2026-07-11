import {
  VNEXT_CORE_VERSION_CAPABILITY_CONTRACT,
  type VNextCoreVersionCapabilityContract,
  type VNextPackageDocumentVersionPair,
} from "@flowdoc/vnext-core"

export const BACKEND_VERSION_CAPABILITY_CONTRACT_VERSION = 1 as const

export interface BackendVersionPairSupport {
  pairs: VNextPackageDocumentVersionPair[]
  status: "available"
}

export interface BackendMigrationPlanSupport {
  source: VNextPackageDocumentVersionPair
  status: "core-available"
  target: VNextPackageDocumentVersionPair
}

export interface BackendMigrationPersistenceSupport {
  baseRevisionRequired: true
  sourceSnapshotRetention: false
  status: "not-wired"
}

export interface BackendVersionCapabilityEnvelope {
  backend: {
    documentRead: BackendVersionPairSupport
    migrationPersistence: BackendMigrationPersistenceSupport
    migrationPlan: BackendMigrationPlanSupport
    mutation: BackendVersionPairSupport
  }
  contractVersion: typeof BACKEND_VERSION_CAPABILITY_CONTRACT_VERSION
  core: VNextCoreVersionCapabilityContract
  service: "flowdoc-vnext-backend"
  status: "ready"
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clonePair(pair: VNextPackageDocumentVersionPair): VNextPackageDocumentVersionPair {
  return { packageVersion: pair.packageVersion, documentVersion: pair.documentVersion }
}

export function createBackendVersionCapabilityEnvelope(): BackendVersionCapabilityEnvelope {
  const active = clonePair(VNEXT_CORE_VERSION_CAPABILITY_CONTRACT.active)
  const migrationTarget = clonePair(VNEXT_CORE_VERSION_CAPABILITY_CONTRACT.migrationTarget)

  return {
    backend: {
      documentRead: {
        pairs: [clonePair(active)],
        status: "available",
      },
      migrationPersistence: {
        baseRevisionRequired: true,
        sourceSnapshotRetention: false,
        status: "not-wired",
      },
      migrationPlan: {
        source: clonePair(active),
        status: "core-available",
        target: migrationTarget,
      },
      mutation: {
        pairs: [clonePair(active)],
        status: "available",
      },
    },
    contractVersion: BACKEND_VERSION_CAPABILITY_CONTRACT_VERSION,
    core: cloneJson(VNEXT_CORE_VERSION_CAPABILITY_CONTRACT),
    service: "flowdoc-vnext-backend",
    status: "ready",
  }
}
