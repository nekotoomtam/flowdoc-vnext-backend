import {
  advanceVNextArtifactJob,
  createVNextArtifactJobPlan,
  createVNextArtifactManifestPlan,
  type VNextArtifactJobCreateInput,
  type VNextArtifactJobRecord,
  type VNextArtifactManifestRecord,
  type VNextStorageOperationIssue,
} from "@flowdoc/vnext-core"
import {
  createFlowDocFileJsonArtifactByteStore,
  createFlowDocFileJsonStorageAdapter,
  type FlowDocFileJsonArtifactByteReadResult,
  type FlowDocFileJsonArtifactByteWriteResult,
  type FlowDocFileJsonArtifactByteConsistencyResult,
  type FlowDocFileJsonStorageAdapter,
} from "../storage/fileJsonStorage.js"

export const FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_SOURCE = "flowdoc-backend-artifact-job-execution"
export const FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_MODE = "backend-artifact-job-storage-execution"

export interface FlowDocBackendArtifactRenderRequest {
  job: VNextArtifactJobRecord
  now: string
}

export type FlowDocBackendArtifactRenderResult =
  | {
      ok: true
      status: "rendered"
      mediaType: string
      bytes: Uint8Array
      rendererProfileId: string
      productionFidelity: boolean
      issues: []
    }
  | {
      ok: false
      status: "blocked"
      mediaType: string | null
      bytes: null
      rendererProfileId: string
      productionFidelity: boolean
      issues: FlowDocBackendArtifactJobExecutionIssue[]
    }

export interface FlowDocBackendArtifactJobExecutionInput {
  rootDirectory: string
  jobInput: VNextArtifactJobCreateInput
  now: string
  renderArtifact: (
    request: FlowDocBackendArtifactRenderRequest,
  ) => FlowDocBackendArtifactRenderResult | Promise<FlowDocBackendArtifactRenderResult>
  layoutCompletedSourceItemIds?: string[]
}

export interface FlowDocBackendArtifactJobExecutionIssue {
  severity: "blocking"
  code: string
  path: string
  message: string
}

export interface FlowDocBackendArtifactJobExecutionRecordFact {
  kind: "artifact-manifest" | "artifact-job"
  key: string
  writeStatus: string
  readStatus: string
  revision: number | null
  artifactStatus: string | null
  jobStatus: string | null
}

export interface FlowDocBackendArtifactJobExecutionByteFact {
  artifactId: string
  byteLength: number | null
  sha256: string | null
  storageKey: string | null
  writeStatus: string
  readStatus: string
  consistencyStatus: string
}

export interface FlowDocBackendArtifactJobExecutionResult {
  source: typeof FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_SOURCE
  mode: typeof FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_MODE
  status: "rendered" | "failed" | "blocked"
  job: {
    jobId: string
    status: VNextArtifactJobRecord["status"]
    revision: number | null
  } | null
  artifact: {
    artifactId: string
    status: VNextArtifactManifestRecord["status"]
    byteLength: number | null
    sha256: string | null
    storageKey: string | null
    revision: number | null
  } | null
  renderer: {
    rendererProfileId: string | null
    status: "rendered" | "blocked" | "not-run"
    byteLength: number | null
    productionFidelity: boolean
    injected: true
  }
  bytes: FlowDocBackendArtifactJobExecutionByteFact | null
  records: FlowDocBackendArtifactJobExecutionRecordFact[]
  issues: FlowDocBackendArtifactJobExecutionIssue[]
  contracts: {
    backendOwnedModule: true
    importsCoreAsPublicPackage: true
    usesConcreteFileJsonStorage: true
    recordStorageWrites: boolean
    artifactByteWrites: boolean
    rendererInjected: true
    workerOrQueue: false
    backendRoute: false
    authzExecution: false
    productionRendererReady: false
    productionStorageReady: false
    packageSchemaChange: false
    documentSchemaChange: false
    multiRecordTransactions: false
  }
}

interface RecordWriteRoundtrip<TRecord> {
  fact: FlowDocBackendArtifactJobExecutionRecordFact
  value: TRecord | null
  revision: number | null
  ok: boolean
  issues: FlowDocBackendArtifactJobExecutionIssue[]
}

