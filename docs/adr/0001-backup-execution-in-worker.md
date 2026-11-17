# Backup and restore execution moves to worker-service

**Status**: accepted (2026-11-17)

Backup and restore transfers ran in `core` — the process that also serves the public API — because they were the only thing that needed both the ledger and the object store. We are moving the byte movement (the two BullMQ consumers `backup-transfer`/`restore-transfer` and their per-item executor) into `worker-service`, so long transfers no longer run inside the API process. `core` keeps everything that requires the database: the `backup_runs`/`backup_run_items` ledger, the advisory-locked dispatcher, the run state machine, failure classification, the manifest content, and the whole admin HTTP surface. The worker consumes the two queues, does the S3 + local-disk I/O per item, and reports through job-bound `POST /worker/backup-transfers/...` claim/finish calls; queue payloads stay ids-only (`{runId, itemId, userId}`), with work data re-read from the database at claim time.

## Considered Options

- **Move the whole feature, worker gets Postgres.** Rejected: it contradicts the worker's load-bearing "no DB access, every read/write through core HTTP" invariant, creates a second schema owner, and would drag the worker's Redis-only integration harness into migrations and Testcontainers Postgres.
- **Evacuate S3 from core entirely, via a worker-hosted object gateway.** Rejected: merge, the email-change prefix move, delete, status and overview are synchronous DB+S3 operations inside one admin request, so a core with no S3 client needs either a core→worker HTTP direction it has never had, queue-based RPC with no fast failure, or 202s that change the frozen admin contract.
- **Queue-based RPC for the synchronous operations.** Rejected: no precedent in the codebase, no fast failure when the worker is down, duplicate-execution ambiguity on destructive operations.

## Consequences

- `core` becomes a producer only: it consumes no queues at all. The worker consumes all ten.
- `core` keeps its S3 client permanently (`merge` and `moveBackupPrefix` cannot leave the request); only `putFile` moves out, since transfers were its only caller.
- Every admin backup operation still works while the worker is down — except the transfers themselves.
- The worker gains `S3_*` credentials and an AWS SDK dependency: a new trust surface for a process that previously only had Redis and `STORAGE_DIR`. A compromised worker (or Redis, which already lets an attacker act as any user over core's HTTP API) can now read and delete every user's backup directly.
- The failure matrix stays in core: a `finish` call carries the raw error, and core decides pause/missing/failed/retry, so the worker cannot invent a run state.
- Per-item latency grows by two HTTP round trips to core, negligible next to an object transfer.
