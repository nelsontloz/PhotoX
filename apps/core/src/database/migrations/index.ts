import type { MigrationInterface } from 'typeorm';
import { Baseline1791882552125 } from './1791882552125-Baseline';
import { FileChecksumUnique1791888695000 } from './1791888695000-FileChecksumUnique';
import { UploadSessions1792364530809 } from './1792364530809-UploadSessions';
import { BackupMerges1792450000000 } from './1792450000000-BackupMerges';
import { DropAssetOcr1793900000000 } from './1793900000000-DropAssetOcr';
import { DropUploadSessionMimeHint1793900000001 } from './1793900000001-DropUploadSessionMimeHint';
import { RefreshTokenSessions1794100000000 } from './1794100000000-RefreshTokenSessions';
import { AlbumHiddenFromTimeline1794200000000 } from './1794200000000-AlbumHiddenFromTimeline';
import { BackupTransferRuns1794300000000 } from './1794300000000-BackupTransferRuns';
import { BackupRunActiveUnique1794400000000 } from './1794400000000-BackupRunActiveUnique';
import { UserDeletes1794400000000 } from './1794400000000-UserDeletes';
import { AlbumAssetsPagingIndex1794400000001 } from './1794400000001-AlbumAssetsPagingIndex';
import { PersonsFaceCountIndex1794450000000 } from './1794450000000-PersonsFaceCountIndex';
import { StructuralIndexes1794500000000 } from './1794500000000-StructuralIndexes';
import { UserIdUuid1794600000000 } from './1794600000000-UserIdUuid';
import { ReferentialIntegrity1794600000001 } from './1794600000001-ReferentialIntegrity';
import { RefreshTokenExpiryIndex1794600000002 } from './1794600000002-RefreshTokenExpiryIndex';

/**
 * The one migration list. A glob only works where the sources exist (dev/test); production
 * runs compiled JS from `dist`, and — more importantly — a list can be asserted against the
 * directory in a unit test, so "wrote a migration but never registered it" is caught before it
 * reaches a deploy. TypeORM wants the classes, not instances (it instantiates them itself).
 * Order is the filename order; keep new entries at the end.
 */
export const MIGRATIONS: (new () => MigrationInterface)[] = [
  Baseline1791882552125,
  FileChecksumUnique1791888695000,
  UploadSessions1792364530809,
  BackupMerges1792450000000,
  DropAssetOcr1793900000000,
  DropUploadSessionMimeHint1793900000001,
  RefreshTokenSessions1794100000000,
  AlbumHiddenFromTimeline1794200000000,
  BackupTransferRuns1794300000000,
  BackupRunActiveUnique1794400000000,
  UserDeletes1794400000000,
  AlbumAssetsPagingIndex1794400000001,
  PersonsFaceCountIndex1794450000000,
  StructuralIndexes1794500000000,
  UserIdUuid1794600000000,
  ReferentialIntegrity1794600000001,
  RefreshTokenExpiryIndex1794600000002,
];
