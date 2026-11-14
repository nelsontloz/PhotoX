# E2E → integration migration plan

Companion to `docs/e2e-test-review.md`. Scope: every assertion that must exist one layer down **before** its
E2E scenario can be deleted. Doc-only change; no test or source edits here.

## Rules

1. **Migration lands first, deletion second.** A scenario may be deleted only in a commit where its replacement
   is already green on `master`.
2. **One owner per assertion.** New tests go where the behavior already lives: core HTTP → `apps/core/test/
integration`; page rendering → `apps/web/src/**/*.spec.tsx`; queue consumption → worker integration.
3. **No new harnesses.** `createApiTestApp` (`helpers.ts:104`), `seedUser/seedFile/seedAsset/seedThumbnail`,
   `adminAuthHarness`/`reprocessMatrix` (`helpers/reprocess-matrix.ts`) and the web `vi.mock('../../api/...')`
   pattern cover everything below.
4. **Deterministic ordering only.** Every list assertion sets explicit timestamps (`uploadedAt`/`takenAt`/
   `createdAt`/`addedAt`); the ORDER BY tuples tie-break on `id` (`assets.service.ts:257`, `albums.service.ts:63`),
   so same-millisecond inserts are not assertable.

## Corrections to the review (verified while planning)

| Review item                                                  | Correction                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| albums-api: "foreign asset add 404" gap                      | **Already covered** — `jwt-albums.spec.ts:142` adds a real foreign asset and asserts 404 + count 1. Drop this migration item.                                                                                                                                                              |
| semantic-upload: "reprocess queue drain" needs a worker test | **Not needed.** `reprocessMatrix` already asserts `removeOnComplete`, jobId and payload, and `admin-face-reprocess.spec.ts:56` asserts the status counters; the processors themselves are unit-tested. Delete the E2E drain steps; keep one reprocess scenario for the cross-service path. |
| "`pages/admin/ai.tsx` has no spec"                           | **Partly wrong.** `FacialDetectionCard` (`ai.tsx:167`) is covered by `pages/admin/face-detection.spec.tsx`. Only `EmbeddingsReprocessSection` and `DetectionsReprocessSection` (`ai.tsx:496,500`) lack specs.                                                                              |
| albums-api: "sequential adds mint increasing `addedAt`"      | **Not assertable** (same-ms ties fall back to `assetId DESC`). `album-assets-list.spec.ts:127` already proves the ordering with injected times — delete the E2E assertion instead.                                                                                                         |

## Work graph

```
A favorites ─────────────┐
B backup/restore HTTP ───┤
C anonymous matrix ──────┼──> G E2E deletions (last)
D album/share contracts ─┤
E share stream ──────────┘
F web specs ─────────────────> (backs the UI-only deletions, can run alongside A–E)
```

A–F are independent write scopes and can run in parallel; G runs after A–E are green (F only gates the
UI-assertion backfills listed in its row).

## Lane A — favorites list contract (new spec, 6 tests, S/M)

`apps/core/test/integration/favorites.spec.ts` — today `GET /api/v1/assets?favorite=true` has **no** direct
coverage (only `assets-layout.spec.ts:177` layout and `assets-date-range.spec.ts:106` composition).

| Test                                                     | Asserts                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `lists only my favorited, non-trashed assets`            | `items` + exact `total` for `favorite=true`                                               |
| `keeps favorites isolated between users`                 | A's page never contains B's favorite and vice versa                                       |
| `paginates favorites without overlap`                    | `limit=1&offset=0` + `offset=1`, disjoint, `total=2` (explicit `uploadedAt`)              |
| `PATCH favorite:false removes the asset from the filter` | PATCH → `favorite=true` empty, `total=0`                                                  |
| `trashing a favorite removes it from the filter`         | trash → `favorite=true` empty (mirrors `trash-lifecycle` semantics)                       |
| `rejects a non-boolean favorite query value`             | `favorite=yes` → 400 `VALIDATION_FAILED` (DTO transform at `list-assets-query.dto.ts:90`) |

