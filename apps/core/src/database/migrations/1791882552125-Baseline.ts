import type { MigrationInterface, QueryRunner } from 'typeorm';

// Baseline schema generated from the entity metadata via the TypeORM schema-builder log
// (fresh pgvector DB, synchronize off) — keep in sync by generating a new migration per change.
// Extensions (vector/cube/earthdistance) and the custom layout/HNSW/places indexes are NOT here:
// DatabaseModule bootstrap creates those on every boot, before the admin seed.
// ponytail: assumes a fresh prod DB — a DB previously created by synchronize must mark this
// applied manually (INSERT INTO migrations(name) ...) or table creation fails on existing tables.
export class Baseline1791882552125 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'admin')`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL, "passwordHash" character varying NOT NULL, "displayName" character varying NOT NULL, "tokensValidAfter" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "tokenHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "absoluteExpiresAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_c25bc63d248ca90e8dcc1d92d06" UNIQUE ("tokenHash"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "albums" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "name" character varying(255) NOT NULL, "description" character varying(2000), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_838ebae24d2e12082670ffc95d7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e46da7abb99e39551c4245168" ON "albums" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "album_assets" ("albumId" uuid NOT NULL, "assetId" uuid NOT NULL, "addedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_808189a2deaf63e563e74b29593" PRIMARY KEY ("albumId", "assetId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb11b356298e7a77aec0f86441" ON "album_assets" ("assetId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "storageKey" character varying NOT NULL, "originalName" character varying NOT NULL, "mimeType" character varying NOT NULL, "sizeBytes" bigint NOT NULL, "checksumSha256" character varying NOT NULL, "purpose" character varying(16) NOT NULL DEFAULT 'original', "assetId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_105182515f43e6496413bf5ab5" ON "files" ("assetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8af0fbd7ca5dc7f2a7cad7f2d" ON "files" ("userId", "purpose", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ddde300268eb3b2a00a162db89" ON "files" ("userId", "checksumSha256") `,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_thumbnails" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "assetId" uuid NOT NULL, "size" text NOT NULL, "fileId" uuid NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "bytes" bigint NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_9ef0b176325c43f61e399363a99" UNIQUE ("assetId", "size"), CONSTRAINT "PK_b65270a5140f8c8710efb11d221" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE TYPE "public"."assets_kind_enum" AS ENUM('photo', 'video')`);
    await queryRunner.query(
      `CREATE TYPE "public"."assets_metadatastatus_enum" AS ENUM('pending', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "assets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "kind" "public"."assets_kind_enum" NOT NULL, "fileId" uuid NOT NULL, "uploadedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "isTrashed" boolean NOT NULL DEFAULT false, "trashedAt" TIMESTAMP WITH TIME ZONE, "title" character varying, "description" character varying, "takenAt" TIMESTAMP WITH TIME ZONE, "favorite" boolean NOT NULL DEFAULT false, "mimeType" character varying, "sizeBytes" bigint, "originalName" character varying, "width" integer, "height" integer, "durationSeconds" numeric, "cameraMake" character varying, "cameraModel" character varying, "lensModel" character varying, "orientation" integer, "iso" integer, "fNumber" numeric(3,1), "exposureTime" numeric(10,7), "focalLength" numeric(5,1), "latitude" numeric(9,6), "longitude" numeric(9,6), "altitude" numeric(9,3), "placeCity" character varying(255), "placeAdmin1" character varying(255), "placeCountryCode" character varying(2), "placeTimezone" character varying(64), "placeDistanceKm" real, "phash" text, "fps" numeric, "codec" character varying, "hasAudio" boolean, "metadata" jsonb, "metadataStatus" "public"."assets_metadatastatus_enum" NOT NULL DEFAULT 'pending', "metadataExtractedAt" TIMESTAMP WITH TIME ZONE, "transcodeStatus" character varying(16), "thumbnailStatus" character varying(16), "faceStatus" character varying(16), "embeddingStatus" character varying(16), "faceCount" integer DEFAULT '0', "transcodeFileId" uuid, CONSTRAINT "UQ_24cf76efa8ab75335fa55e334d8" UNIQUE ("fileId"), CONSTRAINT "PK_da96729a8b113377cfb6a62439c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d46b210baad0f7117dd215e3d" ON "assets" ("userId", "uploadedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "faces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "assetId" uuid NOT NULL, "userId" uuid NOT NULL, "box" jsonb NOT NULL, "confidence" real NOT NULL, "embedding" text NOT NULL, "personId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d7ce2dfda1e63bfba799ffa6737" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85d0decb698877c7133a294dfc" ON "faces" ("assetId") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_81c11a6ba10be5c21e01bfa2ec" ON "faces" ("userId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_68120bf62593ed9f1a062e673b" ON "faces" ("personId", "userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "persons" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" text, "coverFaceId" uuid, "clusterLabel" text, "faceCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_74278d8812a049233ce41440ac7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9c66c0529d13e9a2ffd485b45" ON "persons" ("userId", "clusterLabel") `,
    );
    await queryRunner.query(
      `CREATE TABLE "app_settings" ("key" text NOT NULL, "value" jsonb NOT NULL, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_975c2db59c65c05fd9c6b63a2ab" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "shares" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "kind" character varying(16) NOT NULL, "assetId" uuid, "albumId" uuid, "token" character varying(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_shares_exactly_one_target" CHECK (("assetId" IS NULL) <> ("albumId" IS NULL)), CONSTRAINT "PK_b88473409066c43c2ccb1894a82" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_54fa99e499f0b4de97f2af2900" ON "shares" ("albumId", "userId") WHERE "albumId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d80387bc1a6b0d5b18b6cda210" ON "shares" ("assetId", "userId") WHERE "assetId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_969e9a7c89cbbd57c889ba5f45" ON "shares" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f51f54e33eac0d4d7ada7422cf" ON "shares" ("token") `,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_embeddings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "assetId" uuid NOT NULL, "kind" text NOT NULL DEFAULT 'image', "model" text NOT NULL, "embedding" text NOT NULL, CONSTRAINT "UQ_8475faa9aa94e19074dcb59d31c" UNIQUE ("assetId", "kind", "model"), CONSTRAINT "PK_4446b73bd1407a2b100cb0e30c2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_ocr" ("assetId" uuid NOT NULL, "text" text NOT NULL, "lang" text, "confidence" real, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dc592ec504976f5636e28bb84c6" PRIMARY KEY ("assetId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_detections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "assetId" uuid NOT NULL, "label" text NOT NULL, "confidence" real NOT NULL, "box" jsonb NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fe9e3f927891c4bf05c1f2d3ed1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_836531876fdada14076cd4b7d3" ON "asset_detections" ("assetId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "places" ("geonameId" integer NOT NULL, "name" text NOT NULL, "latitude" numeric(9,6) NOT NULL, "longitude" numeric(9,6) NOT NULL, "countryCode" character varying(2) NOT NULL, "admin1Code" character varying(20), "timezone" character varying(64), CONSTRAINT "PK_8fd315eb3ef9575b36627b709eb" PRIMARY KEY ("geonameId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_thumbnails" ADD CONSTRAINT "FK_529780d1245d4ed0bdea7b6b42d" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shares" ADD CONSTRAINT "FK_ba0d2eaffec96718bd9f1d19af3" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shares" ADD CONSTRAINT "FK_09ee5188b00325b78e601456857" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_embeddings" ADD CONSTRAINT "FK_66052c5f9a5c7df77e125c74b07" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_ocr" ADD CONSTRAINT "FK_dc592ec504976f5636e28bb84c6" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_detections" ADD CONSTRAINT "FK_836531876fdada14076cd4b7d35" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "asset_detections" DROP CONSTRAINT "FK_836531876fdada14076cd4b7d35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_ocr" DROP CONSTRAINT "FK_dc592ec504976f5636e28bb84c6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_embeddings" DROP CONSTRAINT "FK_66052c5f9a5c7df77e125c74b07"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shares" DROP CONSTRAINT "FK_09ee5188b00325b78e601456857"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shares" DROP CONSTRAINT "FK_ba0d2eaffec96718bd9f1d19af3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_thumbnails" DROP CONSTRAINT "FK_529780d1245d4ed0bdea7b6b42d"`,
    );
    await queryRunner.query(`DROP TABLE "places"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_836531876fdada14076cd4b7d3"`);
    await queryRunner.query(`DROP TABLE "asset_detections"`);
    await queryRunner.query(`DROP TABLE "asset_ocr"`);
    await queryRunner.query(`DROP TABLE "asset_embeddings"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f51f54e33eac0d4d7ada7422cf"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_969e9a7c89cbbd57c889ba5f45"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d80387bc1a6b0d5b18b6cda210"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_54fa99e499f0b4de97f2af2900"`);
    await queryRunner.query(`DROP TABLE "shares"`);
    await queryRunner.query(`DROP TABLE "app_settings"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f9c66c0529d13e9a2ffd485b45"`);
    await queryRunner.query(`DROP TABLE "persons"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_68120bf62593ed9f1a062e673b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_81c11a6ba10be5c21e01bfa2ec"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_85d0decb698877c7133a294dfc"`);
    await queryRunner.query(`DROP TABLE "faces"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3d46b210baad0f7117dd215e3d"`);
    await queryRunner.query(`DROP TABLE "assets"`);
    await queryRunner.query(`DROP TYPE "public"."assets_metadatastatus_enum"`);
    await queryRunner.query(`DROP TYPE "public"."assets_kind_enum"`);
    await queryRunner.query(`DROP TABLE "asset_thumbnails"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ddde300268eb3b2a00a162db89"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b8af0fbd7ca5dc7f2a7cad7f2d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_105182515f43e6496413bf5ab5"`);
    await queryRunner.query(`DROP TABLE "files"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cb11b356298e7a77aec0f86441"`);
    await queryRunner.query(`DROP TABLE "album_assets"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8e46da7abb99e39551c4245168"`);
    await queryRunner.query(`DROP TABLE "albums"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }
}
