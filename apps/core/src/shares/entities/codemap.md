# apps/core/src/shares/entities/

## Responsibility

The `AssetShare` TypeORM entity — the persistence model for public share links.

## Design

- Table `asset_shares`; class-level indexes: `@Index(['token'], { unique: true })` and `@Index(['userId'])`.
- Columns:
  - `id` uuid PK (`@PrimaryGeneratedColumn`).
  - `assetId` uuid column plus `@ManyToOne(() => Asset, { onDelete: 'CASCADE', nullable: false })` with `@JoinColumn({ name: 'assetId' })` — a real FK, unlike most relations in this codebase. Permanent asset deletion cascades the share row; `AssetsService` also deletes shares explicitly in its purge transaction.
  - `userId` varchar (owner) — no FK to any user table (users are managed outside this DB).
  - `token` varchar(32); generated in the service with `crypto.randomBytes(16).toString('base64url')` (22 chars) and the unique index is the lookup path for public streaming.
  - `createdAt` timestamptz `@CreateDateColumn`.
- No `expiresAt`, `revokedAt`, or view counter: revocation is a hard delete, and links are permanent until revoked.
- No uniqueness on `(assetId, userId)` at the DB level; `SharesService.create` enforces one share per asset/user in application code (race could create duplicates, which the unique token still makes addressable).

## Flow

- Written by `SharesService.create` (`shareRepo.save`) after asset ownership/trash checks.
- Read by `getByToken` (unique index on `token`, relation `asset` loaded) and by `list` (index on `userId`, joins `asset` + `asset.thumbnails`).
- Deleted by `revoke(userId, shareId)` or cascaded/FK-cleaned when an asset is permanently deleted.
- `PublicSharesController` never touches the repository directly — it goes through `SharesService.getByToken` and then `UserFilesService.stream(share.asset.fileId)`.

## Integration

- Imports `Asset` from `@photox/data-access` so the FK target and table metadata stay in sync with the shared entity package; registered by `SharesModule` via `TypeOrmModule.forFeature([AssetShare, Asset])`.
- Schema created by TypeORM `synchronize: true`; no migrations in the repo.
