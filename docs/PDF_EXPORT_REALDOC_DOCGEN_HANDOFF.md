# PDF Export REALDOC DocGen Backend Handoff

Status: `PDF-EXPORT-REALDOC-E.6.2` durable operation/lifecycle/artifact
reconstruction accepted after durable protected admission. Editor reconnect,
default application mounting, and production behavior remain inactive;
production remains NO-GO.

## Direction

The Backend does not receive a browser-authored PDF layout or treat the current
Editor working-set document pin as the future DocGen input contract. It accepts
an exact Published Structure Version plus caller-owned data through a dedicated
generation boundary, then delegates canonical semantics to Core.

```text
Editor pre-test or external API caller
  -> Published Structure Version identity
  -> direct canonical data or versioned mapping-profile input
  -> caller request identity and asset references
  -> Backend admission and exact input pins
  -> Core materialization / resolution / measurement / pagination
  -> existing local worker and artifact lifecycle
```

The Editor pre-test and external API route must converge before mapping and
canonical resolution. A successful browser-only path is not sufficient.

## Backend Ownership

Backend owns:

- immutable Published Structure Version retrieval and compatibility checks;
- allowed input-contract or mapping-profile selection;
- exact payload-byte or canonical-value fingerprinting;
- runtime data validation, mapping execution, defaults, and diagnostics once
  their dedicated contracts are accepted;
- generation/instance identity and revision allocation;
- trusted asset lookup, digest verification, and byte availability;
- idempotency, authorization, persistence, workers, cancellation, status,
  retry/replay, and verified artifact download.

Backend does not own Structure semantics, field placement, pagination rules,
or renderer relayout. Those remain Core contracts. Caller input cannot select
trusted renderer, storage provider, worker, tenant, artifact identity, or final
page geometry.

## Input Families

The future local admission contract must distinguish:

1. direct canonical Data Snapshot values that already match one exact
   Published Structure field/data contract; and
2. adapted payload values that name one allowed versioned mapping profile and
   are transformed before canonical Data Snapshot admission.

Both lanes must retain the same downstream identity facts: Published Structure
Version, accepted input contract, mapping profile when present, source payload
fingerprint, canonical Data Snapshot fingerprint, generation instance,
digest-bound assets, and resolved/measured contract identities.

Mapping diagnostics may report paths, codes, and content-free fingerprints.
They must not persist source text, raw payloads, credentials, or PDF bytes into
privacy-safe lifecycle events.

## E.1 Accepted Core Input

Core now exposes one strict, source-neutral planning boundary for both input
families. Backend will later construct that request only after trusted
Published Structure, data-contract, instance, payload, and mapping-profile
admission:

- direct canonical snapshots produce `runtime-validation-required`;
- adapted payload descriptors plus an exact named-adapter or declarative
  mapping profile produce `mapping-required`; and
- both results remain content-free and stop before mapping, runtime value
  validation, materialization, resolution, rendering, or artifact creation.

Backend retains or streams the exact raw payload bytes. Core receives their
id, media type, byte length, and SHA-256 descriptor, not the raw JSON. Backend
must verify the mapping profile owner and target data-contract pins before the
future E.2 runtime executes it.

E.1 adds no request parser, route, repository, worker, provider, payload
retention policy, or product-document eligibility. The existing local
document-pin route remains unchanged.

## E.2 Accepted Core Runtime

Core now executes admitted E.1 requests far enough to return validated
canonical snapshots:

- exact UTF-8 payload byte length and SHA-256 are verified before JSON parsing;
- one injected mapper must match the exact named-adapter or declarative-mapping
  execution identity admitted by the profile;
- mapped and direct snapshots use the same fail-closed validator; and
- ready output stops at `materialization` with every downstream execution fact
  still `not-run`.

Runtime diagnostics contain generated codes, bounded paths, counts, and
fingerprints without source values or mapper exception text. Ready canonical
snapshots do contain caller business data and must not be copied into redacted
operation/status events.

