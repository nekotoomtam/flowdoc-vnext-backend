# PDF Export Durable Artifact Persistence

Status: `PDF-EXPORT-V-E` persistence candidate accepted. Follow-up V-F now
owns terminal workflow completion and privacy-safe event qualification.
Production storage, deployment telemetry, authenticated routes, concrete
renderer promotion, and activation remain blocked.

## Boundary

V-E consumes only a successful V-D `ready-for-persistence` result. It
revalidates the immutable V-B operation, V-D execution fingerprint, Core
receipt/completion fingerprints, byte evidence, and the exact live V-C
`before-persist` lifecycle head before any file write.

V-E performs the required order:

1. publish PDF bytes under a SHA-256 content identity;
2. read the published bytes back and verify length and SHA-256 again;
3. compare-and-swap the rendered Core artifact manifest; and
4. compare-and-swap the rendered Core artifact job.

Metadata never claims `rendered` before readback succeeds.

## Content Store

`src/pdfExport/pdfExportContentAddressedStore.ts` uses storage keys shaped as:

```text
pdf-export-v1.sha256.<lowercase-sha256>.pdf
```

The key does not include an artifact or operation id. Identical bytes therefore
share one content identity. A write first validates supplied length/digest,
writes and syncs a unique pending file, then publishes it with an atomic hard
link. Concurrent publishers produce one write owner and idempotent replays.

Every read recomputes SHA-256 from physical bytes. Corrupt content fails closed
and cannot reach manifest/job projection.

## Atomic Projection And Replay

The in-memory and SQLite repositories retain one terminal persistence receipt
per operation. The receipt binds:

- tenant/principal and immutable operation fingerprints;
- V-D render execution plus exact Core receipt/completion;
- verified storage key, byte length, SHA-256, and verification time;
- rendered Core manifest/job records and revision-zero CAS facts; and
- one fingerprint over the complete terminal receipt.

SQLite executes manifest CAS first and job CAS second inside one
`BEGIN IMMEDIATE` transaction, then retains the terminal receipt before commit.
Injected faults after manifest CAS, after job CAS, and before commit roll back
both records. An after-commit fault reopens as exact terminal replay.

Operation, persistence, artifact, and job identities each have one durable
owner. Duplicate exact projection returns the original terminal receipt;
different content or ownership returns a conflict.

## Orphan Recovery

A byte write can succeed before metadata projection fails. The reconciler scans
only content older than an explicit grace period, caps both scanned and deleted
items, checks repository references twice before deletion, and returns no PDF
bytes. Referenced content is retained even when multiple artifacts share its
digest.

The grace period is at least one minute. This is a bounded recovery candidate,
not a deployment retention policy. Provider-specific quarantine, retention,
and multi-process cleanup scheduling remain production work.

The filesystem scan has no durable cursor or resume token. Repeated bounded
scans can revisit the same directory prefix, so the current candidate does not
prove eventual enumeration or deletion of later orphaned content. Local
durability follow-up must add resumable scan evidence or qualify a provider
listing contract before broader cleanup claims are made.

## Evidence

Focused tests prove:

- deterministic write/readback and physical corruption rejection;
- one content owner under concurrent identical writes;
- exact V-D and live V-C binding before persistence;
- no metadata on readback failure;
- atomic Core manifest/job projection and terminal replay;
- operation/persistence identity conflict behavior;
- SQLite restart and independent-handle concurrency;
- rollback at both metadata CAS steps and before commit;
- after-commit recovery as exact replay; and
- bounded orphan deletion while referenced bytes remain.

Primary files:

- `src/pdfExport/pdfExportContentAddressedStore.ts`;
- `src/pdfExport/pdfExportArtifactPersistence.ts`;
- `src/pdfExport/pdfExportArtifactPersistenceSqliteRepository.ts`;
- `src/tests/pdfExportContentAddressedStore.test.ts`;
- `src/tests/pdfExportArtifactPersistence.test.ts`; and
- `src/tests/pdfExportArtifactPersistenceSqlite.test.ts`.

## Remaining Boundary

V-E intentionally does not mutate the V-C lifecycle after metadata commit.
Follow-up V-F now retains a terminal workflow completion over the exact V-E
receipt and V-C lifecycle fingerprint, atomically journals a closed
privacy-safe event chain, and proves restart/fault recovery across V-B through
V-F. V-E itself still writes no event, route, authorization, download,
deployment, or production activation state.

Follow-up `PDF-EXPORT-V-G` now adds authenticated status/download routing over
the retained receipt and records production activation as NO-GO in
`docs/PDF_EXPORT_AUTHENTICATED_ROUTE_ACTIVATION_REVIEW.md`. Concrete renderer,
production storage/event providers, worker hosting, and deployment remain
carried blockers.
