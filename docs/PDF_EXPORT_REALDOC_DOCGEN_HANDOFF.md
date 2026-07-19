# PDF Export REALDOC DocGen Backend Handoff

Status: `PDF-EXPORT-REALDOC-E.3` bounded local Backend DocGen admission
accepted after the E.0 ownership lock, E.1 generation input, and E.2 Core
mapping/validation runtime. Materialization, artifact execution, default route
activation, and production remain inactive and NO-GO.

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
- E.5 exposes the same contract to Editor pre-test.
- E.6 accepts restart, fault, cancellation, and identity evidence end to end.

## Explicitly Not Changed

- no default application route, local command, or automatic listener change;
- no existing PDF request parser, eligibility lane, resolver, renderer, worker,
  durable repository, provider, or environment change;
- no 69C mapping-profile/asset registry is mounted yet;
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

## RISK

- Reusing the current document-pin request shape for DocGen would hide the
  Published Structure, mapping, payload, and Data Snapshot identities.
- The protected repository is process-local; restart durability begins only
  when E.4 binds admission to the existing artifact lifecycle.
- Running source mapping in the browser would still create a second resolver
  and make external API behavior diverge from pre-test.
- The accepted Render API and variable/data mini-lanes in Core include
  metadata-only evidence that must not be mistaken for runtime validation.

## UNKNOWN

- Durable published-Structure and protected canonical repositories.
- Mapping DSL versus additional named adapters beyond the trusted boundary.
- Temporary versus retained generation-instance lifecycle after E.4.
- Asset upload/reference protocol beyond local trusted bytes.

## Next Phase

`PDF-EXPORT-REALDOC-E.4` binds one admitted 69C generation record to
materialization, resolution, and the existing local worker/artifact lifecycle
without fixture substitution. Production remains NO-GO.
