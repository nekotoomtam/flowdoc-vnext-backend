# Durable Composition Scheduler Scale Readiness

Status: Phase 391 in-memory scheduler scale and contract-readiness gate passed.
Production persistence, queue/worker activation, physical-storage quota,
cleanup execution, routes, and consumers remain blocked.

## Outcome

The complete backend scheduler now initializes, advances, resumes from its
committed head, finalizes, and reports one 240-page mixed-family document using
only public core and backend contracts. The run covers text, columns, table,
generated, utility, and media families and retains exact source, window, page,
receipt, plan, and heading-map evidence.

The phase also turns the pinned retained-byte limit into enforceable committed
state. It does not claim that the in-memory repository is production storage.

## Retention Contract

The bounded job head now carries `retention.recordCount` and
`retention.byteCount`. These counts cover immutable records reachable from the
accepted job: source snapshot, manifest, accepted windows, closed-page chunks,
transition receipts, and completed outputs.

Initialization computes its complete initial retention before writing any
record. Advancement computes the exact window/chunk/receipt delta before
staging, and finalization computes the exact plan/map delta before publishing.
If the next accepted state would exceed `maximumRetainedByteCount`, the job
blocks terminally without advancing core state or exposing partial output.

The repository compare-and-swap boundary independently proves that ordinary
lease/lifecycle commits preserve retention, transition commits add the exact
receipt-reachable records, and finalization adds the exact two outputs. A
caller cannot alter accounting through an unrelated head update.

## Chain Accounting

Finalization rebuilds a unique ref set from the pinned source/manifest and the
complete reachable chunk, receipt, and family-window chains. Record and byte
counts must equal the committed head before core finalization runs. Missing
records, fingerprint drift, cross-links, or accounting drift block output.

Progress exposes only the two bounded retention totals. It does not expose
storage paths or full record arrays.

## Scale Evidence

The representative run uses 240 body items/pages across all six families. It
produces:

- 479 accepted backend transitions and 960 compare-and-swap operations;
- 240 pages, 240 placements, and 40 headings;
- 479 family windows, 240 page chunks, and 479 transition receipts;
- 1 source snapshot, 1 manifest, 1 page plan, and 1 heading-page map;
- 1,202 committed immutable records totaling 3,224,446 JSON bytes;
- a maximum serialized job-head size of 5,364 bytes;
- 719 fingerprint chain reads and 719 direct referenced-record reads; and
- one explicit mid-run resume from the repository head.

On the local verification environment, the final optimized run completed in
about 16.0 seconds and finalization took about 0.77 seconds. These are evidence
values, not production SLAs; the test uses broad 60-second/15-second regression
ceilings.

## Validation Cost Repair

The first measured run required about 274.6 seconds overall and 39.2 seconds
for finalization. The retained data shape was already bounded; repeated parsing
of the same accepted manifest/owner context dominated execution.

Core now provides an explicitly named state-validation path for a manifest
that has already passed the canonical parser. Backend head and transition
records similarly provide validated-context paths used only after repository
context validation. Public untrusted parsers remain strict. Retained cursor,
open-page, chunk, receipt, owner, and fingerprint checks still run; only
duplicate manifest/owner parsing was removed.

The optimized run preserved every record count, byte count, CAS count, page,
placement, heading, and output fingerprint from the slow run.

## Failure And Restart Evidence

- Initial quota overflow writes no source record and creates no head.
- Transition quota overflow stages no window and preserves cursor/retention.
- Final-output quota overflow publishes neither plan nor heading map.
- Non-content CAS retention mutation is rejected.
- Reachable-chain/accounting drift blocks finalization.
- One concurrent transition/finalizer still wins exact CAS.
- A mid-run scheduler-local state discard resumes from the committed head.

The restart case proves orchestration-state reconstruction within one
repository instance. Process restart, serialization reload, and multi-process
transactions require a production adapter.

## Cleanup Ownership

Committed retention and physical storage consumption are intentionally
different facts. Staged records from a lost CAS are unreachable and are not
added to committed retention. A production backend storage adapter must own:

- physical-byte admission headroom for staging and retries;
- a grace period before deleting unreachable content-addressed records;
- reachability checks against current heads and committed request indexes;
- retention/deletion policy for completed and terminal jobs; and
- cleanup idempotency, audit, tenancy, and encryption policy.

No garbage collector is implemented by this phase.

## PASS

- 240-page six-family scheduler execution and finalization pass end to end.
- Job-head size remains independent of document-length evidence arrays.
- Committed retained-byte limits are enforced before accepted writes.
- Repository CAS and final chain loading verify exact accounting.
- Revalidation optimization preserves strict public input boundaries.
- Restart-from-head and adversarial accounting paths are covered.

## FAIL / BLOCKER

- No production transactional repository or object/blob adapter.
- No process-restart, multi-process, queue visibility, or lease-clock test.
- No physical-byte quota or unreachable-record cleanup execution.
- No HTTP route, auth, tenancy, renderer/export, or editor consumer.

## RISK

- Production head/request-index atomicity still depends on adapter choice.
- Linear final chain reads are correct but may need batched storage access.
- Committed quota alone cannot cap temporary orphan/staging bytes.
- Validated-context fast paths must only receive parser-accepted owners.
- Timing evidence is local and synthetic, not measured production content.

## UNKNOWN

- Database/object-store and transaction-isolation choice.
- Batch-read shape, physical staging headroom, and cleanup grace period.
- Multi-worker throughput and contention under real queue delivery.
- Retained byte distribution for measured real 200-300 page documents.

## Files Changed

- core validated-manifest composition-state path and cursor regression test;
- backend job-head retention/progress contracts and ref summarization;
- initialization, advancement, finalization, chain reader, repository, and
  lifecycle validated-context integration;
- quota, accounting, restart, adversarial, and 240-page scale tests; and
- backend/core phase records and README status.

## Behavior Changed

Backend scheduler package consumers receive committed retention totals and
hard retained-byte enforcement. Repeated accepted owner parsing is removed
from internal validated paths. No deployed server or worker behavior changes.

## Tests Run

- focused core cursor/state and 250-page composition scale tests;
- focused backend contract/repository/lifecycle/quota/finalization tests;
- backend 240-page end-to-end scale and resume test;
- full core, backend, and unchanged editor gates; and
- backend build.

## Risks Left

Production storage transactions, process restart, physical quotas, garbage
collection, queue workers, routes, renderer/export, and editor integration.

## Intentionally Not Changed

- core composition ordering, pagination, or finalization semantics;
- existing backend package/artifact/file storage and HTTP routes;
- editor source, selection, viewport, WYSIWYG, and progress UI;
- renderer, PDF, DOCX, or artifact bytes; and
- auth, tenancy, database, queue, or deployment technology.

## Next Recommended Direction

Phase 392 should define the production durable repository conformance gate:
atomic head plus request-index transactions, immutable/fingerprint indexes,
batch chain reads, process-restart recovery, physical quota admission, and
unreachable-record cleanup. Select concrete storage only after that adapter
contract and failure matrix are locked.
