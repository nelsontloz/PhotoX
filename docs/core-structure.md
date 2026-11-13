# Core service structure

The rules the code follows, so a new file has one obvious home. Enforced where it can be
(ESLint), reviewed where it cannot.

## Ownership

| Area | Owns |
|---|---|
| `auth/` | Token verification, the route policy (`open-routes.ts`), cookies, the guard |
| `users/` | Accounts, credentials, sessions, admin user CRUD, the account wipe |
| `database/entities/` | **Every** entity. One schema, one directory |
| `database/migrations/` | Every schema change. Boot SQL in `database.module.ts` is DDL that `synchronize` cannot express |
| `common/` | Anything imported by three or more features (`sql-errors`, `mime`, `asset-ownership`, …) |
| `files/user/` | The ingest core: `persistOriginal` → `createAsset` → `enqueueAssetJobs` |
| `files/storage/` | `LocalStorageService` wiring (infrastructure) |
| `assets/` | Asset CRUD, trash, metadata ingestion, byte-target resolution |
| `timeline` (inside `assets/`) | The month-index / window protocol and its `version` tokens |
| `backup/` | Manifest, transfer ledger, restore, merge — the one declared cross-cutting reader |
| `maintenance/` | Periodic reconcilers (stuck assets) |
| `worker/` | The `/worker/*` adapter; no business logic of its own |

## Rules

1. **One schema home.** New entities go in `database/entities/` and are exported from its barrel.
   Feature-local `entities/` directories do not exist.
2. **The data layer does not import features.** `database/**` may import `../scripts/**`,
   `common/**` and `../shared/**` only. ESLint enforces this.
3. **A table has one owner.** A feature that needs another feature's rows calls its exported
   service. Cross-feature repository access is reserved for `backup/`, which is declared as
   cross-cutting at the top of `backup.module.ts`.
4. **Helpers move up before they spread.** A function used by three features belongs in `common/`.
   A pure helper exported from a `*.service.ts` is a boundary leak, not a convenience.
5. **Controllers are thin.** Validation, cookies and streaming aside, a controller may not decide
   authorization or run a loop of enqueues; that is service work.
6. **One error contract.** Errors carry `{ statusCode, message, code? }`; the resumable-upload
   `IngestErrorCode` envelope is the model.
7. **A new directory must be type-checkable.** ESLint runs type-aware (`projectService`), so a new
   package path either has a tsconfig or is added to the config's `ignores`.
