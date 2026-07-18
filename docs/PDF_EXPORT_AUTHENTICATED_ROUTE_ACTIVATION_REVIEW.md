# PDF Export Authenticated Route And Activation Review

Status: `PDF-EXPORT-V-G` authenticated route candidate accepted. Production
activation decision: **NO-GO**.

The route, authentication, authorization, scoped repository, cancellation,
status, and verified-download behavior are implemented and qualified. The
handler is not mounted into the default application server and no production
identity, policy, worker, renderer, storage, telemetry, or deployment provider
is selected.

## Route Surface

| Method | Path | Required permission | Behavior |
| --- | --- | --- | --- |
| `POST` | `/pdf-exports` | `pdf-export:request` | resolves a trusted document pin, admits one caller-key operation, and initializes lifecycle |
| `GET` | `/pdf-exports/:operationId` | `pdf-export:read` | returns a redacted public state from V-B through V-F evidence |
| `POST` | `/pdf-exports/:operationId/cancel` | `pdf-export:cancel` | applies one replay-safe V-C cancellation while work is cancellable |
| `GET` | `/pdf-exports/:operationId/download` | `pdf-export:download` | returns PDF bytes only after terminal, receipt, and physical-byte verification |

The concrete Node HTTP adapter caps JSON request bodies at 16 KiB, rejects
unknown methods, emits `no-store` and `nosniff`, does not add permissive CORS,
and returns a fixed attachment filename. It is an exported composition handler,
not default server wiring.

## Trust Boundary

Tenant and principal identity come only from the injected authenticator. The
request body is a closed `{ documentId, documentRevision }` record; caller
tenant/principal fields make the request invalid. Every successful action calls
the authorizer with authenticated identity, action, document, and optional
operation identity.

Operation lookup is already scoped by tenant and principal. A different
principal receives `404` before authorization, so the route does not reveal
whether another scope owns the operation. Public status omits tenant,
principal, storage key, credential, and internal fingerprints.

The request route uses the caller `Idempotency-Key`, but a trusted admission
resolver owns source loading, measured-contract loading, policy, and generated
operation/request/artifact identities. If operation admission survives without
lifecycle initialization, exact request replay repairs the missing lifecycle.

## Cancellation And Completion Precedence

Cancellation checks V-F terminal completion and V-E persistence before
mutating lifecycle. It derives one scoped transition identity from the caller
cancel key and returns exact replay after restart.

V-E persistence and V-C cancellation are separate durable boundaries, so a
late cancellation can race a persistence commit. The route rereads persistence
after the transition. V-F also verifies V-E persistence before interpreting a
stopped lifecycle. Verified persistence therefore wins and finalizes as
completed; late cancellation cannot discard or relabel committed bytes.

## Download Gate

Download requires all of the following:

1. authenticated and authorized scoped operation ownership;
2. V-F terminal status `completed`;
3. the exact V-E persistence receipt named by the V-F completion;
4. matching immutable operation fingerprints; and
5. content-store readback matching storage key, byte length, and SHA-256.

Any missing or mismatched evidence returns JSON with no bytes. The route does
not expose a storage key or pre-signed URL.

## Qualification Evidence

Focused tests prove unauthenticated and denied requests, body identity spoofing,
scope concealment, request replay and conflict, admission-only crash repair,
cancellation replay/conflict, completed cancellation rejection, redacted
status, corruption rejection, bounded HTTP bodies, headers, and exact PDF
download bytes.

SQLite qualification closes and reopens V-B, V-C, V-E, and V-F repositories.
It retains cancellation replay and reopens completed status/download without
running the workflow again.

Primary files:

- `src/pdfExport/pdfExportRoute.ts`;
- `src/pdfExport/pdfExportHttpHandler.ts`;
- `src/tests/pdfExportRoute.test.ts`;
- `src/tests/pdfExportHttpHandler.test.ts`;
- `src/tests/pdfExportRouteSqliteQualification.test.ts`; and
- `src/tests/pdfExportWorkflow.test.ts`.

## PASS

- Credential-derived tenant/principal and mandatory per-action authorization.
- Closed request schema and scoped non-disclosing operation reads.
- Durable request/cancellation replay and lifecycle repair.
- Redacted status over V-B through V-F evidence.
- Terminal plus physical-verification download gate.
- Concrete bounded HTTP adapter and SQLite restart evidence.

## FAIL / BLOCKER

- No production authentication provider or token validation policy.
- No production authorization/tenancy policy provider.
- No production source/measured-contract admission resolver.
- No concrete production renderer promotion.
- No automatic or multi-process worker/queue host.
- No selected production byte/metadata storage provider or migration plan.
- No selected telemetry delivery, retention, alerting, or deletion provider.
- No default application-server mount, rate limit, TLS/proxy policy, secrets,
  deployment configuration, or rollout/rollback plan.

## RISK

- V-B through V-F use separate repository transactions. The accepted
  persistence-wins rule resolves late cancellation, but production providers
  still need cross-boundary failure monitoring and reconciliation.
- The current filesystem and SQLite adapters are qualification candidates, not
  a scale, backup, multi-region, or disaster-recovery claim.
- Bounded filesystem orphan scans have no durable cursor and therefore do not
  prove eventual cleanup when a content directory exceeds one scan window.

## UNKNOWN

- Production identity claims and tenant membership model.
- Production database/object-store/telemetry products and retention SLAs.
- Renderer capacity, worker concurrency, timeout, queue, and retry SLOs.
- Download delivery strategy for large artifacts and external clients.

## Intentionally Not Changed

- The default `src/http/server.ts` and development CORS behavior.
- Editor request/status/cancel/download UI.
- Concrete renderer, queue, provider, deployment, or production flag.
- Core document, pagination, measurement, handoff, receipt, or artifact schema.

`PDF-EXPORT-V` closes with an accepted authenticated route candidate and a
NO-GO production activation decision. The accepted next lane is a local
provider-neutral runtime harness and readiness proof. Production provider
selection, default mounting, deployment, and rollout remain deferred; no
production activation phase is named.

The authoritative post-V topology, profile separation, phase order, and
promotion rule are retained in
`../flowdoc-vnext-core/docs/PDF_EXPORT_LOCAL_FIRST_ARCHITECTURE_LOCK.md`.
