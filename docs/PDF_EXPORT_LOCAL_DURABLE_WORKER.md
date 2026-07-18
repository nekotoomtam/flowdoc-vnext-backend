# PDF Export Local Durable Worker

Status: `PDF-EXPORT-LOCAL-D` bounded PostgreSQL due-work discovery, one-owner
runner, expiry reclaim, stopped lifecycle finalization, explicit-start worker
host, shutdown drain, and orphan-maintenance cadence accepted. LOCAL-E now
supplies the concrete canonical local factory and separate HTTP process;
Editor integration, readiness, deployment, and production binding remain
closed.

## Outcome

LOCAL-D turns the accepted V-C lifecycle and LOCAL-C providers into an opt-in
worker lifecycle without changing Core or the V-B through V-G contracts. It
adds three boundaries:

- read-only PostgreSQL discovery over exact retained lifecycle heads;
- one-attempt ownership/execution/recovery around the existing V-F workflow;
  and
- a concurrency-one host with bounded polling, backoff, drain, force stop, and
  one-page orphan maintenance.

Creating or importing these boundaries starts no loop or timer. The host runs
only after its explicit `start()` call. It retains `runtimeProfile =
local-integration`, does not mount the default server, uses no external queue,
and retains `productionBinding = false`.

## Due Work

`FlowDocBackendPdfExportDueWorkRepositoryV1` returns at most 64 entries in
stable `(dueAt, operationId)` keyset order. Listing is read-only and exposes
three lanes:

- `claim-ready`: pending work whose initial/retry time is due;
- `claim-expired`: claimed work whose bounded claim expired; and
- `terminal-finalization`: stopped lifecycle evidence that still lacks the
  atomic V-F terminal workflow completion.

The stopped lane prevents a crash after cancellation, deadline, attempt
exhaustion, or force shutdown from leaving terminal evidence unfinished.
PostgreSQL excludes any operation that already owns workflow completion, so a
completed lifecycle cannot reappear after its old claim expiry.

Discovery never claims or changes a revision. Concurrent workers may observe
the same page; the existing lifecycle revision/fingerprint CAS remains the
execution ownership boundary.

## One-Attempt Runner

The runner checks retained terminal completion and immutable operation scope
before claiming. A claim is bounded by both configured duration and the pinned
operation deadline. Expired claims restart from `before-handoff` under the next
attempt, while stopped entries invoke V-F only to finalize terminal evidence.

Provider uncertainty is reconciled conservatively:

- an interrupted or unavailable claim response is followed by a lifecycle
  read; execution continues only when the exact claim token owns the head;
- executor failure checks terminal completion before retry release;
- unknown terminal state is never followed by a release; and
- an unavailable release response is accepted only when readback proves the
  exact retained release token and pending/stopped result.

Blocked execution releases only while its claim and deadline windows remain
safe. Retry backoff that reaches the deadline leaves the bounded claim to
expire, allowing the next due observation to enforce the deadline. Attempt
exhaustion and stopped lifecycle finalization retain no duplicate render or
persistence.

## Worker Host

`createFlowDocBackendPdfExportLocalWorkerHostV1` owns one sequential execution
slot. Each cycle performs one fresh bounded scan, invokes entries in order,
then runs at most one maintenance page. Fresh scans are intentional: processed
entries move out of the due set, while concurrently moved entries are visible
again without treating a keyset cursor as a durable queue offset.

Default local candidate values are an eight-entry page, 30-second claim,
one-second retry/poll interval, and two-second provider-unavailable backoff.
Every value is bounded and configurable; these are candidate defaults, not an
SLA or production capacity decision.

Graceful drain rejects new reservations, wakes an idle poll immediately, and
waits for the active reservation to finish. Force stop records the process
gate result and applies a durable `force-shutdown` lifecycle transition to the
active operation. The renderer observes that stop at its next cooperative
checkpoint.

## Orphan Maintenance

`createFlowDocBackendPdfExportLocalOrphanMaintenanceV1` gives the LOCAL-C
resumable object cursor an explicit owner. It runs only after due work, scans
one bounded page per invocation, retains the cursor across worker cycles, and
continues immediately while another page exists. A completed sweep waits for
the configured interval; an unavailable provider uses bounded backoff.

