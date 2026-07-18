# PDF Export Renderer Adapter And Qualification

Phase `PDF-EXPORT-V-D` adds the backend execution adapter between the durable
V-C lifecycle and the exact Core PDF handoff, receipt, and render-completion
contracts. It also adds a fingerprinted runtime candidate qualification and a
cooperative asynchronous cancellation protocol.

The adapter/control boundary is accepted. No concrete production renderer is
selected or promoted by this phase.

## Runtime Sequence

One renderer attempt performs the following ordered work:

1. parse the immutable V-B operation and candidate qualification;
2. require exact adapter implementation, renderer profile, measurement
   profile, Node version, platform, and architecture identity;
3. recreate the Core Phase T handoff and compare it with the admitted request,
   handoff, source-contract, and content fingerprints;
4. replay or apply the V-C `before-render` lifecycle transition;
5. invoke only the exact Core renderer input;
6. require cooperative cancellation checkpoints across the admitted paint
   command count;
7. verify returned PDF header, byte length, SHA-256, page count, profiles, and
   source-contract identities;
8. create the exact Core receipt and production render completion; and
9. check the V-C `before-persist` cancellation/deadline checkpoint before
   returning in-memory bytes.

Any failure returns no bytes, receipt, or completion. A successful result is
only `ready-for-persistence` and is the input boundary for V-E.

## Cooperative Cancellation

The renderer SPI receives an asynchronous control callback. A qualified
candidate must call it at paint-command index zero, at bounded monotonic gaps,
and at the terminal admitted paint-command count.

Each callback reloads the durable lifecycle and fails closed on:

- a retained cancellation request;
- the admitted deadline;
- claim expiry or ownership loss;
- lifecycle storage unavailability; or
- invalid, skipped, decreasing, or over-budget checkpoint indexes.

Cancellation or deadline observed during render discards candidate output and
records the applicable V-C terminal state at `before-persist`. A candidate that
ignores a cancellation decision cannot return bytes because the adapter checks
the retained stop decision after renderer return.

## Candidate Qualification

`src/pdfExport/pdfExportRendererQualification.ts` retains:

- adapter id, version, and implementation SHA-256;
- renderer and measurement profile ids;
- exact Node version, platform, and architecture;
- Core handoff/receipt contract versions;
- cancellation mode, maximum paint-command gap, and minimum checkpoint count;
- qualification-suite fingerprint and exact qualification time; and
- deterministic, byte-integrity, cancellation, and no-relayout assertions.

The qualification is explicitly `qualified-candidate`. Its contracts retain:

```text
candidateOnly = true
concreteProductionRendererSelected = false
deploymentBinding = false
productionBinding = false
```

The existing synchronous `@flowdoc/pdf-renderer-pilot` is not imported or
promoted. Core already records that it lacks cooperative mid-render
cancellation and production runtime qualification.

## Failure And Replay Evidence

Focused tests prove:

- exact handoff, Core receipt, output-limit completion, and lifecycle binding;
- exact replay of the durable `before-render` transition;
- stale source and qualification drift block before renderer invocation;
- invalid cancellation coverage and byte evidence discard all output;
- renderer exceptions return no partial bytes or Core receipt, and retry
  release resets lifecycle to `before-handoff`;
- cancellation requested while rendering is observed at the next renderer
  checkpoint and becomes `cancelled-before-persist`; and
- deadline observation becomes the durable `deadline-exceeded` stop.

Primary evidence:

- `src/pdfExport/pdfExportRendererQualification.ts`;
- `src/pdfExport/pdfExportRendererAttempt.ts`;
- `src/tests/pdfExportRendererQualification.test.ts`;
- `src/tests/pdfExportRendererAttempt.test.ts`; and
- `src/tests/helpers/pdfExportRendererFixture.ts`.

## Remaining Boundary

V-D writes no file, object, manifest, job, event, or route state. Rendered bytes
exist only in the successful return value and are not durable or replayable
after process loss. Authorization and production deployment are also absent.

The adapter, lifecycle binding, cooperative cancellation protocol, and runtime
candidate gate are accepted. Production renderer profile promotion remains an
activation blocker until a selected concrete renderer passes this gate with
retained qualification evidence.

Follow-up `PDF-EXPORT-V-E` now consumes only the successful V-D result and adds
durable content-addressed bytes, read-after-write verification, transactional
artifact manifest/job projection, terminal replay, and bounded orphan recovery
in `docs/PDF_EXPORT_DURABLE_ARTIFACT_PERSISTENCE.md`.

Follow-up `PDF-EXPORT-V-F` now composes this adapter into privacy-safe terminal
events and full restart/fault qualification in
`docs/PDF_EXPORT_PRIVACY_OBSERVABILITY_QUALIFICATION.md`. Concrete renderer
selection remains open and no production activation is claimed.

Post-V follow-up `PDF-EXPORT-LOCAL-B` now reuses this SPI for a controlled
local pilot adapter with bounded paint-command checkpoints and exact canonical
byte evidence in `docs/PDF_EXPORT_LOCAL_RENDERER_ADAPTER.md`. It retains
`concreteProductionRendererSelected = false` and does not change V-D or V-G
activation facts.
