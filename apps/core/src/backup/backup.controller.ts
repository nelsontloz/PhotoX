import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator'
import {
  UserBackupService,
  type BackupOverviewRow,
  type BackupProgress,
  type BackupResult,
  type BackupStatus,
  type DeleteBackupResult,
  type MergeBackupResult,
  type RestoreResult,
} from './user-backup.service'

class BackupRequestDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string
}

class RestoreRequestDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string

  @IsOptional()
  @IsEmail()
  restoreEmail?: string
}

class MergeRestoreRequestDto {
  @IsString()
  @IsNotEmpty()
  targetEmailOrId!: string

  @IsUUID()
  backupUserId!: string

  @IsOptional()
  @IsString()
  prefix?: string

  @IsOptional()
  @IsBoolean()
  force?: boolean
}

class BackupStatusQueryDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string
}

class BackupProgressQueryDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string
}

class DeleteBackupQueryDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string
}

// ponytail: admin-only is enforced centrally by JwtAuthGuard (every /api/v1/admin*
// route requires the admin role) — no per-handler role checks here
@ApiTags('admin')
@Controller('api/v1/admin')
export class BackupController {
  constructor(private readonly backups: UserBackupService) {}

  @Post('backups')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Back up one user (rows + original bytes) to S3 (admin-only)',
    description:
      'Original bytes first, manifest.json last (rerun-safe fixed keys). ' +
      'Layout backups/<email>__<userId>/ — an email change auto-renames the old prefix ' +
      'via server-side copy (manifest rewritten fresh, old deleted after HEAD verify). ' +
      'Incremental: unchanged bytes are skipped via the previous manifest + S3 listing ' +
      '(uploaded/skipped counters in the result).',
  })
  @ApiResponse({ status: 200, description: 'Backup counts and S3 prefix' })
  async backup(@Body() dto: BackupRequestDto): Promise<BackupResult> {
    return this.backups.backupUser(dto.emailOrId)
  }

  @Post('restores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restore one user from S3 and re-enqueue derivatives (admin-only)',
    description:
      'HARD PREREQUISITE: keep cleanup-orphans paused until the restore completion ' +
      'log (multi-GB restores can exceed the ~10-min orphan grace window). Derivative ' +
      'statuses stay stale until jobs complete (metadata pending for all, ' +
      'persons.faceCount until cluster). Restoring under a different email (explicit ' +
      'restoreEmail or the restored-<ms>-<orig> fallback) re-homes the S3 snapshot to ' +
      'the restored address: the prefix is server-side copied, the manifest is rewritten ' +
      'with the new emailAtBackup/user.email (userId and rows unchanged) and written last, ' +
      'then the old prefix is deleted. A failed move does not fail the restore — the ' +
      'snapshot stays at the source prefix and the response reports reassignmentError ' +
      '(prefix then points at the source).',
  })
  @ApiResponse({ status: 200, description: 'Restore counts and re-enqueue totals' })
  async restore(@Body() dto: RestoreRequestDto): Promise<RestoreResult> {
    return this.backups.restoreUser(dto.emailOrId, dto.restoreEmail)
  }

  @Post('restores/merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Merge a matched legacy backup into a live account (admin-only)',
    description:
      'Additive only: the target is the live account whose normalized email equals the ' +
      "manifest's emailAtBackup (email/password/role/profile untouched). Original bytes are " +
      'deduped by checksum and old asset ids are remapped to live assets for album/share ' +
      'links. Rows first, bytes second, derivative jobs third. Adoption then moves the source ' +
      'snapshot into the live prefix: missing originals are server-side copied, the source ' +
      'manifest is unioned with any existing live manifest (live entries win, shares dedupe ' +
      'by token), the union is written last and the source prefix is deleted — the account ' +
      'reads as a normal backed-up row instead of a legacyBackups sub-row. HARD PREREQUISITE: ' +
      'keep cleanup-orphans paused until the merge completion log. A second plain merge of the ' +
      'same source is 409 already-merged; force replays/upserts the ledger. Partial failure: ' +
      'if adoption fails (unreadable live manifest or S3 error) merge rows/bytes stay, the ' +
      'ledger and source delete are skipped, and the response reports assigned:null plus ' +
      'adoptionError so a plain retry stays allowed.',
  })
  @ApiResponse({ status: 200, description: 'Merge counts, dedupe/skip totals and jobs enqueued' })
  @ApiResponse({ status: 404, description: 'Target user or source backup not found' })
  @ApiResponse({ status: 409, description: 'Email mismatch, already merged or id conflict' })
  @ApiResponse({ status: 413, description: 'Storage quota exceeded (retry with force)' })
  @ApiResponse({ status: 422, description: 'Backup manifest corrupt' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async merge(@Body() dto: MergeRestoreRequestDto): Promise<MergeBackupResult> {
    return this.backups.mergeUserBackup(dto)
  }

  @Get('backups/overview')
  @ApiOperation({ summary: 'Aggregated backup overview, one row per user (admin-only)' })
  @ApiResponse({ status: 200, description: 'Live asset counts joined with manifest status' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async overview(): Promise<BackupOverviewRow[]> {
    return this.backups.backupOverview()
  }

  @Get('backups/status')
  @ApiOperation({ summary: 'Backup manifest status for one user (admin-only)' })
  @ApiResponse({ status: 200, description: 'Manifest presence and row counts' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async status(@Query() query: BackupStatusQueryDto): Promise<BackupStatus> {
    return this.backups.backupStatus(query.emailOrId)
  }

  @Get('backups/progress')
  @ApiOperation({ summary: 'Live per-file backup progress for one user (admin-only)' })
  @ApiResponse({ status: 200, description: 'In-progress flag plus per-file counters' })
  @ApiResponse({ status: 404, description: 'No user for emailOrId' })
  async progress(@Query() query: BackupProgressQueryDto): Promise<BackupProgress> {
    return this.backups.getBackupProgress(query.emailOrId)
  }

  @Delete('backups')
  @ApiOperation({ summary: 'Delete one user backup from S3 (admin-only)' })
  @ApiResponse({ status: 200, description: 'Deleted backup prefix and object count' })
  @ApiResponse({ status: 404, description: 'No backup for emailOrId' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async deleteBackup(@Query() query: DeleteBackupQueryDto): Promise<DeleteBackupResult> {
    return this.backups.deleteBackup(query.emailOrId)
  }
}
