# E2E suite review — happy-path wiring vs. edge cases

Baseline: `origin/master` @ `0329325` (branch `docs/e2e-test-review`). No test or production code changed.

Premise: E2E exists to prove the **wiring between services** (web → core → worker → storage → S3) on the real
browser; edge cases, contracts, ordering, ownership and invariants belong to integration/unit tests, which are
faster, deterministic and already far more thorough here (52 core integration specs, 9 worker integration
suites, 53 web specs). Any assertion that can be made with `request.get('/api/v1/...')` in E2E is paid for at
browser speed, on a shared mutable stack, with no retries.

## 1. Shape of the suite today

- 26 feature files, 126 scenario entries → **153 executed tests** (4 outlines carry 31 example rows).
- 9 `@slow` scenarios (video transcode, people clustering, public-share transcode).
- `setup` project runs **serially before everything**: `00-serial/registration-toggle`, all of `04-faces`,
  and `05-semantic/semantic-upload` — 6 scenarios exist only because they mutate global state
  (registration flag; reprocess/recluster for every user).
- No `retries` in `e2e/playwright.config.ts`; 120 s test timeout, 15 s expect timeout, many `expect.poll`
  loops. Flakes surface as red, not as retries.
- `pnpm verify` runs the full E2E suite locally (`package.json` `verify`), but Jenkins does not
  (`Jenkinsfile` stops at `pnpm build`). The cost is developer wall-clock on every local gate.
- Only one scenario signs in through the login page (`01-bootstrap`) and one registers through the register
  page; every other authenticated scenario injects `localStorage` + the access cookie directly
  (`steps/support.ts` `injectSession`). That is the right split — keep it, and keep those two scenarios.

## 2. What only E2E can prove (and therefore must stay)

| Boundary | Only proven in E2E because |
|---|---|
| Container/volume wiring | `docker-compose.e2e.yml`: shared `storage-data` volume, `CORE_URL`, both JWT secrets, worker model mount, Floci. Integration runs core+worker in-process and mocks `CoreClient` elsewhere. |
| Worker consumes what core enqueued | Thumbnails/transcode actually appear as bytes after an HTTP upload. `upload-e2e.spec.ts` runs processors in-process, not across the process boundary. |
| Cookie-authenticated subresources | `<img src="/api/v1/files/:id/stream">`, `<video>`, share pages: the HttpOnly cookie path (no Bearer) is browser-only. |
| Real media pipeline | ffmpeg output plays; `currentSrc` picks the transcode; SigLIP/ArcFace/SCRFD models loaded from `STORAGE_DIR/models` produce a similarity/person that renders. |
| Client-only UX | typed-`DELETE` gate, Leaflet map + URL view state, lightbox, upload exists-check, viewer Escape, retry-toast for a failed S3 move. |
| Auth-exempt surface | Anonymous share pages (`/share/:token`) with no session at all. |
| Boot seeding | `ADMIN_EMAIL`/`ADMIN_PASSWORD` seed → login → admin role → admin UI. |

## 3. Critical set to keep (56 scenarios)

