import {
  Asset,
  AssetThumbnail,
  Face,
  FileRecord,
  Person,
  AppSetting,
  UploadSession,
  UploadSessionPart,
} from '../../src/database/entities'
import { AssetEmbedding } from '../../src/database/entities/asset-embedding.entity'
import { AssetOcr } from '../../src/database/entities/asset-ocr.entity'
import { AssetDetection } from '../../src/database/entities/asset-detection.entity'
import { Place } from '../../src/database/entities/place.entity'
import { User } from '../../src/users/entities/user.entity'
import { RefreshToken } from '../../src/users/entities/refresh-token.entity'
import { Album } from '../../src/albums/entities/album.entity'
import { AlbumAsset } from '../../src/albums/entities/album-asset.entity'
import { Share } from '../../src/shares/entities/share.entity'
import { BackupMerge } from '../../src/backup/entities/backup-merge.entity'

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
  AssetOcr,
  AssetDetection,
  Place,
  UploadSession,
  UploadSessionPart,
  BackupMerge,
]