Backend E.3 therefore adds a bounded local admission owner around this runtime.
It retrieves the exact Published Structure/data contract, creates the
generation instance, enforces request size and payload retention policy,
selects an allowlisted mapper by exact execution identity, and admits asset
bytes before calling Core. The browser or caller cannot provide executable
mapper code.

E.2 adds no Backend parser, route, mapper registry, authorization decision,
repository, worker, storage object, provider, or lifecycle event. The current
document-pin local lane remains unchanged.

## E.3 Accepted Local Admission

E.3 adds one strict `POST /docgen-local/admissions` handler that can be mounted
only by explicitly passing `docGenAdmissionOptions` to the existing loopback
local HTTP server. It is absent by default, is not mounted by the local command
composition or normal application server, adds no CORS headers, and retains
`productionBinding: false`.

The bounded request accepts only one exact Published Structure Version ref,
one digest-bound instance image registry, and either direct `DataSnapshotV2`
plus collection values or an exact mapping-profile id/version plus ephemeral
UTF-8 JSON text. The HTTP envelope is capped at 2 MiB; adapted JSON text is
separately capped at 1 MiB of UTF-8 bytes. `Authorization`,
`Content-Type: application/json`, and `Idempotency-Key` are required.

The strict schema rejects caller tenant, principal, instance, mapper code,
layout, renderer, provider, worker, artifact, and final-geometry facts. Backend
derives tenant/principal only from authentication, authorizes `docgen:admit`
for the exact Structure, resolves an immutable data contract, and selects only
an allowlisted mapping profile plus mapper with an exact execution identity.
It creates a deterministic revision-0 Document Instance and snapshot ids.

The local trusted asset registry verifies actual bytes against exact byte
length and SHA-256 before Core executes. Backend then requires mapped canonical
media to equal the admitted registry. Missing bytes, definition drift, mapping
drift, runtime validation failure, or canonical-media drift blocks without a
protected record.

Successful canonical snapshots are retained only in a protected in-memory
record for E.4. Raw adapted JSON is not retained. The public receipt contains
only identities, fingerprints, counts, and content-free Core diagnostics.
Same-scope exact replay returns that receipt without rerunning a mapper; a
changed request under the same idempotency key conflicts.

E.3 returns `202` for creation, `200` for replay, `409` for conflict, `413` for
an oversized body, `415` for unsupported content type, and `422` for blocked
admission. It performs no materialization, resolution, measurement, pagination,
worker enqueue, renderer call, storage write, artifact projection, status
lifecycle, or download.

## E.4 Accepted Artifact Binding

E.4 adds `createFlowDocBackendDocGenLocalArtifactBindingV1(...)`. The binding
looks up a protected E.3 record by credential-scoped `instanceId`, requires the
exact revision, and revalidates the record, receipt, canonical input, and asset
fingerprints before materialization. Trusted asset bytes are reread through
the digest-verifying registry; raw adapted JSON is never retained or reread.

The document-specific materializer is injected behind a generic Backend SPI.
The accepted UAT implementation invokes Core's local source-neutral canonical
resolver and measured runtime through a bounded subprocess. This keeps UAT
semantics in Core and prevents Backend from compiling or duplicating the UAT
layout implementation.

The resulting source identity binds the protected record fingerprint,
canonical input fingerprint, materializer identity, measured contract, and
digest-bound resources. Changed canonical data therefore cannot replay stale
artifact bytes even when a materializer emits the same synthetic contract in
a test.

The existing `/pdf-exports` route accepts the E.3 instance id/revision and
creates the existing immutable operation. Existing worker claims,
cooperative cancellation, retry-capable lifecycle, content-addressed
persistence, redacted status, terminal replay, physical byte verification, and
download are reused without a parallel DocGen artifact state machine.

