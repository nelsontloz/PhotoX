# apps/core/src/users/entities/

## Responsibility

TypeORM entities for the two auth-owned tables, `users` and `refresh_tokens`. Schema is created by `synchronize: true` from `SharedDatabaseModule` — this repo has no migrations.

## Design

`User` (`users`):

- `id` uuid PK (`@PrimaryGeneratedColumn('uuid')`)
- `email` unique
- `role` Postgres enum `['user', 'admin']` — the first registered user is promoted to `admin` inside `AuthService.register`
- `passwordHash` — argon2 output, never plaintext
- `displayName`; optional `avatarUrl`
- `createdAt` / `updatedAt` via `@CreateDateColumn` / `@UpdateDateColumn`

`RefreshToken` (`refresh_tokens`):

- `id` uuid PK; `userId` plain uuid column — no FK or relation object, services join/filter manually
- `tokenHash` unique — sha256 hex of the opaque token; the raw token is never persisted
- `purpose` enum `['refresh']` — single-purpose today, the enum leaves room for other token kinds
- `expiresAt` timestamptz; `revokedAt` timestamptz nullable (`null` = live)
- `createdAt`

No cascades or relations: revocation/deletion is explicit in `AuthService`, and rotate-on-use is enforced by a conditional UPDATE on `tokenHash` + `revokedAt IS NULL`.

## Flow

`AuthService.issueTokens` inserts a `RefreshToken` per login/register/refresh; `refresh` reads by hash then revokes the old row in the same conditional update; `logout` revokes by id. `User` rows are read by auth, the users/admin listing, and integration seeds.

## Integration

- Registered via `TypeOrmModule.forFeature([User, RefreshToken])` in `users/users.module.ts`; auto-loaded into the shared DataSource.
- Imported by `test/integration/helpers.ts` to include them in the test DataSource.
- The `assets`–`users` relationship is by `userId` column only; worker-service never touches these tables.