| Feature | Keep | Why it is critical |
|---|---|---|
| `01-bootstrap/seeded-admin` | 2/2 | only real boot-seed identity check; also the only guard for `/admin` redirect for a non-admin and the sidebar admin link |
| `02-auth/session` | 1/1 | logout through the account menu + refresh cookie path (`/api/v1/auth` scope); store clearing is unit-covered, the cookie is not |
| `03-media/photo-upload` | 2/2 | the highest-value test in the repo: multipart → core → worker → `STORAGE_DIR` → cookie-authed `<img>` decode; second scenario proves the client exists-check/dedupe path |
| `03-media/photo-viewer` | 1/1 | large preview over the cookie-authed stream + Escape |
| `03-media/upload-sessions` | 1/2 | session → real worker assembly → thumbnail in timeline (slim it, see §5) |
| `03-media/video` | 2/2 | real SVT-AV1 transcode, h264 skip, browser decoder, `currentSrc === transcode` |
| `04-faces/admin-faces` | 1/2 | reprocess through the admin UI drains the real `process-faces` queue and replaces seeded faces — the only consumer-side proof after an admin action |
| `05-semantic/search-ready` | 1/2 | related tray populated from a real embedding similarity |
| `05-semantic/semantic-upload` | 1/3 | worker embeds an uploaded photo in the compose stack (real model + queue) |
| `06-albums/albums` | 11/16 | album journeys have **no** component tests: create, search, rename, add-photos dialog, remove, delete-keeps-photos, viewer picker, selection bar, hidden badge + menu/card toggles |
| `07-favorites` | 2/8 | star from the viewer → favorites grid; day grouping |
| `08-people` | 3/9 | cluster button → person card; rename/clear; person detail day header + no face overlay |
| `09-sharing/own-shares` | 4/10 | create album/asset share from UI, copy confirmation, revoke from list, trashed-photo mixed list |
| `09-sharing/public-share` | 5/8 | anonymous photo page, album grid + lightbox, unknown/revoked token page, shared video playback |
| `10-trash` | 2/2 | trash/restore/purge/empty through the timeline and viewer |
| `11-places` | 4/4 | Leaflet cluster bubble, URL view mirroring, viewer overlay — zero integration alternative |
| `12-backups/backups` | 2/4 | full + incremental against a **real S3** (Floci) and the admin UI |
| `12-backups/backup-orphans` | 2/5 | orphan restore dialog and live-backup delete dialog (typed-DELETE, counts, prefix) |
| `13-admin-user-delete` | 3/11 | typed-DELETE gate, delete → list refresh, wipe keeps the victim's backup and spares the sibling (cross-service: worker purge + storage sweep + S3) |
| `14-admin-user-edit` | 4/6 | prefill, save + list, S3 move toast, failed-move warning + Retry |
| `15-admin-user-create` | 2/3 | create regular/admin user through the dialog; new account signs in |

## 4. Removals — assertions already owned one layer down

Each row is "delete after the migration in §7 lands". Counts are scenario entries; the second number in §3 is each
feature's current size.

| Feature | Drop | Integration/unit owner today |
|---|---|---|
| `02-auth/gating` | 5 (18 rows) | page redirects: `apps/web/src/App.spec.tsx:74` covers **all** gated routes incl. detail routes; API 401/403: `api-error-contract.spec.ts:37,43`, `jwt-files.spec.ts:69`, `admin-user-create.spec.ts:181,192`; public share 404: `jwt-shares.spec.ts:236` |
| `06-albums/albums-api` | 7 | `jwt-albums.spec.ts:62` (isolation CRUD 404), `:142` (cross-user add/remove), `:176` (missing name 400), `album-assets-list.spec.ts:127` (addedAt DESC paging), `:238` (foreign album assets 404) — see §7.6 for the real gaps |
| `06-albums/albums-hidden` | 8 | `assets-layout.spec.ts:365` (hidden toggles, window version, membership), `:415` (album-scoped bypass), `assets.service.spec.ts:356` (list omits hidden) — 2 gaps in §7.7 |
| `07-favorites` (API + empty state) | 6 | **no favorites spec exists** — migrate first (§7.1) |
| `08-people` (API + empty state) | 6 | `jwt-persons.spec.ts:77` (paging), `:111` (rename/clear/isolation), `:142` (cross rename 404), `:156` (cluster 202), `faces-http.spec.ts:243` (assign/unassign faceCount) |
| `09-sharing/own-shares` (API + empty state) | 6 | `jwt-shares.spec.ts:210` (rotation), `:255` (trashed), `album-shares.spec.ts:124` (zero/two targets 400), `:132` (foreign album 404) |
| `09-sharing/public-share` (stream scenarios) | 3 | `streaming.spec.ts:48,91,126`, `album-shares.spec.ts:380,411,489` — share-route 416 is a gap (§7.4) |
| `12-backups/backups` (API scenarios) | 2 | `user-backup-incremental.spec.ts:23,38,122,178`, `user-backup-maintenance.spec.ts:34,59,246`, `user-backup-roundtrip.spec.ts:29,525` |
| `12-backups/backup-gating` | 2 (16 rows) | **nothing** covers it (§7.2) — this feature is a true gap masquerading as duplication |
| `12-backups/backup-orphans` (filter/search/delete-orphan) | 3 | filter + search are client state: `apps/web/src/pages/admin/backup.spec.tsx:509,712`; orphan union and orphan delete: `user-backup-incremental.spec.ts:178`, `user-backup-maintenance.spec.ts:59` |
| `13-admin-user-delete` (guards, race, Actions column, restore/merge rows) | 8 | forged token `admin-user-delete.spec.ts:139`; wipe `:187`; re-delete/restore `:384`; conflicts/fallback `user-backup-restore.spec.ts:24,52,257`; merge `user-backup-maintenance.spec.ts:106,435`; Actions/Delete rendering `users.spec.tsx:208,218` |
| `14-admin-user-edit` (API scenarios) | 2 | `admin-user-edit.spec.ts:146` (role 400), `:218` (email change, sessions revoked, prefix moved) |
| `15-admin-user-create` (mocked flag) | 1 | `admin-user-create.spec.ts:195` flips the **real** flag; login/register UI in `login/index.spec.tsx:40`, `register/index.spec.tsx:38` |
| `00-serial/registration-toggle` | 1 | all six assertions already covered (above + `users.spec.tsx:660`); retiring it removes the serial prologue's only other reason to exist |
| `05-semantic/semantic-upload` (2 extra) | 2 | embeddings `embeddings-http.spec.ts:49`, detections replace-set `detections-http.spec.ts:76`, reprocess enqueue `:229`, face detect `face-pipeline.spec.ts:92,126` |
| `04-faces/admin-faces` (recluster) | 1 | `admin-face-reprocess.spec.ts:102`, `face-pipeline.spec.ts:194`, `face-detection.spec.tsx:149` |
| `05-semantic/search-ready` (tri-state page) | 1 | `search-http.spec.ts:233` (503/model path); the tri-state render is worth a `pages/search` web spec (not yet written) |
| `03-media/upload-sessions` (idempotent replay) | 1 | `uploads.spec.ts:231` (replay), `:417` (foreign session) |
| `06-albums/albums` (duplicate journeys) | 5 | description prompt folds into the rename journey; the not-found page is route-level; three "add photos" variants collapse to one |