Unblocks: `07-favorites` API scenarios (5) and its empty state.
Command: `pnpm --filter @photox/core test test/integration/favorites.spec.ts`

## Lane B — backup/restore HTTP surface (new spec, ~6 tests, M)

`apps/core/test/integration/admin-backup-http.spec.ts`. Every backup spec today calls `t.svc.*` or overrides a
service; `api-path-policy-bypass.spec.ts:123` enumerates admin routes but **omits** backups/restores.

| Test                                                            | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rejects anonymous and non-admin callers on every backup route` | `adminAuthHarness` over the 8 routes from `backup-gating.feature` (401/403), no S3 needed                                                                                                                                                                                                                                                                                                                                                            |
| `404s an unknown target on every backup route`                  | POST backups/restores, GET status/progress, DELETE → 404 before any S3 call                                                                                                                                                                                                                                                                                                                                                                          |
| `400s a delete without emailOrId`                               | DTO validation on `DELETE /admin/backups`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `404s an unknown run id`                                        | `GET /admin/backups/runs/:uuid`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `starts a backup over HTTP and reports the queued run`          | 202 `{runId}` → `GET runs/:id` state `queued`/`running` + counters; `overrides: [{token: S3BackupService, value: { ensureBucket: vi.fn() }}]` (startBackup touches S3 only via `ensureBucket`, `run-lifecycle.service.ts:105`). Safe because both the transfer consumers and the dispatcher no-op under `NODE_ENV=test` (`backup-transfer.consumers.ts:25`, `backup-transfers.dispatcher.ts:39`), so the run stays queued instead of racing the test |
| `409s a second backup while one is active`                      | the `UQ_backup_runs_active_user` contract over HTTP                                                                                                                                                                                                                                                                                                                                                                                                  |

Do **not** assert object bytes or manifest content here — the harness has no S3 (postgres + redis only).
Unblocks: `12-backups/backup-gating` (2 entries / 16 rows), `12-backups/backups` API scenarios (2),
`backup-orphans` API rows.

## Lane C — anonymous matrix + unknown share token (1 file, S)

Extend `apps/core/test/integration/api-error-contract.spec.ts` (it already owns the 401/403 envelope at lines
37–49):

| Test                                                        | Asserts                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rejects anonymous access to every guarded resource family` | GET/POST `/api/v1/albums`, GET `/api/v1/shares`, DELETE `/api/v1/shares/:id`, GET `/api/v1/persons`, GET `/api/v1/admin/users` → 401 `UNAUTHENTICATED` |
| `404s a share token that never existed`                     | `GET /api/share/<random>` (today only the revoked-token 404 exists, `jwt-shares.spec.ts:236`)                                                          |

Unblocks: all of `02-auth/gating` (5 entries / 18 rows — page redirects are already owned by
`apps/web/src/App.spec.tsx:74`).

## Lane D — album/share contracts (3 files, 9 tests, M)

| File                    | Test                                          | Asserts                                                                               |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `jwt-albums.spec.ts`    | trashed asset add                             | `POST /albums/:id/assets` with a trashed asset → 404, count 0 (`ownedActiveIds`)      |
|                         | duplicate add                                 | second add → 201, `albumAssetRepo.count` = 1 (`.orIgnore()`, `albums.service.ts:144`) |
|                         | album list order                              | 3 albums with explicit `createdAt` (repo update), `limit=2&offset=0                   | 2` newest-first |
|                         | hidden flag round trip                        | PATCH `hiddenFromTimeline` → `GET /albums/:id` returns `true`                         |
| `assets-layout.spec.ts` | hiding an empty album is a no-op              | month versions byte-identical before/after                                            |
|                         | deleting a hidden album restores the timeline | album DELETE → asset back in the index/list                                           |
| `jwt-shares.spec.ts`    | share list omits the token                    | every row lacks `token` (leak guard on `toAssetDto`/`toAlbumDto`)                     |
|                         | revoked share absent from the list            | revoke → list no longer contains the id                                               |
|                         | mixed trashed list                            | trashed asset's share hidden, album share kept                                        |

