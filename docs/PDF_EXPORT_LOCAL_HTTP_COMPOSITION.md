# PDF Export Local HTTP Composition

Status: `PDF-EXPORT-LOCAL-E` canonical trusted resolver, concrete local
provider composition, loopback-only PDF HTTP process, dedicated worker
factory, and request-to-download provider evidence accepted. LOCAL-F adds the
authenticated exact-pin eligibility contract used by the Editor proxy.
LOCAL-G now accepts the bounded canonical local-readiness audit. Product
document eligibility, deployment, and production binding remain closed.

## Outcome

LOCAL-E composes the accepted V-B through V-G and LOCAL-B through LOCAL-D
boundaries without changing the default Backend server. It adds dedicated
opt-in entry points for:

- the V-G request/status/cancel/download handler on `127.0.0.1`; and
- the LOCAL-D worker host using a concrete trusted composition factory.

Importing any LOCAL-E module starts no listener, timer, poll loop, migration,
bucket setup, worker, or cleanup. The HTTP listener starts only through
`FlowDocBackendPdfExportLocalHttpServerV1.start()`. The worker starts only
through the existing dedicated worker command.

The retained composition evidence records:

- `runtimeProfile = local-integration`;
- `localServerMounted = true` only after explicit listener start;
- `defaultApplicationServerMounted = false`;
- `listenerScope = loopback-only` and host `127.0.0.1`;
- `workerStart = dedicated-command`;
- `remoteProviderCallsAllowed = false`;
- `corsEnabled = false`; and
- `productionBinding = false`.

The V-G route response still reports `applicationServerMounted = false`.
LOCAL-E evidence describes a separate local process, not activation inside
`src/server.ts` or `src/http/server.ts`.

## Canonical Evidence Lane

The first accepted resolver handles only:

- document `instance-ocr-benchmark-inv_9437125258-2026-07-16`;
- revision `1`;
- the retained 13-page measured draw contract; and
- the exact two font sources/subsets and five report images.

The Core bundle, Phase T real-export handoff, and both subset manifests are
pinned by file SHA-256. The handoff must reproduce the exact document/source
identity, measured contract/content fingerprints, and artifact identity.
Every font source, font subset, and image is checked against its retained
digest and font byte lengths before the composition becomes available. The
resolver returns `not-found` for another document and `stale` for another
revision. There is no product-document fallback and no one-page fixture
substitution.

The renderer remains `canonical-full-document`, checks progress every 64 paint
commands, and carries a runtime-specific candidate qualification. The known
output remains 13 pages, `1212656` bytes, and SHA-256
`c4d09f0dfd66e1e3983bc679602fdc7d397de30edcb4f93fac3a0fa0c422960b`.

LOCAL-E also repairs a discovered cross-contract bound: the canonical Core
measurement-profile identity is 675 characters, while Backend identity
validation previously stopped at 512. The bounded Backend maximum is now
2048, retaining a finite request/repository bound while accepting the exact
Core identity.

## Local Security

The local HTTP command requires one uncommitted bearer token. The
authenticator derives a fixed local tenant/principal scope only from that
credential. Caller identity fields remain forbidden by the exact V-G request
shape. The authorizer evaluates request, read, cancel, and download actions
independently and accepts only the canonical document identity.

The raw token is not placed in response bodies, composition evidence,
observability, artifacts, or command output. No production identity provider
is selected. PDF routes add no CORS headers; LOCAL-F must use the Editor
development proxy to keep browser requests same-origin and inject the local
credential outside application code.

## LOCAL-F Eligibility Contract

The separate local listener now exposes
`GET /pdf-export-local/eligibility?documentId=...&documentRevision=...`.
Authentication is required before eligibility is returned. The trusted
canonical resolver classifies the exact retained pin as `eligible`, another
revision of that document as `stale`, and every other document as
`ineligible`. Eligible and stale canonical pins also pass request
authorization. The check does not invoke admission or create an operation.

The response contains only the requested pin, status, canonical evidence lane
or public reason, and fixed non-production contract facts. It contains no
credential, identity, source text, measured contract, resource digest,
provider detail, or operation identity. It is `no-store`, adds no CORS, and is
mounted only when the LOCAL-E composition supplies the eligibility inspector.

## Commands

The ignored environment file can be created or extended without replacing
existing values:

```text
npm run pdf-export-local:env
```

Provider migration and bucket setup remain explicit LOCAL-C commands. After
providers are ready and migrated, run the two processes in separate terminals:

```text
npm run pdf-export-local:http
npm run pdf-export-local:worker
```

The generated environment pins the HTTP host to `127.0.0.1`, defaults the
port to `4012`, creates a random local bearer token, identifies the trusted
Core/report roots, and selects the in-checkout LOCAL-E worker factory module.
The HTTP and worker commands both fail before serving or polling when the
profile, provider, schema, bucket, resource, or loopback checks fail.