Dropped: 70 of 126 (the §5 trims are step-level, not scenario-level). Net: **126 → 56 scenarios**, and `setup`
drops from 3 features to `04-faces` only (or none, if §7.5 lands).

## 5. Splits — scenarios that mix UI action with deep invariants

Keep the browser action, delete the invariant steps (they are already integration-owned):

- `06-albums/albums` hidden scenarios: keep the badge/menu/timeline assertions, drop
  `the album asset count is 1` and `the timeline layout version changes after hiding`
  (`assets-layout.spec.ts:365`).
- `03-media/video`: keep `reaches transcode status "ready"` as a **diagnostic poll**, drop
  `… with a transcode file` on one of the two scenarios (`upload-e2e.spec.ts:364,377`).
- `12-backups/backup-orphans` restore: drop `the restored orphan victim keeps the hidden album`
  (`user-backup-roundtrip.spec.ts:29`).
- `13-admin-user-delete` wipe: keep the wipe-to-terminal-state and the S3 side (victim backup kept, sibling
  backup untouched — E2E-only, §7.10), drop the row-level re-assertions (`admin-user-delete.spec.ts:187`).
- `03-media/upload-sessions`: drop the cross-user 404 and idempotent-replay steps
  (`uploads.spec.ts:231,417`); keep create → parts → complete → thumbnail.
- `09-sharing/own-shares` "trashed photo's share disappears while its album share remains":
  keep the `/shared` UI assertion, drop the mixed-list API assertion.

## 6. Structural cleanups

1. **Collapse the outlines that restate the same policy.** `02-auth/gating` has 8 identical page-redirect
   rows and 7 identical 401 rows; both are matrices that belong in integration.
2. **One hidden-album UI journey, not three.** "options menu", "card menu" and "showing again" test the same
   `hiddenFromTimeline` toggle through two menus; keep options-menu hide + timeline exclusion.
3. **Stop asserting list ordering/pagination in E2E** (albums newest-first, album assets newest-added, person
   list paging, favorites paging) — this is `ORDER BY`/cursor territory, and E2E can only observe it after a
   full page load.
4. **Nine `@slow` scenarios**: after §4, the remaining slow set is video (2) + public-share transcode (1) +
   people (1). Consider moving people clustering to a worker integration test that drives the real DBSCAN
   service, leaving only the "person card renders" E2E.