The retained 69C evidence passes with 10 requirements, 7 screenshots, and a
10-page 1,417,544-byte PDF whose SHA-256 is
`61f84cbd503260faf9ff60e303d7053fb09b5ef1b24cb720fc54e0bb24262d0a`.
Route replay does not rematerialize. Cancellation before worker persists no
bytes. Evidence is content-free in
`src/tests/fixtures/pdf-export-realdoc-e4-evidence.v1.json`.

## E.5.0 Product Contract Handoff

The accepted Editor product contract lives in
`../flowdoc-vnext-editor/docs/REALDOC_DOCUMENT_WORKSPACE_PRODUCT_CONTRACT.md`.
A local Document Library opens one workspace with URL-backed Design and
Preview views. Design owns Structure draft authoring. Preview owns temporary
generated-Form or mapped-JSON test input and reuses Backend generation and
artifact authority.

E.5.1 adds a bounded Library read model instead of returning raw package
records. The local `GET /documents` list boundary returns authoring
document identity, title, revision, update time, draft/published summaries, and
derived Design/Preview capabilities. It does not return package graphs, test
values, canonical snapshots, generated instances, or artifact bytes. Cursor
and limit policy must be defined and tested in the E.5.1 Backend response
contract at the mounted local development route.

There is no multi-user authorization system yet. The first list is explicitly
local-workspace evidence and cannot claim secure per-user scoping. A future
authenticated composition must inject tenant/workspace/principal scope before
the repository query; browser query parameters never select an owner.

Published Preview continues through E.3/E.4. Draft Preview later requires a
separate immutable local draft-snapshot identity and must not enter E.3 while
claiming to be a Published Structure Version. E.5.0 changes no repository,
route, composition, request, or runtime.

## E.5.1 Local Library Handoff

The in-memory package repository now exposes a bounded keyset list ordered by
`updatedAt` descending and `documentId` ascending. `GET /documents` accepts an
optional opaque cursor and a limit from 1 through 100, defaulting to 24. Invalid
limits or cursors return a content-free `400 invalid-request` response.

The version-1 response projects only Library metadata and derived capability
states. It excludes raw package graphs, field registries, payloads, canonical
snapshots, generation instances, measured contracts, artifact records, and PDF
bytes. Existing V2/V3 fixtures honestly report `migration-required`, Published
state is `unavailable`, and Preview remains unavailable. The route declares
`local-workspace`, `local-development`, and `authorization: not-configured`;
it does not claim secure user or tenant scope.

This endpoint is mounted in the existing local Backend server used by the
Editor. It does not change DocGen admission, PDF routes, renderer, worker,
storage providers, or production composition. Retained contract and HTTP tests
cover ordering, pagination, invalid input, and content exclusion.

## E.5.2 Workspace Tabs Handoff

The Editor now retains one document-keyed Design runtime while URL-backed
Design and Preview views switch. The Preview route reads only the already-loaded
authoring document summary and reports migration-required or unavailable state.
It submits no data and calls no Backend admission, materialization, PDF, status,
or download route.

No Backend contract or implementation changes in E.5.2. `GET /documents` keeps
Preview capability unavailable, direct Library Preview action remains disabled,
and `GET /documents/:documentId` remains the sole authoring load. The new route
does not imply Published Structure, generation instance, canonical snapshot, or
artifact identity.

## E.5.3 Test-Input Projection Handoff

Core now exposes one pure input projection over an exact Published Structure
owner/fingerprint, generation data contract, Document V4 graph, and Published
table definition/binding contracts. It derives one value identity per document
field key, first-placement section order, explicit unplaced fields, collection
item scope, and image/media requirements. Missing scalar requiredness, enum
choices, date format, and collection limits are reported as unavailable rather
than guessed.

No Backend contract or implementation changes in E.5.3. The Backend does not
serve this projection yet, and no request creates Editor test values, canonical
snapshots, generation instances, operations, or artifacts. A future transport
must load trusted exact Structure/table contracts; it must not accept those
contracts as caller-authored layout facts.

