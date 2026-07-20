# PDF Export REALDOC Draft Preview

Status: `PDF-EXPORT-REALDOC-E.5.7` accepted for the optional local Backend
runtime. Production remains NO-GO.

## Draft Context

The optional authenticated and authorized
`GET /docgen-local/draft-preview-context` resolves one exact authoring document
and revision to a trusted immutable Draft snapshot. The value-free context
contains the Core projection, exact mapping profiles, trusted asset template,
payload limit, and content-free execution facts.

It returns no raw payload, mapped business values, or executable mapper. The
snapshot declares that it is local-only, not a Published Structure Version,
and not Published/API-parity evidence.

## Separate Draft Admission

`POST /docgen-local/draft-preview-admissions` accepts the exact snapshot id and
fingerprint plus adapted JSON and an exact mapping-profile identity. The caller
does not provide a Published Structure identity.

Backend authorizes the authoring document, resolves the trusted snapshot,
checks the exact profile, and derives an internal idempotency identity. Only
then does the compatibility bridge call the accepted E.3 mapping/validation
service and E.4 artifact lifecycle. The Draft receipt wraps the content-free
generation receipt and fixes `publishedApiParity: false`.

## Local Runtime

`createFlowDocBackendRealdocE56RuntimeV1` can mount Published and Draft contexts
for the same authoring pin only when explicit local options are supplied. The
default application server and normal local composition still do not mount
either DocGen Preview route.

The registry is in-memory and trusted. It binds the accepted 69C draft snapshot
to the existing source-neutral projection and generation bundle. E.5.7 does
not add an automatic compiler from arbitrary live Editor draft packages.

## Retained Evidence

`src/tests/fixtures/pdf-export-realdoc-e57-evidence.v1.json` retains:

- snapshot fingerprint
  `sha256:563a023d6c25c04df1d55ccd7a3e2d0f905656c4bd50b8f29172553f44ef4a4f`;
- source package fingerprint
  `sha256:46fac437de79e9b5b044345ca97433535245bf53b1764d5df4b01e25279096eb`;
- adapted mapping `executed` and runtime validation `run-valid`;
- 0 errors and 3 warnings;
- verified 10-page, 1,417,544-byte PDF with SHA-256
  `1d5af8341ec7a7faf10b0af5d86b217405cdd458df1331277da2115cc95fe372`;
- no returned mapped values or retained raw payload; and
- separate Draft admission, no caller-supplied Published identity, and no
  Published/API parity.

## Explicitly Not Changed

- no widening of `POST /docgen-local/admissions` or Published Preview;
- no arbitrary live Editor draft compiler;
- no durable Draft snapshot or protected generation repository;
- no Form admission or mapped-value response;
- no claim of byte identity with the Published artifact;
- no complete 200-page export, which remains `PDF-EXPORT-REALDOC-G`;
- no default route mount; and
- no production identity, provider, tenancy, deployment, or activation.

## Risks

The compatibility bridge currently uses a trusted Published-shaped generation
bundle after Draft validation. This is internal reuse only. Future generic
draft compilation must preserve the separate Draft identity and cannot let the
caller select or impersonate a Published Structure Version.

The Draft registry and protected canonical generation record remain
process-local. Durable reconstruction and retention policy are still open.

The pre-existing 240-page SQLite scheduler scale gate remains above its
90-second target on this workstation: isolated reruns measured 93.37 and
103.19 seconds while preserving the expected structural counts and bounds.
E.5.7 does not widen that threshold or change the scheduler; performance work
remains separately owned.

## Next Phase

`PDF-EXPORT-REALDOC-E.5.8` now accepts complete loading, failure, cancel, retry,
diagnostic navigation, bounded large-input interaction, and download lifecycle
UX. E.5.9 next owns Form/API parity evidence. Production remains NO-GO.
