# PDF Export REALDOC DocGen Backend Handoff

Status: `PDF-EXPORT-REALDOC-E.0` Backend ownership lock with
`PDF-EXPORT-REALDOC-E.1` generation-input and `PDF-EXPORT-REALDOC-E.2` Core
mapping/validation runtime accepted. No Backend route or runtime change;
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

Backend E.3 must add a bounded local admission owner around this runtime. It
must retrieve the exact Published Structure/data contract, allocate or load the
generation instance, enforce request size and payload retention policy, select
an allowlisted mapper by exact execution identity, and admit asset bytes before
calling Core. The browser or caller cannot provide executable mapper code.

E.2 adds no Backend parser, route, mapper registry, authorization decision,
repository, worker, storage object, provider, or lifecycle event. The current
document-pin local lane remains unchanged.

## Existing Local Lane

LOCAL-A through LOCAL-G remains a canonical evidence lane. Its current request
body contains only `documentId` and `documentRevision`, and its composition
retains `canonicalEvidenceOnly: true`. REALDOC-E.0 does not widen that handler,
change its eligibility vocabulary, mount a product route, or substitute the
69C source for an Editor working-set document.

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
- E.3 adds bounded local DocGen admission and exact identity pins.
- E.4 binds accepted REALDOC resolution to the existing worker/artifact lane.
- E.5 exposes the same contract to Editor pre-test.
- E.6 accepts restart, fault, cancellation, and identity evidence end to end.

## Explicitly Not Changed

- no local or default route change;
- no request parser, eligibility lane, resolver, renderer, worker, repository,
  provider, or environment change;
- no 69C source bytes or user path copied into Backend;
- no production identity, tenancy, provider, deployment, or activation; and
- no claim that arbitrary generic repeat/conditional book composition is
  already implemented.

## RISK

- Reusing the current document-pin request shape for DocGen would hide the
  Published Structure, mapping, payload, and Data Snapshot identities.
- Running source mapping in the browser would create a second resolver and
  make external API behavior diverge from pre-test.
- The accepted Render API and variable/data mini-lanes in Core include
  metadata-only evidence that must not be mistaken for runtime validation.

## UNKNOWN

- Final local published-Structure repository and lookup surface.
- Mapping DSL versus named adapter registry.
- Temporary versus retained generation-instance lifecycle.
- Asset upload/reference protocol for external callers.

## Next Phase

`PDF-EXPORT-REALDOC-E.3` bounded local Backend DocGen admission with exact
Structure, data-contract, instance, payload/snapshot, mapper, and asset pins.
Production remains NO-GO.