## Provider Evidence

The portable harness creates temporary PostgreSQL 17.10 and pinned MinIO
providers on loopback. Its LOCAL-E case opens separate HTTP and worker
repository pools and object-store clients, then proves:

1. authenticated POST admits one durable operation and returns pending without
   inline rendering;
2. the worker discovers and owns that operation through PostgreSQL due work;
3. the canonical renderer produces and verifies bytes before metadata;
4. status reports one redacted completed result;
5. download verifies terminal, receipt, operation, physical length, and
   SHA-256 before returning the PDF; and
6. exact caller-key replay returns the existing operation and a later worker
   cycle invokes no work.

The actual-provider suite now passes `24/24`, including canonical eligibility,
the LOCAL-E request-to-download case, LOCAL-G two-process restart replay, HTTP
cancellation before handoff, and actual MinIO missing/corrupt readback faults.
Focused composition/readiness tests pass `8/8`.

Primary evidence:

- `src/pdfExport/pdfExportLocalCanonicalEvidence.ts`;
- `src/pdfExport/pdfExportLocalSecurity.ts`;
- `src/pdfExport/pdfExportLocalConfig.ts`;
- `src/pdfExport/pdfExportLocalComposition.ts`;
- `src/pdfExport/pdfExportLocalHttpServer.ts`;
- `src/pdfExport/pdfExportLocalEligibilityHttpHandler.ts`;
- `src/localPdfExport/pdfExportLocalHttpCommand.ts`;
- `src/localPdfExport/pdfExportLocalCompositionFactory.ts`;
- `src/tests/pdfExportLocalComposition.test.ts`; and
- `src/tests/pdfExportLocalProviders.integration.test.ts`.

LOCAL-G measurements and the complete exit-gate matrix are retained in
`docs/PDF_EXPORT_LOCAL_READINESS_AUDIT.md`.

## RISK

- Canonical bundle parsing and resource loading are synchronous from the
  renderer's perspective once worker execution starts. Shutdown becomes
  observable at the next cooperative paint checkpoint.
- The accepted lane is deliberately one immutable canonical revision. Product
  documents remain ineligible until trusted measurement and complete
  digest-bound resources exist.
- HTTP and worker use independent process clocks on one developer machine.
  LOCAL-E does not establish a distributed clock-skew policy.
- The local bearer authenticator is a development boundary, not a production
  identity or tenancy design.

## UNKNOWN

- Browser lifecycle evidence for a Backend-admitted Published Structure and
  test payload; the current product Editor document remains explicitly
  ineligible and is not the DocGen request contract.
- Durable Published Structure/admission storage and the E.4
  materialization-to-artifact binding.
- Production identity, providers, TLS/proxy, rate limits, deployment, SLOs,
  cost, retention, backup, and operations.

## Intentionally Not Changed

- Default `src/server.ts` and `src/http/server.ts` entry points or CORS policy.
- Core document, request, admission, lifecycle, renderer handoff, receipt,
  completion, persistence-order, or observability schemas.
- Existing V-G route body, security, status-redaction, cancellation, or
  verified-download behavior.
- Production Editor proxy, credential, or configuration.
- External queue, hosted provider, production renderer, deployment, or any
  production activation flag.

LOCAL-F Editor evidence is retained in
`../flowdoc-vnext-editor/docs/PDF_EXPORT_LOCAL_EDITOR_INTEGRATION.md`.

LOCAL-A through LOCAL-G local qualification is complete. REALDOC-E.0 now locks
the next work as API-driven DocGen rather than current Editor-document
eligibility. The Backend must admit a Published Structure Version, caller data,
mapping/input contract, generation instance, and digest-bound assets before
reusing this local lifecycle. The Editor pre-test must call the same path as an
external API-shaped client. See `docs/PDF_EXPORT_REALDOC_DOCGEN_HANDOFF.md`.
Production remains NO-GO and requires its own later review.

REALDOC-E.3 adds a separate optional `POST /docgen-local/admissions` handler to
this loopback server. The current local command does not configure it, the
existing `/pdf-exports` and eligibility contracts remain unchanged, and the
default application server remains unmounted. Explicit tests mount the handler
with trusted in-memory Structure/mapper/asset registries, enforce a 2 MiB HTTP
body and 1 MiB adapted-payload ceiling, and stop at a protected
materialization-ready canonical record. REALDOC-E.4 now binds that record to
the existing operation/worker/artifact lifecycle through a separate optional
local materializer. The default HTTP composition remains canonical-evidence
only. REALDOC-E.5.0 now locks the local Library and Design/Preview workspace
product contract without mounting anything. REALDOC-E.5.1 now mounts a separate
bounded metadata-only `GET /documents` route in the default local Backend used
by the Editor. It does not widen this PDF composition or expose DocGen values.
E.5.2 next adds workspace Design/Preview navigation; later E.5 phases expose
pre-test over the same admission and artifact path.
