# Backups module — compatibility contract

What the refactor of `apps/core/src/backup/` may not change. These are the surfaces that existing
S3 snapshots, in-flight runs and admin clients depend on; a diff that touches one of them is a
behaviour change, not a move.

## HTTP (all admin-scoped, `apps/core/src/backup/backup.controller.ts`)

| Method | Path                               | Returns               |
| ------ | ---------------------------------- | --------------------- |
| POST   | `api/v1/admin/backups`             | `{ runId }` (202)     |
| POST   | `api/v1/admin/restores`            | `{ runId }` (202)     |
| POST   | `api/v1/admin/restores/merge`      | `MergeBackupResult`   |
| GET    | `api/v1/admin/backups/overview`    | `BackupOverviewRow[]` |
| GET    | `api/v1/admin/backups/status`      | `BackupStatus`        |
| GET    | `api/v1/admin/backups/progress`    | `BackupProgress`      |
| GET    | `api/v1/admin/backups/runs/:runId` | `BackupRunStatus`     |
| DELETE | `api/v1/admin/backups`             | `DeleteBackupResult`  |

Wire types live next to the services in `shared-types` (`AdminUserBackupSync`) or are re-exported
through `backup.types.ts` and `swagger/response-models.ts`.

## S3 layout

- Prefix: `backups/<normalizedEmail>__<userId>/` (`backupPrefix`, `resolveBackupPrefix`,
  `findPrefixesForUserId` in `shared-config` — the only code allowed to build these keys).
- Originals: `originalKey(...)`; manifest: `manifestKey(prefix)` → `<prefix>/manifest.json`.
- `manifest.json` is **written last**; a failed run never publishes one over missing bytes.
- Adoption (merge) moves a source snapshot into the live prefix and deletes the source objects;
  `backup_merges.prefix` keeps the source prefix for audit.

## Manifest

`manifestVersion: 1`, zod-validated, one section per table: `user`, `files`, `assets`, `albums`,
`albumAssets`, `shares`, `persons`. Unknown/invalid ⇒ `{ error: 'missing' | 'unreadable' | 'corrupt' }`.
`hiddenFromTimeline` defaults to `false` so pre-fix backups stay restorable. `transcodeFileId`,
`phash` and `coverFaceId` are absent by construction (regenerated after restore).

## Ledger (source of truth; the queues are only the executor)

- `backup_runs.state`: `running | paused | finalizing | completed | failed | cancelled`.
  Partial unique index `UQ_backup_runs_active_user` on `running|paused|finalizing` is the real
  "one active run per user" guard — `assertNoActiveRun` alone can race.
- `backup_run_items.state`: `pending | retrying | queued | running | failed | missing`.
  Successful rows are **deleted**; the table only holds outstanding or failed work.
- `backup_merges` is `UNIQUE(backupUserId, targetUserId)`; written only after adoption succeeds.
- A restore that finds bytes permanently missing trashes the asset (`brokenFileIds`) rather than
  failing the run.

## Queues

- `backup-transfer`, `restore-transfer` — core produces **and** consumes both; `worker-service`
  stays out of transfers.
- `jobId = <kind>-<itemId>`; payload is ids only, re-read from the DB before any I/O.
- Concurrency 4 (backup) / 2 (restore); 5 attempts, exponential 1 s; a `queued` row older than
  5 min lost its job and is re-enqueued.
- Advisory locks: `728461004` (backup dispatch), `728461005` (restore dispatch) — one per kind so a
  slow backup never stalls restore. Dispatcher tick ~1 s, batch 4, continues immediately while full.

## Local storage

`STORAGE_DIR/backup-runs/<runId>/` holds the manifest draft, restore downloads and work files.
Owned by the ledger, **not** by the orphan sweep.

## Run lifecycle (one file per phase)

`UserBackupService` composes the run by hand; the phases form a DAG and only point one way:

- `run-lifecycle.service.ts` — start backup/restore (snapshot, ledger insert), wipe/active-run
  guards, resume.
- `transfer-dispatch.service.ts` — claim due items, dispatch to the queues, consume one job per
  file, retries, and the promote-when-drained check.
- `run-finalize.service.ts` — publish the manifest (backup) or trash-broken-and-fan-out (restore),
  terminal row, manifest drafts, status shape.
- `bulk-io.ts` — the chunked insert helpers (`BULK_CHUNK`, `chunked`, `bulkSave`, `bulkInsert`,
  `rowsOf`), imported by merge too.

`lifecycle → finalize` and `dispatch → finalize`; finalize imports neither. Keep it that way — a
two-way call makes the split worse than the original class.

## Transaction boundaries

```
restore:  files → assets → albums/albumAssets → shares → persons  (one transaction)
merge:    adoption (S3 + rows) → backup_merges row                (no partial row)
finalize: upload remaining → prune stale prefixes → manifest.json last
```

`files.assetId` is `DEFERRABLE INITIALLY DEFERRED` because restore/merge insert files before
assets in the same transaction. Do not split these transactions.
