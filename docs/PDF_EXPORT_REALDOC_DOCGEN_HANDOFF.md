# PDF Export REALDOC DocGen Backend Handoff

Status: `PDF-EXPORT-REALDOC-E.0` Backend ownership lock. No runtime change;
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

- E.1 defines the published-Structure generation input and mapping contract.
- E.2 accepts runtime mapping and direct/adapted input parity.
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

`PDF-EXPORT-REALDOC-E.1` Published Structure generation input and mapping
contract. Production remains NO-GO.
