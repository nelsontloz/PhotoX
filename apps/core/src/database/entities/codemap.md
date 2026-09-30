# apps/core/src/database/entities/

## Responsibility

The five TypeORM entities that define PhotoX's schema. Because `DatabaseModule` runs
with `synchronize: true`, these decorators are the single source of truth for tables,
columns, enums, FKs, and indexes — there are no migration files. Folded in from the deleted
`packages/data-access` package.

## Design

**`Asset` → `assets`** (`asset.entity.ts`)

- Indexes: `(userId, uploadedAt)`, `(userId, takenAt)`, `(userId, kind, uploadedAt)`,
  partial `(userId)` `WHERE "isTrashed" = false`; `userId` and `kind` also indexed alone.
- Columns: `id` uuid PK; `userId`; `kind` enum `photo|video`; unique `fileId` uuid;
  `uploadedAt` timestamptz; `isTrashed` (default false) + `trashedAt`; `title`,
  `description`, `takenAt`, `favorite`; `mimeType`, `sizeBytes` bigint, `originalName`,
  `width`/`height`; EXIF `cameraMake`/`cameraModel`/`lensModel`, `orientation`, `iso`,
  `fNumber` numeric(3,1), `exposureTime` numeric(10,7), `focalLength` numeric(5,1),
  `latitude`/`longitude` numeric(9,6), `altitude` numeric(9,3); video `durationSeconds`,
  `fps`, `codec`, `hasAudio`; `metadata` jsonb + `metadataStatus` enum +
  `metadataExtractedAt`.
- Pipeline state: `transcodeStatus`, `thumbnailStatus`, `faceStatus`
  (`pending|ready|failed|null`), `faceCount` (default 0), `transcodeFileId` uuid.
- Relation: `OneToMany` → `AssetThumbnail.thumbnails`.

**`AssetThumbnail` → `asset_thumbnails`** (`asset-thumbnail.entity.ts`)

- `@Unique(['assetId', 'size'])`; `assetId` indexed and a `ManyToOne` → `Asset` with
  `onDelete: 'CASCADE'` (deleting an asset drops its thumbnails).
- Columns: `size` text (sm/md/lg/xl), `fileId` uuid, `width`, `height`, `bytes` bigint,
  `createdAt`.

**`FileRecord` → `files`** (`file-record.entity.ts`)

- Indexes: `(userId, checksumSha256)` for dedup lookups, `(userId, purpose, createdAt)`,
  and `assetId` indexed.
- Columns: `storageKey` (relative path under `STORAGE_DIR`), `originalName`, `mimeType`,
  `sizeBytes` bigint, `checksumSha256`, `purpose` varchar(16) default `original`
  (`original | transcode`), nullable `assetId`, `createdAt`. Originals are immutable;
  a transcode is a separate row with `purpose: 'transcode'`.

**`Face` → `faces`** (`face.entity.ts`)

- The 512-dim embedding constant (`FACE_EMBEDDING_DIM`, InsightFace buffalo_l w600k_r50 output)
  lives in `@photox/shared-types`; this entity only stores the vector.
- Indexes: `(personId, userId)` plus `assetId`, `userId`, `personId` individually.
- Columns: `box` jsonb `{x,y,w,h}`, `confidence` real, `embedding` text with a pgvector
  transformer (`toSql`/`fromSql`), `personId` nullable uuid **without** a TypeORM relation
  (avoids a circular import between face and person modules).
- HNSW index `faces_embedding_hnsw` is NOT declared here — core's bootstrap drops and
  recreates it as `USING hnsw ((embedding::vector(512)) vector_cosine_ops)`; keeping it out
  of the entity avoids `synchronize` fighting the custom index.
- `Person` → `persons` (`person.entity.ts`): index `(userId, clusterLabel)`, `userId`
  indexed; columns `name` nullable, `coverFaceId` uuid, `clusterLabel`, `faceCount`
  (default 0), `createdAt`/`updatedAt`.

## Flow

Core writes all rows from HTTP handlers: upload/assets flows insert `FileRecord`s, `Asset`s and
`AssetThumbnail`s, the metadata/thumbnail/video/face endpoints patch status columns (metadata,
thumbnails, transcode, faces) and register worker-written derivative rows (`POST /files/register`),
and face endpoints insert `Face`s (`DELETE`+`POST .../faces` replace) and apply cluster plans
(`POST /persons/apply-clusters`). `Face.embedding` round-trips `number[]` ↔ pgvector text via
the transformer; the worker computes clusters in memory (O(n²) DBSCAN) and ships the resulting
plan to core.

## Integration

Registered by core with `TypeOrmModule.forFeature` per domain module (e.g.
`faces.module.ts`, `albums.module.ts`, `files/user/user-files.module.ts`). The worker-service
never connects to Postgres and does not import these classes. Wire counterparts live in
`@photox/shared-types` (`Asset`, `FileRecord`, `FaceDto`, `PersonDto`); `FACE_EMBEDDING_DIM` is
also exported there and imported by `face.embedder.ts`, `face.cluster.ts`, and their specs.
Runtime needs a Postgres with the `vector` extension for the HNSW index (plain `postgres:16`
testcontainers only produce a warning).
