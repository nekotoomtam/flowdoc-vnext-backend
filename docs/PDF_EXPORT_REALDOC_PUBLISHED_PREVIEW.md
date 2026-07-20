# PDF Export REALDOC Published Preview

Status: `PDF-EXPORT-REALDOC-E.5.6` accepted for the optional local Backend
composition. Production remains NO-GO.

## Published Context

`GET /docgen-local/published-preview-context` requires Bearer authentication and
the exact `docgen:inspect-published-preview` authorization action. Lookup is by
authoring `documentId` plus `documentRevision`; unknown or stale pins fail
closed.

The returned context is value-free and pins:

- the exact Published Structure Version and E.5.3 projection;
- canonical mapping profiles whose owner and target match that projection;
- the trusted asset admission template;
- the existing 1 MiB adapted-payload limit; and
- explicit false contracts for business values, raw payload, executable mapper,
  default production binding, and production activation.

The route is optional in `createFlowDocBackendPdfExportLocalHttpServerV1(...)`.
Existing local and default application compositions do not mount it.

## Same Admission And Artifact Path

The Editor submits imported JSON to the existing E.3
`POST /docgen-local/admissions` route. Backend selects the allowlisted mapper,
verifies exact profile/execution identity, validates the mapped canonical input,
stores the protected record, and returns the existing content-free receipt.

The receipt's revision-zero `instanceId` and revision are then submitted to the
existing E.4 `/pdf-exports` route. Operation, lifecycle, worker, persistence,
status, cancellation, terminal replay, artifact bytes, and download semantics
are not reimplemented in the Editor.

## Local Runtime

`pdfExportRealdocE56Runtime.ts` composes an isolated in-memory E.3/E.4 runtime
for 69C evidence. Core prepares the source-specific profile/projection/payload;
Backend executes the named UAT mapper through the bounded Core helper process.
No mapper implementation or definition is sent to the browser.

The local command requires:

- `FLOWDOC_REALDOC_E56_SEMANTIC_DIR`;
- the existing bounded `FLOWDOC_PDF_LOCAL_BEARER_TOKEN`; and
- loopback host/port configuration.

Run evidence with:

```text
npm run pdf-export-realdoc-e56:verify -- --semantic-dir <semantic-directory>
```

## Retained Evidence

`src/tests/fixtures/pdf-export-realdoc-e56-evidence.v1.json` records:

- exact context/projection/profile fingerprints;
- adapted mapping `executed` and validation `run-valid`;
- 0 diagnostic errors and 3 warnings;
- canonical business data exposed: false;
- raw payload retained: false;
- completed 10-page, 1,417,544-byte PDF;
- SHA-256
  `d8b3b45c4364639a8eb71fd13510fd1cbb8661d4a57ecc97d76aa23fb1688b61`;
- verified download: true; and
- same Backend admission and artifact lifecycle as an API-shaped caller.

The complete 200-page source is not accepted by this evidence. It remains
`PDF-EXPORT-REALDOC-G`.

## Explicitly Not Changed

- no default server mount or production binding;
- no hosted provider, deployment, durable generation repository, or tenancy
  claim;
- no raw payload or mapped canonical values returned to Editor;
- no browser mapper;
- no Form draft admission; and
- no durable Draft Preview repository or arbitrary live-draft compiler.

## Next Phase

`PDF-EXPORT-REALDOC-E.5.7` now accepts a separate immutable Draft Preview
identity and admission path without reusing Published Structure identity for
draft facts. E.5.8 now accepts complete local lifecycle UX; E.5.9 next owns
Form/API parity. Production remains NO-GO.