5. **No retries is correct** for a wiring suite — keep it, but that is the argument for cutting scenarios
   that are slow *and* invariant-checking rather than flaky-and-important.

## 7. Migration backlog (must land before the deletions)

1. **`apps/core/test/integration/favorites.spec.ts` (new, highest value).** `favorite=true` as a list is
   never asserted anywhere: per-user isolation, `total`, limit/offset disjointness, PATCH `favorite:false`
   removes from the filter, trashing a favorite removes it. Today only compositions exist
   (`assets-date-range.spec.ts:106`, `assets-layout.spec.ts:177`, `jwt-assets.spec.ts:174`).
2. **`admin-backup-http.spec.ts` (new) — the largest true gap.** No test in the repo asserts 401/403 on
   `/api/v1/admin/backups*` or `/api/v1/admin/restores*`; `api-path-policy-bypass.spec.ts:123` enumerates
   admin routes but omits both families. Add the 8-route × {anonymous 401, user 403} matrix plus
   `POST /admin/backups` 202, `GET overview|status|progress|runs/:id` over HTTP. Every backup test today
   calls `t.svc.*` directly.
3. **Anonymous 401 matrix + unknown share token.** Add `GET/POST /api/v1/albums`, `GET /api/v1/shares`,
   `DELETE /api/v1/shares/:id`, `GET /api/v1/persons`, `GET /api/v1/admin/users` to
   `api-error-contract.spec.ts`, and a never-existed share token → 404 (only revoked-token 404 exists).
4. **`streaming.spec.ts`:** share-route `Range: bytes=99999999-` → 416 and a shared transcode served with a
   range in one test (`album-shares.spec.ts:489` covers the derivative, `streaming.spec.ts:126` the range,
   never together).
5. **Worker reprocess drain.** No test consumes `process-faces` / `process-embeddings` / `process-detect`
   after an admin reprocess — only enqueue is asserted (`admin-face-reprocess.spec.ts:62`,
   `embeddings-http.spec.ts:153`, `detections-http.spec.ts:229`). Add a worker integration test that drains
   one job, then `04-faces` can keep a single reprocess scenario or go entirely.
6. **Album add edges** in `jwt-albums.spec.ts`: adding a trashed asset → 404, duplicate add keeps 1
   (`.orIgnore()`), adding a real foreign asset (not an unknown UUID) → 404, `GET /albums` newest-first with
   `limit=2`, sequential adds mint increasing `addedAt`, `GET /albums/:id` returns `hiddenFromTimeline`.
7. **Hidden-album edges** in `assets-layout.spec.ts` / `jwt-albums.spec.ts`: hiding an **empty** album is a
   no-op (version stable), deleting a hidden album returns its asset to the timeline.
8. **Share list contract** in `jwt-shares.spec.ts`: `GET /api/v1/shares` omits `token` (a real leak guard),
   a revoked share is absent from the list, and a mixed trashed-asset/album list keeps the album share.
9. **Web specs for the UI holes E2E currently covers by accident:** non-admin `/admin` redirect
   (`pages/admin/index.tsx:221`), Sidebar hides the admin link for `user` (`Sidebar.tsx:71`), people list card
   label, person-detail day header / no-overlay, `pages/admin/ai.tsx` last-run card.
10. **S3 survival after a wipe** is E2E-only (`admin-user-delete.spec.ts:187` never seeds a backup; assertions
    are row-level). Keep it in E2E deliberately, or add an S3 fixture to the integration harness.

## 8. Risks of the cut

- **Do not delete `backup-gating` before §7.2** — it is the only authz check on the backup/restore surface.
- **Do not delete the favorites API scenarios before §7.1** — the filter has no integration owner.
- Dropping `04-faces`/`semantic-upload` from `setup` removes the only test of "a real upload enqueues and a
  real worker consumes" for faces/embeddings/detect. Keep one scenario each until §7.5 lands.
- Playback (`currentTime > 0.2`, `currentSrc`), image decode, Leaflet and typed-`DELETE` have no lower-layer
  substitute; they are the reason this suite still exists.
- The compose stack itself (env vars, shared volume, secrets, Floci bucket) is only validated by E2E; a
  reduction to ~56 scenarios must keep at least one upload, one video, one backup and one wipe journey.
