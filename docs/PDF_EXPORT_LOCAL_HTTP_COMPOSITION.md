# PDF Export Local HTTP Composition

Status: `PDF-EXPORT-LOCAL-E` canonical trusted resolver, concrete local
provider composition, loopback-only PDF HTTP process, dedicated worker
factory, and request-to-download provider evidence accepted. Editor
integration, local readiness, deployment, and production binding remain
closed.

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

The actual-provider suite passes `20/20`, including the LOCAL-E
request-to-download case. Focused LOCAL-E composition/security/evidence tests
pass `4/4`.

Primary evidence:

- `src/pdfExport/pdfExportLocalCanonicalEvidence.ts`;
- `src/pdfExport/pdfExportLocalSecurity.ts`;
- `src/pdfExport/pdfExportLocalConfig.ts`;
- `src/pdfExport/pdfExportLocalComposition.ts`;
- `src/pdfExport/pdfExportLocalHttpServer.ts`;
- `src/localPdfExport/pdfExportLocalHttpCommand.ts`;
- `src/localPdfExport/pdfExportLocalCompositionFactory.ts`;
- `src/tests/pdfExportLocalComposition.test.ts`; and
- `src/tests/pdfExportLocalProviders.integration.test.ts`.

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

- LOCAL-F Editor capability/eligibility contract and development-proxy
  credential injection details.
- LOCAL-G cancellation timing, corruption/restart matrix, bounded load, and
  resource envelope for the complete local workflow.
- The first trusted product-document measurement/resource resolver.
- Production identity, providers, TLS/proxy, rate limits, deployment, SLOs,
  cost, retention, backup, and operations.

## Intentionally Not Changed

- Default `src/server.ts` and `src/http/server.ts` entry points or CORS policy.
- Core document, request, admission, lifecycle, renderer handoff, receipt,
  completion, persistence-order, or observability schemas.
- Existing V-G route body, security, status-redaction, cancellation, or
  verified-download behavior.
- Editor source, proxy, controls, or production configuration.
- External queue, hosted provider, production renderer, deployment, or any
  production activation flag.

Next phase: `PDF-EXPORT-LOCAL-F` Editor eligibility, request, status,
cancellation, and verified-download integration through a development-only
same-origin proxy.