The cursor is process-local. Restart begins a new safe sweep from the first
page rather than persisting an object-provider continuation token across
provider replacement. Metadata is still rechecked immediately before every
delete.

## Dedicated Command Boundary

`npm run pdf-export-local:worker` is the only dedicated command entry point.
It requires an explicit local factory module inside the Backend checkout. The
factory must return an accepted concurrency-one local host and close all
providers. Missing, external, malformed, production, or automatically started
factories fail before the host starts.

LOCAL-D intentionally does not ship a default factory. LOCAL-E now owns the
concrete trusted admission/resource resolver, local renderer composition,
provider wiring, and loopback HTTP process in
`docs/PDF_EXPORT_LOCAL_HTTP_COMPOSITION.md`. The command still requires the
explicit in-checkout factory-module setting and cannot silently substitute
canonical fixtures for ineligible product documents.

## Evidence

Focused portable tests prove:

- V-F render/persist/terminal completion through one due claim;
- claim reconciliation after an injected post-commit interruption;
- no release after terminal commit followed by executor interruption;
- bounded retry release, attempt exhaustion, and stopped finalization;
- no start on construction, idle-poll wake-up, graceful drain, and durable
  force shutdown; and
- one orphan page per maintenance invocation with cursor continuation and
  interval deferral.

Actual PostgreSQL 17.10 and MinIO evidence proves:

- stable keyset pages across pending, expired-claim, and stopped lanes without
  lifecycle mutation, active-claim leakage, or terminal reappearance;
- two independent pools observing the same due page but exactly one renderer
  and persistence owner;
- expired-claim reclaim after provider close/reopen at attempt two; and
- stopped lifecycle terminal finalization after provider restart without
  renderer or persistence execution.

The focused worker suite passes `7/7`. The portable actual-provider suite now
passes `19/19` total cases, including four LOCAL-D integration cases.

Primary evidence:

- `src/pdfExport/pdfExportDueWork.ts`;
- `src/pdfExport/pdfExportLifecyclePostgresRepository.ts`;
- `src/pdfExport/pdfExportLocalWorker.ts`;
- `src/pdfExport/pdfExportLocalWorkerHost.ts`;
- `src/pdfExport/pdfExportLocalOrphanMaintenance.ts`;
- `src/pdfExport/pdfExportLocalWorkerCommandRuntime.ts`;
- `src/localPdfExport/pdfExportLocalWorkerCommand.ts`;
- `src/tests/pdfExportLocalWorker.test.ts`; and
- `src/tests/pdfExportLocalProviders.integration.test.ts`.

## RISK

- The host executes sequentially at concurrency one. Correctness is qualified
  across two pools, but fairness, saturation, and accepted workload latency are
  not yet measured.
- Polling uses PostgreSQL rather than a notification or external queue. This is
  intentional for the local lane but requires measurement before tuning.
- Force shutdown is durable immediately, but synchronous trusted resource
  preparation cannot be preempted until control returns or the renderer reaches
  its next cooperative checkpoint.
- The maintenance cursor is process-local. Restart may rescan earlier objects,
  though reference rechecks and content identities keep deletion safe.
- Local system clocks share one machine. No distributed skew policy is claimed.

## UNKNOWN

- Final poll, batch, claim, retry, drain, and maintenance values after LOCAL-G
  bounded-load evidence.
- The first non-canonical product-document resolver accepted by LOCAL-E.
- Production queue/wake-up, provider, telemetry, deployment, and operator
  policy.

## Intentionally Not Changed

- Core document, admission, lifecycle, renderer handoff, receipt, completion,
  or commit-order schemas.
- Existing V-F workflow or V-G route/security contracts.
- Default Backend server or any HTTP route mount.
- Editor source, development proxy, controls, or production configuration.
- External queue, production provider, production renderer, deployment, or
  activation flags.

Follow-up `PDF-EXPORT-LOCAL-E` accepts the concrete local composition factory
and loopback-only PDF HTTP process. Next phase: `PDF-EXPORT-LOCAL-F` Editor
integration through the development-only same-origin proxy.