function contracts(
  input: { recordStorageWrites: boolean; artifactByteWrites: boolean },
): FlowDocBackendArtifactJobExecutionResult["contracts"] {
  return {
    backendOwnedModule: true,
    importsCoreAsPublicPackage: true,
    usesConcreteFileJsonStorage: true,
    recordStorageWrites: input.recordStorageWrites,
    artifactByteWrites: input.artifactByteWrites,
    rendererInjected: true,
    workerOrQueue: false,
    backendRoute: false,
    authzExecution: false,
    productionRendererReady: false,
    productionStorageReady: false,
    packageSchemaChange: false,
    documentSchemaChange: false,
    multiRecordTransactions: false,
  }
}

function issue(code: string, path: string, message: string): FlowDocBackendArtifactJobExecutionIssue {
  return {
    severity: "blocking",
    code,
    path,
    message,
  }
}

function bounded(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function artifactIssues(
  prefix: string,
  issues: readonly { code: string; path: string; message: string }[],
): FlowDocBackendArtifactJobExecutionIssue[] {
  return issues.map((entry) => issue(entry.code, `${prefix}.${entry.path}`, entry.message))
}

function storageIssues(
  prefix: string,
  issues: readonly VNextStorageOperationIssue[],
): FlowDocBackendArtifactJobExecutionIssue[] {
  return issues.map((entry) => issue(entry.code, `${prefix}.${entry.path}`, entry.message))
}

function rendererFact(
  result: FlowDocBackendArtifactRenderResult | null,
): FlowDocBackendArtifactJobExecutionResult["renderer"] {
  return {
    rendererProfileId: result?.rendererProfileId ?? null,
    status: result?.status ?? "not-run",
    byteLength: result?.bytes?.byteLength ?? null,
    productionFidelity: result?.productionFidelity ?? false,
    injected: true,
  }
}

function blockedResult(input: {
  issues: FlowDocBackendArtifactJobExecutionIssue[]
  records: FlowDocBackendArtifactJobExecutionRecordFact[]
  bytes?: FlowDocBackendArtifactJobExecutionByteFact | null
  renderer?: FlowDocBackendArtifactRenderResult | null
  recordStorageWrites?: boolean
  artifactByteWrites?: boolean
}): FlowDocBackendArtifactJobExecutionResult {
  return {
    source: FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_SOURCE,
    mode: FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_MODE,
    status: "blocked",
    job: null,
    artifact: null,
    renderer: rendererFact(input.renderer ?? null),
    bytes: input.bytes ?? null,
    records: input.records,
    issues: input.issues,
    contracts: contracts({
      recordStorageWrites: input.recordStorageWrites ?? input.records.length > 0,
      artifactByteWrites: input.artifactByteWrites ?? input.bytes != null,
    }),
  }
}

function terminalResult(input: {
  status: "rendered" | "failed"
  job: VNextArtifactJobRecord
  manifest: VNextArtifactManifestRecord
  jobRevision: number | null
  manifestRevision: number | null
  records: FlowDocBackendArtifactJobExecutionRecordFact[]
  bytes: FlowDocBackendArtifactJobExecutionByteFact | null
  renderer: FlowDocBackendArtifactRenderResult
  issues: FlowDocBackendArtifactJobExecutionIssue[]
}): FlowDocBackendArtifactJobExecutionResult {
  return {
    source: FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_SOURCE,
    mode: FLOWDOC_BACKEND_ARTIFACT_JOB_EXECUTION_MODE,
    status: input.status,
    job: {
      jobId: input.job.jobId,
      status: input.job.status,
      revision: input.jobRevision,
    },
    artifact: {
      artifactId: input.manifest.artifactId,
      status: input.manifest.status,
      byteLength: input.manifest.byteLength,
      sha256: input.manifest.sha256,
      storageKey: input.manifest.storageKey,
      revision: input.manifestRevision,
    },
    renderer: rendererFact(input.renderer),
    bytes: input.bytes,
    records: input.records,
    issues: input.issues,
    contracts: contracts({
      recordStorageWrites: input.records.length > 0,
      artifactByteWrites: input.bytes?.writeStatus === "written",
    }),
  }
}

function recordFact<TRecord>(
  kind: "artifact-manifest" | "artifact-job",
  key: string,
  writeStatus: string,
  readStatus: string,
  revision: number | null,
  value: TRecord | null,
): FlowDocBackendArtifactJobExecutionRecordFact {
  const artifact = kind === "artifact-manifest" ? value as VNextArtifactManifestRecord | null : null
  const job = kind === "artifact-job" ? value as VNextArtifactJobRecord | null : null

  return {
    kind,
    key,
    writeStatus,
    readStatus,
    revision,
    artifactStatus: artifact?.status ?? null,
    jobStatus: job?.status ?? null,
  }
}

async function writeManifestRecord(input: {
  adapter: FlowDocFileJsonStorageAdapter
  key: string
  value: VNextArtifactManifestRecord
  expectedRevision: number | null
  idempotencyKey: string
  now: string
}): Promise<RecordWriteRoundtrip<VNextArtifactManifestRecord>> {
  const writeResult = await input.adapter.artifactManifests.write({
    kind: "artifact-manifest",
    key: input.key,
    value: input.value,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    now: input.now,
  })
  const readResult = await input.adapter.artifactManifests.read({
    kind: "artifact-manifest",
    key: input.key,
  })
  const value = readResult.ok ? readResult.record.value : writeResult.ok ? writeResult.record.value : null
  const revision = readResult.ok ? readResult.record.revision : writeResult.ok ? writeResult.record.revision : null
  const issues = [
    ...(!writeResult.ok ? storageIssues("artifactManifest.write", writeResult.issues) : []),
    ...(!readResult.ok ? storageIssues("artifactManifest.read", readResult.issues) : []),
  ]

  return {
    fact: recordFact("artifact-manifest", input.key, writeResult.status, readResult.status, revision, value),
    value,
    revision,
    ok: writeResult.ok && readResult.ok,
    issues,
  }
}

async function writeJobRecord(input: {
  adapter: FlowDocFileJsonStorageAdapter
  key: string
  value: VNextArtifactJobRecord
  expectedRevision: number | null
  idempotencyKey: string
  now: string
}): Promise<RecordWriteRoundtrip<VNextArtifactJobRecord>> {
  const writeResult = await input.adapter.artifactJobs.write({
    kind: "artifact-job",
    key: input.key,
    value: input.value,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    now: input.now,
  })
  const readResult = await input.adapter.artifactJobs.read({
    kind: "artifact-job",
    key: input.key,
  })
  const value = readResult.ok ? readResult.record.value : writeResult.ok ? writeResult.record.value : null
  const revision = readResult.ok ? readResult.record.revision : writeResult.ok ? writeResult.record.revision : null
  const issues = [
    ...(!writeResult.ok ? storageIssues("artifactJob.write", writeResult.issues) : []),
    ...(!readResult.ok ? storageIssues("artifactJob.read", readResult.issues) : []),
  ]

  return {
    fact: recordFact("artifact-job", input.key, writeResult.status, readResult.status, revision, value),
    value,
    revision,
    ok: writeResult.ok && readResult.ok,
    issues,
  }
}

function byteFact(
  writeResult: FlowDocFileJsonArtifactByteWriteResult | null,
  readResult: FlowDocFileJsonArtifactByteReadResult | null,
  consistencyResult: FlowDocFileJsonArtifactByteConsistencyResult | null,
): FlowDocBackendArtifactJobExecutionByteFact | null {
  const artifact = writeResult?.artifact ?? readResult?.artifact ?? consistencyResult?.artifact ?? null
  if (artifact == null && writeResult == null && readResult == null && consistencyResult == null) return null

  return {
    artifactId: artifact?.artifactId ?? "",
    byteLength: artifact?.byteLength ?? null,
    sha256: artifact?.sha256 ?? null,
    storageKey: artifact?.storageKey ?? null,
    writeStatus: writeResult?.status ?? "not-run",
    readStatus: readResult?.status ?? "not-run",
    consistencyStatus: consistencyResult?.status ?? "not-run",
  }
}

function renderedManifestForJob(input: {
  job: VNextArtifactJobRecord
  byteWrite: Extract<FlowDocFileJsonArtifactByteWriteResult, { ok: true }>
  createdAt: string
}): VNextArtifactManifestRecord | FlowDocBackendArtifactJobExecutionIssue[] {
  const plan = createVNextArtifactManifestPlan({
    artifactId: input.job.artifact.artifactId,
    sourcePackageId: input.job.input.sourcePackageId,
    sessionId: input.job.input.sessionId,
    jobId: input.job.jobId,
    rendererProfileId: input.job.profiles.rendererProfileId,
    measurementProfileId: input.job.profiles.measurementProfileId,
    format: input.job.artifact.format,
    mediaType: input.job.artifact.mediaType,
    byteLength: input.byteWrite.artifact.byteLength,
    sha256: input.byteWrite.artifact.sha256,
    storageKey: input.byteWrite.artifact.storageKey,
    createdAt: input.createdAt,
    status: "rendered",
    error: null,
  })

  if (plan.record != null) return plan.record
  return artifactIssues("artifactManifest.rendered", plan.issues)
}

function advanceJob(
  job: VNextArtifactJobRecord,
  command: Parameters<typeof advanceVNextArtifactJob>[1],
): VNextArtifactJobRecord | FlowDocBackendArtifactJobExecutionIssue[] {
  const plan = advanceVNextArtifactJob(job, command)
  if (plan.status === "advanced") return plan.job
  return artifactIssues(`artifactJob.${command.action}`, plan.issues)
}

async function persistFailedJob(input: {
  adapter: FlowDocFileJsonStorageAdapter
  records: FlowDocBackendArtifactJobExecutionRecordFact[]
  job: VNextArtifactJobRecord
  artifactKey: string
  jobKey: string
  manifestRevision: number | null
  jobRevision: number | null
  now: string
  renderer: FlowDocBackendArtifactRenderResult
  bytes: FlowDocBackendArtifactJobExecutionByteFact | null
  error: {
    code: string
    message: string
    retryable: boolean
  }
}): Promise<FlowDocBackendArtifactJobExecutionResult> {
  const failedJob = advanceJob(input.job, {
    action: "fail",
    updatedAt: input.now,
    error: {
      code: bounded(input.error.code, 80),
      message: bounded(input.error.message, 240),
      retryable: input.error.retryable,
    },
  })

  if (Array.isArray(failedJob) || failedJob.artifactManifest == null) {
    return blockedResult({
      issues: Array.isArray(failedJob) ? failedJob : [
        issue("missing-failed-manifest", "artifactJob.artifactManifest", "failed job did not produce a failed manifest"),
      ],
      records: input.records,
      bytes: input.bytes,
      renderer: input.renderer,
    })
  }

  const failedManifestWrite = await writeManifestRecord({
    adapter: input.adapter,
    key: input.artifactKey,
    value: failedJob.artifactManifest,
    expectedRevision: input.manifestRevision,
    idempotencyKey: "backend-artifact-job-execution:manifest:failed",
    now: input.now,
  })
  input.records.push(failedManifestWrite.fact)
  if (!failedManifestWrite.ok) {
    return blockedResult({ issues: failedManifestWrite.issues, records: input.records, bytes: input.bytes, renderer: input.renderer })
  }

  const failedJobWrite = await writeJobRecord({
    adapter: input.adapter,
    key: input.jobKey,
    value: failedJob,
    expectedRevision: input.jobRevision,
    idempotencyKey: "backend-artifact-job-execution:job:failed",
    now: input.now,
  })
  input.records.push(failedJobWrite.fact)
  if (!failedJobWrite.ok) {
    return blockedResult({ issues: failedJobWrite.issues, records: input.records, bytes: input.bytes, renderer: input.renderer })
  }

  return terminalResult({
    status: "failed",
    job: failedJob,
    manifest: failedJob.artifactManifest,
    jobRevision: failedJobWrite.revision,
    manifestRevision: failedManifestWrite.revision,
    records: input.records,
    bytes: input.bytes,
    renderer: input.renderer,
    issues: [issue(input.error.code, "artifactJob.execution", input.error.message)],
  })
}

export async function runFlowDocBackendArtifactJobExecution(
  input: FlowDocBackendArtifactJobExecutionInput,
): Promise<FlowDocBackendArtifactJobExecutionResult> {
  const adapter = createFlowDocFileJsonStorageAdapter({ rootDirectory: input.rootDirectory })
  const byteStore = createFlowDocFileJsonArtifactByteStore({ rootDirectory: input.rootDirectory })
  const records: FlowDocBackendArtifactJobExecutionRecordFact[] = []
  const jobPlan = createVNextArtifactJobPlan(input.jobInput)

  if (jobPlan.job == null || jobPlan.status !== "ready") {
    return blockedResult({
      issues: artifactIssues("artifactJob.create", jobPlan.issues),
      records,
      recordStorageWrites: false,
      artifactByteWrites: false,
    })
  }

  const jobKey = jobPlan.job.jobId
  const artifactKey = jobPlan.job.artifact.artifactId
  if (jobPlan.job.artifactManifest == null) {
    return blockedResult({
      issues: [issue("missing-planned-manifest", "artifactJob.artifactManifest", "artifact job plan did not create a planned manifest")],
      records,
      recordStorageWrites: false,
      artifactByteWrites: false,
    })
  }

  const plannedManifestWrite = await writeManifestRecord({
    adapter,
    key: artifactKey,
    value: jobPlan.job.artifactManifest,
    expectedRevision: null,
    idempotencyKey: "backend-artifact-job-execution:manifest:planned",
    now: input.now,
  })
  records.push(plannedManifestWrite.fact)
  if (!plannedManifestWrite.ok) return blockedResult({ issues: plannedManifestWrite.issues, records })

  const queuedJobWrite = await writeJobRecord({
    adapter,
    key: jobKey,
    value: jobPlan.job,
    expectedRevision: null,
    idempotencyKey: "backend-artifact-job-execution:job:queued",
    now: input.now,
  })
  records.push(queuedJobWrite.fact)
  if (!queuedJobWrite.ok) return blockedResult({ issues: queuedJobWrite.issues, records })

  const layoutRunning = advanceJob(jobPlan.job, { action: "start-layout", updatedAt: input.now })
  if (Array.isArray(layoutRunning)) return blockedResult({ issues: layoutRunning, records })

  const layoutComplete = advanceJob(layoutRunning, {
    action: "complete-layout",
    updatedAt: input.now,
    cursor: {
      layoutJobOffset: 1,
      completedSourceItemIds: input.layoutCompletedSourceItemIds ?? ["backend-artifact-job-execution"],
    },
    completedStepCount: 1,
    totalStepCount: 1,
  })
  if (Array.isArray(layoutComplete)) return blockedResult({ issues: layoutComplete, records })

  const renderingJob = advanceJob(layoutComplete, { action: "start-rendering", updatedAt: input.now })
  if (Array.isArray(renderingJob) || renderingJob.artifactManifest == null) {
    return blockedResult({
      issues: Array.isArray(renderingJob) ? renderingJob : [
        issue("missing-rendering-manifest", "artifactJob.artifactManifest", "rendering job did not produce a rendering manifest"),
      ],
      records,
    })
  }

  const renderingManifestWrite = await writeManifestRecord({
    adapter,
    key: artifactKey,
    value: renderingJob.artifactManifest,
    expectedRevision: plannedManifestWrite.revision,
    idempotencyKey: "backend-artifact-job-execution:manifest:rendering",
    now: input.now,
  })
  records.push(renderingManifestWrite.fact)
  if (!renderingManifestWrite.ok) return blockedResult({ issues: renderingManifestWrite.issues, records })

  const rendered = await input.renderArtifact({
    job: renderingJob,
    now: input.now,
  })

  if (!rendered.ok) {
    const firstIssue = rendered.issues[0]
    return persistFailedJob({
      adapter,
      records,
      job: renderingJob,
      artifactKey,
      jobKey,
      manifestRevision: renderingManifestWrite.revision,
      jobRevision: queuedJobWrite.revision,
      now: input.now,
      renderer: rendered,
      bytes: null,
      error: {
        code: firstIssue?.code ?? "renderer-blocked",
        message: firstIssue?.message ?? "artifact renderer did not produce bytes",
        retryable: false,
      },
    })
  }

  const byteWrite = await byteStore.write({
    artifactId: renderingJob.artifact.artifactId,
    mediaType: rendered.mediaType,
    bytes: rendered.bytes,
  })

  if (!byteWrite.ok) {
    return persistFailedJob({
      adapter,
      records,
      job: renderingJob,
      artifactKey,
      jobKey,
      manifestRevision: renderingManifestWrite.revision,
      jobRevision: queuedJobWrite.revision,
      now: input.now,
      renderer: rendered,
      bytes: byteFact(byteWrite, null, null),
      error: {
        code: byteWrite.issues[0]?.code ?? "artifact-byte-write-blocked",
        message: byteWrite.issues[0]?.message ?? "artifact byte write did not complete",
        retryable: true,
      },
    })
  }

  const byteRead = await byteStore.read({ storageKey: byteWrite.artifact.storageKey })
  if (!byteRead.ok) {
    return persistFailedJob({
      adapter,
      records,
      job: renderingJob,
      artifactKey,
      jobKey,
      manifestRevision: renderingManifestWrite.revision,
      jobRevision: queuedJobWrite.revision,
      now: input.now,
      renderer: rendered,
      bytes: byteFact(byteWrite, byteRead, null),
      error: {
        code: byteRead.issues[0]?.code ?? "artifact-byte-read-blocked",
        message: byteRead.issues[0]?.message ?? "artifact byte readback did not complete",
        retryable: true,
      },
    })
  }

  const renderedManifest = renderedManifestForJob({
    job: renderingJob,
    byteWrite,
    createdAt: input.now,
  })
  if (Array.isArray(renderedManifest)) {
    return persistFailedJob({
      adapter,
      records,
      job: renderingJob,
      artifactKey,
      jobKey,
      manifestRevision: renderingManifestWrite.revision,
      jobRevision: queuedJobWrite.revision,
      now: input.now,
      renderer: rendered,
      bytes: byteFact(byteWrite, byteRead, null),
      error: {
        code: renderedManifest[0]?.code ?? "rendered-manifest-blocked",
        message: renderedManifest[0]?.message ?? "rendered artifact manifest did not validate",
        retryable: false,
      },
    })
  }

  const consistency = await byteStore.verifyManifestConsistency(renderedManifest)
  if (!consistency.ok) {
    return persistFailedJob({
      adapter,
      records,
      job: renderingJob,
      artifactKey,
      jobKey,
      manifestRevision: renderingManifestWrite.revision,
      jobRevision: queuedJobWrite.revision,
      now: input.now,
      renderer: rendered,
      bytes: byteFact(byteWrite, byteRead, consistency),
      error: {
        code: consistency.issues[0]?.code ?? "artifact-byte-consistency-blocked",
        message: consistency.issues[0]?.message ?? "rendered artifact manifest did not match stored bytes",
        retryable: true,
      },
    })
  }

  const renderedJob = advanceJob(renderingJob, {
    action: "complete-render",
    updatedAt: input.now,
    artifactManifest: renderedManifest,
  })
  if (Array.isArray(renderedJob)) {
    return blockedResult({ issues: renderedJob, records, bytes: byteFact(byteWrite, byteRead, consistency), renderer: rendered })
  }

  const renderedManifestWrite = await writeManifestRecord({
    adapter,
    key: artifactKey,
    value: renderedManifest,
    expectedRevision: renderingManifestWrite.revision,
    idempotencyKey: "backend-artifact-job-execution:manifest:rendered",
    now: input.now,
  })
  records.push(renderedManifestWrite.fact)
  if (!renderedManifestWrite.ok) {
    return blockedResult({ issues: renderedManifestWrite.issues, records, bytes: byteFact(byteWrite, byteRead, consistency), renderer: rendered })
  }

  const renderedJobWrite = await writeJobRecord({
    adapter,
    key: jobKey,
    value: renderedJob,
    expectedRevision: queuedJobWrite.revision,
    idempotencyKey: "backend-artifact-job-execution:job:rendered",
    now: input.now,
  })
  records.push(renderedJobWrite.fact)
  if (!renderedJobWrite.ok) {
    return blockedResult({ issues: renderedJobWrite.issues, records, bytes: byteFact(byteWrite, byteRead, consistency), renderer: rendered })
  }

  return terminalResult({
    status: "rendered",
    job: renderedJob,
    manifest: renderedManifest,
    jobRevision: renderedJobWrite.revision,
    manifestRevision: renderedManifestWrite.revision,
    records,
    bytes: byteFact(byteWrite, byteRead, consistency),
    renderer: rendered,
    issues: [],
  })
}