## E.5.4 Temporary Form Handoff

Editor now owns one memory-only generated Form session over a ready E.5.3
projection. The state pins exact Structure owner/fingerprint, data-contract
fingerprint, and projection fingerprint; any pin change resets all temporary
values. Collection absence remains distinct from included-empty and selected
image files stay in browser memory outside pure Form state.

No Backend contract or implementation changes in E.5.4. Current document
records still expose Preview unavailable, no route serves a projection, and no
request accepts Form values, creates canonical snapshots, or starts generation.
The development-only Form fixture is not Backend or canonical evidence.

## E.5.5 Temporary JSON And Mapping Handoff

Editor now owns memory-only UTF-8 JSON text and one exact mapping-profile id,
version, and fingerprint beside Form state. It accepts a profile only from a
supplied catalog when owner and target pins match the active Published Structure
projection. Local checks cover presence, the existing 1 MiB adapted JSON limit,
syntax, profile availability, and exact owner/target compatibility.

These checks produce generated content-free codes, paths, messages, counts, and
byte length. A passing result is only `ready-for-admission`; mapping, canonical
snapshot creation, runtime validation, materialization, and artifact execution
remain `not-run`.

No Backend contract or implementation changes in E.5.5. The Editor does not
call `POST /docgen-local/admissions`, no profile-discovery route is added, and
no current document record becomes DocGen-eligible. E.3 remains the authority
that fingerprints admitted text, resolves an allowlisted mapper by id/version,
verifies full profile/execution identity, and returns redacted diagnostics.

## E.5.6 Published Preview Handoff

Backend now exposes one optional authenticated and authorized value-free
`GET /docgen-local/published-preview-context` lookup by exact authoring document
and revision. It returns the trusted E.5.3 projection, exact canonical mapping
profiles, asset admission template, and 1 MiB payload limit. It returns no raw
payload, business values, or executable mapper.

Editor submits imported JSON through the existing E.3 admission. Backend runs
the allowlisted mapper and validator, retains the protected canonical record,
and returns the existing content-free receipt. Editor then submits the receipt's
revision-zero instance pin through E.4 and observes the existing operation,
status, and exact artifact lifecycle.

The strict Editor parser validates the complete receipt and sanitizes it to the
public mapped-result facts. Unexpected fields are rejected. Form data JSON
remains a local `draft-not-validated` representation and does not enter E.3.

The retained 69C evidence maps 749,929 UTF-8 bytes with 0 errors and 3 warnings,
then completes a verified 10-page, 1,417,544-byte PDF. The full 200-page export
is not tested and remains REALDOC-G. See
`docs/PDF_EXPORT_REALDOC_PUBLISHED_PREVIEW.md`.

## Existing Local Lane

LOCAL-A through LOCAL-G remains a canonical evidence lane. Its current request
body contains only `documentId` and `documentRevision`, and its composition
retains `canonicalEvidenceOnly: true`. REALDOC-E.3 does not widen that handler,
change its eligibility vocabulary, or substitute the 69C source for an Editor
working-set document. The DocGen handler is a separate optional endpoint.

Reusable accepted pieces include authentication/authorization boundaries,
idempotent operation lifecycle, due-work discovery, cooperative cancellation,
PostgreSQL metadata, S3-compatible content-addressed bytes, redacted status,
terminal replay, corruption checks, and verified download. REALDOC-E must add
the DocGen admission/resolution owner before reusing those pieces.

## Phase Order

- E.1 accepts the published-Structure generation input and mapping identity
  contract in Core without Backend runtime activation.
- E.2 accepts pure Core mapping/validation and direct/adapted canonical parity
  without Backend route activation.
- E.3 adds bounded local DocGen admission and exact identity pins. Accepted.
- E.4 binds accepted REALDOC resolution to the existing worker/artifact lane.
  Accepted.
