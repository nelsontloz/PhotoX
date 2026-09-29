# scripts/

## Responsibility

Workspace-level maintenance scripts run manually (or from CI/ops), not imported by any app. Currently one script, `migrate-storage-layout.ts`: a one-off backfill that moves legacy flat storage files into the current `originals/` + `derivatives/` layout and updates `files.storageKey` to match. `tsconfig.json` makes the folder a typed workspace member.

## Design

`migrate-storage-layout.ts`:

- **Invocation:** `pnpm exec tsx scripts/migrate-storage-layout.ts [--apply] [--batch=N]`. Dry-run by default (prints `would move ...`); `--apply` performs moves + DB updates; `--batch` defaults to 500 rows.
- **Enumeration:** pages `SELECT id, "userId", "storageKey", purpose FROM files ORDER BY id ASC LIMIT/OFFSET`, batch by batch, until an empty page.
- **Key mapping (`mapKey`):** rows already prefixed with `originals/`, `derivatives/`, or `models/` are skipped (`null`). Otherwise basename is taken from the old key and rebuilt as: `derivatives/transcodes/<userId>/<base>` for `purpose === 'transcode'` or `.webm`; `derivatives/thumbnails/<userId>/<base>` for `.webp`; everything else `originals/<userId>/<base>`. This mirrors `LocalStorageService.buildKey`.
- **Safety:** missing source file → counted `missing`, DB untouched (never points at a nonexistent file). Existing destination → skipped. Move is `rename` with an `EXDEV` copy+unlink fallback (`moveFile`), same atomicity strategy as `LocalStorageService`. The DB `UPDATE files SET "storageKey"` runs only after a successful file move. Summary line: `apply|dry-run: moved=… skipped=… missing=…`.
- **DB access:** builds its own TypeORM `DataSource` from `loadEnv()` with `synchronize: false` — the script must not touch schema; connection intentionally mirrors `SharedDatabaseModule.forRoot()`.
- **Dependency trick:** `scripts/` is not a workspace package, so it imports `loadEnv` via relative path `../packages/shared-config/src/env.js` and obtains `typeorm` with `createRequire` rooted at `packages/data-access/package.json` — no duplicated deps, uses the installed copy.
- Marked `ponytail: one-off … remove once every env has migrated`.

`tsconfig.json`: extends `../tsconfig.base.json`, disables declarations, adds `typeRoots` for both `packages/data-access/node_modules/@types` and root `@types`, includes `*.ts` only.

## Flow

1. Operator takes/verifies a backup, ensures services are stopped or writes quiesced, and runs the script dry-run (no args).
2. Review the printed mapping and the `missing` count; resolve or accept missing sources (their DB rows stay legacy/untouched).
3. Re-run with `--apply` (optionally `--batch=N`) to move files and update rows in the same pass.
4. On completion, the DB and disk agree on the prefixed layout; the script can be deleted once all environments have run it.

## Integration

- Reads the same `POSTGRES_*`/`STORAGE_DIR` env as core/worker through `loadEnv()` (`packages/shared-config`), so it works against local `./data/storage` or `/data/storage` with matching env.
- Writes the `files` table owned by `packages/data-access` entities and the storage tree owned by `LocalStorageService`; keep `mapKey` in sync with `LocalStorageService.buildKey` if layouts ever change.
- Only this folder holds one-off maintenance; app code must not import it.