Not migrated (per the corrections): foreign-asset 404, sequential `addedAt` minting.
Unblocks: `06-albums/albums-api` (7), `06-albums/albums-hidden` (8), `09-sharing/own-shares` API scenarios (5 of 6).

## Lane E — share stream edges (2 tests, S)

`apps/core/test/integration/streaming.spec.ts`:

| Test                            | Asserts                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| share-route unsatisfiable range | `GET /api/share/:token/stream` with `Range: bytes=99999999-` → 416 + `bytes */<size>`                                |
| shared transcode with a range   | extend the `album-shares.spec.ts:489` fixture with `Range: bytes=0-99` → 206, transcode content-type, transcode etag |

Unblocks: `09-sharing/public-share` stream scenarios (membership, range, transcoded derivative).

## Lane F — web specs for the UI holes (5 files, M/L)

These do not block an API deletion, but each one currently exists **only** as an E2E assertion:

| File                                           | Test                                                                                                                              | Unblocks                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `pages/admin/index.spec.tsx` (new)             | a `user` visiting `/admin` redirects to `/` (`pages/admin/index.tsx:221`; `App.spec.tsx` mocks the page, so it cannot cover this) | seeded-admin scenario 2 tail             |
| `components/Sidebar.spec.tsx`                  | admin link hidden for `role: 'user'`, shown for `admin` (`Sidebar.tsx:71`)                                                        | seeded-admin scenarios 1–2               |
| `pages/people/index.spec.tsx` (new)            | empty state; card renders `Unknown` + face count                                                                                  | people list assertion                    |
| `pages/people/[id].spec.tsx`                   | `Today` day header; no face-box overlay on the person grid                                                                        | people detail scenario                   |
| `pages/admin/face-detection.spec.tsx` (extend) | `EmbeddingsReprocessSection` + `DetectionsReprocessSection` last-run card and drained state (`ai.tsx:496,500`)                    | semantic-upload admin reprocess scenario |
| `pages/search/index.spec.tsx` (new)            | ready / empty / not-ready tri-state                                                                                               | search-ready tri-state scenario          |

## Lane G — E2E deletions (last, one commit per group)

1. **Delete whole features** (after A–C, D): `06-albums/albums-api`, `06-albums/albums-hidden`,
   `12-backups/backup-gating`, `02-auth/gating`, `00-serial/registration-toggle` — with their step files and any
   step definitions that become unreferenced.
2. **Trim API scenarios** (after A–E): favorites (5), people (5), own-shares (5), public-share (3), backups (2),
   backups-orphans (2 of 3), admin-delete (6 of 8), admin-edit (2), admin-create (1), semantic-upload (2),
   upload-sessions (1), album duplicate journeys (4 of 5).
3. **Step-level trims** (review §5): hidden-album count/version steps, video transcode-file step, orphan
   hidden-album step, upload-session cross-user/replay steps.
4. **Config**: `e2e/playwright.config.ts` — `setup` keeps only `04-faces`; drop the `00-serial` and
   `05-semantic/semantic-upload` entries and update the comment above `setup`.
5. **Docs**: the `setup`-project paragraph in `README.md:75` and the e2e bullet in `AGENTS.md` (serial prologue
   description) must match the new project split.

Unreferenced step definitions do not fail `bddgen`, so pruning is hygiene; grep each deleted step text first.

## Sequence

| Phase | Work                                      | Gate                                                |
| ----- | ----------------------------------------- | --------------------------------------------------- |
| 0     | A, B, C, D, E, F in parallel              | each lane's own spec is green; `pnpm lint` clean    |
| 1     | G1: features whose replacements are green | `pnpm --filter @photox/e2e typecheck` + `pnpm lint` |
| 2     | G2/G3: scenario + step trims              | same                                                |
| 3     | G4/G5: project split + docs               | full `E2E_BUILD=1 pnpm verify --workers=4`          |