- E.5.0 locks the Library/workspace/generated-Form/Preview contract. Accepted.
- E.5.1 adds the bounded local Library query, route, and Editor view. Accepted.
- E.5.2 adds the shared workspace header and Design/Preview URL state. Accepted.
- E.5.3 adds the pure Core test-input projection. Accepted.
- E.5.4 adds temporary generated Form state. Accepted without Backend changes.
- E.5.5 adds temporary JSON/mapping preparation. Accepted without Backend
  changes.
- E.5.6 adds Published Preview over E.3/E.4. Accepted for local development.
- E.5.7 adds separate immutable Draft Preview identity and admission. Accepted
  for local development.
- E.5.8 adds lifecycle recovery, diagnostic navigation, and bounded large-input
  UX. Accepted for local development.
- E.5.9 adds Form/API canonical-content parity while preserving distinct
  instance identities. Accepted for local development.
- E.6.1 adds optional SQLite protected admission with independent-process
  replay, transaction fault recovery, and corruption rejection. Accepted for
  local development.
- E.6.2 accepts durable operation/lifecycle/artifact restart, after-render
  recovery, terminal replay, and verified 10-page 69C download. Accepted for
  local development.
- E.6.3 accepts Editor reconnect, failure, cancellation, and retry end to end.

## Explicitly Not Changed

- no default application-server route or automatic worker-listener change;
- no existing PDF request parser, eligibility lane, resolver, renderer, worker,
  durable repository, provider, or environment change;
- no 69C mapping-profile/asset registry is mounted by default;
- no 69C source bytes or user path copied into Backend;
- no production identity, tenancy, provider, deployment, or activation; and
- no claim that arbitrary generic repeat/conditional book composition is
  already implemented.

## PASS

- Direct and adapted callers reach protected canonical records through the
  same Core runtime.
- Backend owns exact Structure, mapper, instance, idempotency, and asset-byte
  admission.
- Strict public receipts contain no raw payload or canonical business values.
- Existing PDF routes and local command composition remain unchanged.
- One admitted 69C protected record completes the existing local artifact
  lifecycle and verified download without fixture substitution.
- Published Preview uses that same E.3/E.4 path and returns no mapped business
  values to Editor.
- Draft Preview validates a trusted immutable local snapshot through its own
  admission before internal reuse of shared generation validation and artifact
  lifecycle. It returns no mapped values and denies Published/API parity.
- Generated Form and adapted API admission converge on one canonical content
  fingerprint while retaining separate canonical-input and artifact identities.

## RISK

- Reusing the current document-pin request shape for DocGen would hide the
  Published Structure, mapping, payload, and Data Snapshot identities.
- The protected admission repository is now optionally durable and passes
  fresh-process replay. Operation/lifecycle/artifact reconstruction still
  remains E.6.2 evidence.
- Running source mapping in the browser would still create a second resolver
  and make external API behavior diverge from pre-test.
- Rendered REALDOC-D/E.4 continuation pages retain a renderer-pilot defect that
  can hide the header and the leading `Pa` of the footer label; fix this as a
  renderer correctness task without changing DocGen identity semantics.
- The accepted Render API and variable/data mini-lanes in Core include
  metadata-only evidence that must not be mistaken for runtime validation.

## UNKNOWN

- Durable published-Structure and protected canonical repositories.
- Mapping DSL versus additional named adapters beyond the trusted boundary.
- Temporary versus retained generation-instance lifecycle after E.4.
- Asset upload/reference protocol beyond local trusted bytes.

## Next Phase

`PDF-EXPORT-REALDOC-E.6.2` now accepts the optional complete durable local
repository bundle and exact 69C recovery after an injected post-render fault.
`E.6.3` next owns durable runtime wiring and Editor reconnect/cancel/retry UX.
The default and production schedulers remain unchanged. Production remains
NO-GO.
