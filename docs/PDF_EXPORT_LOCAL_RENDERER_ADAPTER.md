# PDF Export Local Renderer Adapter

Status: `PDF-EXPORT-LOCAL-B` generic SPI audit, controlled pilot execution,
local adapter, and canonical evidence accepted. Storage, worker hosting, route
mounting, Editor integration, and production renderer selection remain closed.

## Outcome

LOCAL-B reuses the accepted V-D `FlowDocBackendPdfExportRendererV1` SPI. It does
not add a competing renderer contract. The local adapter binds one explicit
pilot profile, resource resolver, checkpoint interval, adapter identity, and
implementation fingerprint to that SPI.

Core's private renderer pilot now exposes controlled one-page and canonical
full-document execution. Both paths use the same paint-command serialization
and PDF object assembly as the synchronous renderer. The controlled path checks
at command index `0`, every configured bounded interval, and the exact terminal
command count. Cancellation returns no bytes or artifact.

## Package Boundary

The pilot package is split into explicit source surfaces:

- `@flowdoc/pdf-renderer-pilot/renderer` exposes renderer-only execution;
- `src/canonical.ts` owns canonical preparation-tool exports;
- `src/exportExecution.ts` owns the Phase T Core handoff wrapper; and
- the package root retains the combined compatibility surface through
  `src/full.ts`.

Backend loads only the renderer subpath through a local-only module boundary.
This prevents renderer execution from importing canonical shaping, pagination,
or text-engine preparation modules. Failure to load the local renderer module
returns a blocked result and no bytes.

## Local Adapter

`createFlowDocBackendLocalPdfRendererV1` accepts:

- profile `thai-one-page` or `canonical-full-document`;
- one injected trusted font/image resource resolver; and
- a paint-command checkpoint interval from `1` through `10000`.

The adapter fingerprint binds source, adapter version, profile, interval,
controlled renderer API version, cooperative cancellation, and blocked
production state. Resource bytes are verified by the pilot against the exact
Core measured-contract asset identities before PDF bytes can be returned.

The adapter writes no files or storage, starts no worker, opens no listener,
and retains:

- `concreteProductionRendererSelected = false`; and
- `productionBinding = false`.

## Evidence

Portable one-page evidence proves:

- controlled and synchronous output are byte-identical;
- checkpoints are exactly `[0, 2, 4]` for the four-command fixture;
- cancellation at command `2` returns no partial bytes or evidence;
- invalid checkpoint intervals fail before invoking control;
- unavailable and throwing resource resolvers fail closed; and
- the real local adapter passes V-D lifecycle, qualification, Core receipt,
  render-completion, and `ready-for-persistence` validation.

Canonical local evidence uses the retained 13-page contract, two GID-retaining
font subsets, and five external report images. It returns:

- `1814` paint commands and `30` checkpoints;
- maximum checkpoint gap `64`;
- `13` pages and `1212656` bytes; and
- SHA-256
  `c4d09f0dfd66e1e3983bc679602fdc7d397de30edcb4f93fac3a0fa0c422960b`.

The canonical test runs when the five external evidence images are available
under `FLOWDOC_PDF_PILOT_REPORT_ROOT` or the retained local report path. It is
explicitly skipped when those non-repository bytes are absent. Portable
one-page correctness and cancellation tests always run.

Primary evidence:

- `../flowdoc-vnext-core/packages/pdf-renderer-pilot/src/index.ts`;
- `../flowdoc-vnext-core/packages/pdf-renderer-pilot/src/full.ts`;
- `../flowdoc-vnext-core/tests/pdfRendererPilotControlledExecution.test.ts`;
- `src/pdfExport/pdfExportLocalRenderer.ts`;
- `src/tests/pdfExportLocalRenderer.test.ts`;
- `src/pdfExport/pdfExportRendererAttempt.ts`; and
- `src/pdfExport/pdfExportRendererQualification.ts`.

## RISK

- Resource preparation remains synchronous before paint-command serialization.
  Cancellation is cooperative during actual command serialization, while font
  parsing and resource validation remain bounded by the admitted asset policy.
- The local adapter loads a private pilot package and is not a selected or
  supported production renderer package.
- Canonical image bytes remain external evidence and are intentionally not
  copied into this repository.

## UNKNOWN

- Which non-canonical product document first has a complete trusted measured
  contract and resource set for the `product-document` eligibility lane.
- Whether later load evidence requires renderer process isolation in addition
  to asynchronous cooperative checkpoints.

## Intentionally Not Changed

- Core handoff, receipt, admission, completion, or measured draw schemas.
- V-D generic renderer SPI and lifecycle checkpoint semantics.
- V-E persistence or V-F terminal workflow behavior.
- Default server, worker, route, Editor, local durable provider, or production
  configuration.

Follow-up `PDF-EXPORT-LOCAL-C` accepts local PostgreSQL metadata and
S3-compatible byte-provider adapters in
`docs/PDF_EXPORT_LOCAL_POSTGRES_S3_ADAPTERS.md`. Worker hosting, route mounting,
Editor integration, and production selection remain later phases.