## Verification

- Per lane: `pnpm --filter @photox/core test test/integration/<file>` (vitest path filter),
  `pnpm --filter @photox/web test src/pages/<page>`; worker: `pnpm --filter @photox/worker-service test`.
- Phase 3: `pnpm verify --workers=4` — it ends in the full E2E run (`package.json` `verify`).
- Record before/after from `e2e/playwright-report`: executed tests (153 today) and wall-clock.
- `apps/core/test/integration/schema-parity.spec.ts` and `column-types.spec.ts` must stay untouched and green
  (no entity or migration changes in this work).

## Risks

- **No S3 in the core harness.** Lane B stubs `S3BackupService`; backup/restore byte survival and "victim backup
  kept after a wipe" stay E2E by design (review §7.10). Do not let a stubbed 202 be read as byte coverage.
- **Deleting `backup-gating` before Lane B** removes the only authz check on the backup surface.
- **Deleting favorites before Lane A** removes the only `favorite=true` list coverage.
- **Ordering ties**: any test written against wall-clock `createdAt`/`addedAt` will flake; set the columns.
- **`00-serial` retirement** assumes `admin-user-create.spec.ts:195` (real flag over HTTP) and
  `login/index.spec.tsx:40` / `register/index.spec.tsx:38` stay green; the switch read-back after a reload should
  move into `users.spec.tsx` when that feature goes.
- **Lane F is UI-mock coverage**, not browser coverage: it replaces assertions about _rendered state_, not the
  cookie/media paths, which no web spec can prove.

## Execution record

Implemented on `docs/e2e-migration-plan`; the scenario cut went from **126 to 71** entries (153 → 71
executed tests, since the two surviving outlines were the deleted gating matrices).

| Lane | Landed as                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | `apps/core/test/integration/favorites.spec.ts` (6 tests)                                                                                                                                                                                          |
| B    | `apps/core/test/integration/admin-backup-http.spec.ts` (6 tests)                                                                                                                                                                                  |
| C    | `api-error-contract.spec.ts` (+2 tests)                                                                                                                                                                                                           |
| D    | `jwt-albums.spec.ts` (+4), `assets-layout.spec.ts` (+2), `jwt-shares.spec.ts` (+3)                                                                                                                                                                |
| E    | `streaming.spec.ts` (+1), `album-shares.spec.ts` (+1)                                                                                                                                                                                             |
| F    | 3 new web specs + 3 extended (`admin/index`, `Sidebar`, `people/index`, `people/[id]`, `face-detection`, `search/index`)                                                                                                                          |
| G    | `albums-api`, `albums-hidden`, `02-auth/gating`, `backup-gating`, `00-serial/registration-toggle` deleted; 27 API/duplicate scenarios trimmed from the mixed features; 88 unreferenced step definitions pruned; `setup` now holds `04-faces` only |

Three plan assumptions did not match the code and were pinned as-is instead of forced:

1. `favorite=yes` answers **200** (the DTO coerces via `isQueryTrue` before `@IsBoolean`), not 400.
2. `GET /admin/backups/status?emailOrId=<unknown>` answers **200 `{exists:false}`**; `progress` and `DELETE` 404.
3. `startBackup` reaches S3 through `ensureBucket` **and** `listKeys`/`getBuffer`, so Lane B stubs all three.

### Exception: S3-real assertions stay in E2E

Per explicit direction, assertions about **real S3 objects** were not migrated: `12-backups/backups` (4
scenarios), `12-backups/backup-orphans` (5), the wipe's "victim backup kept / sibling backup untouched"
scenario, and the shared-transcode object assertions. The core harness has Postgres + Redis only, so Lane B
proves the HTTP contract with a stubbed S3 and never claims byte coverage.
