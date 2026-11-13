import {
  Asset,
  AssetThumbnail,
  Face,
  FileRecord,
  Person,
  AppSetting,
  UploadSession,
  UploadSessionPart,
  UserDelete,
} from '../../src/database/entities';
import { AssetEmbedding } from '../../src/database/entities/asset-embedding.entity';
import { AssetDetection } from '../../src/database/entities/asset-detection.entity';
import { Place } from '../../src/database/entities/place.entity';
import { User } from '../../src/database/entities/user.entity';
import { RefreshToken } from '../../src/database/entities/refresh-token.entity';
import { Album } from '../../src/database/entities/album.entity';
import { AlbumAsset } from '../../src/database/entities/album-asset.entity';
import { Share } from '../../src/database/entities/share.entity';
import { BackupMerge } from '../../src/database/entities/backup-merge.entity';
import { BackupRun } from '../../src/database/entities/backup-run.entity';
import { BackupRunItem } from '../../src/database/entities/backup-run-item.entity';

/**
 * Every entity the test apps register, and the single source of truth for the schema baked
 * into the template database (see test/global-setup.ts). Spec files used to pass their own
 * subsets, which cannot work once the schema is created once instead of per file — one list
 * means every spec file clones the same superset.
 */
export const ENTITIES = [
  User,
  RefreshToken,
  Album,
  AlbumAsset,
  Share,
  FileRecord,
  Asset,
  AssetThumbnail,
  Face,
  Person,
  AppSetting,
  AssetEmbedding,
  AssetDetection,
  Place,
  UploadSession,
  UploadSessionPart,
  BackupMerge,
  BackupRun,
  BackupRunItem,
  UserDelete,
];
