import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  UserBackupService,
  type BackupOverviewRow,
  type BackupProgress,
  type BackupRunStatus,
  type BackupStatus,
  type DeleteBackupResult,
  type MergeBackupResult,
} from './user-backup.service';

class EmailOrIdQueryDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string;
}

class RestoreRequestDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string;

  @IsOptional()
  @IsEmail()
  restoreEmail?: string;
}

class MergeRestoreRequestDto {
  @IsString()
  @IsNotEmpty()
  targetEmailOrId!: string;

  @IsUUID()
  backupUserId!: string;

  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

// ponytail: admin-only is enforced centrally by JwtAuthGuard (every /api/v1/admin*
// route requires the admin role) — no per-handler role checks here
@ApiTags('admin')
@Controller('api/v1/admin')
export class BackupController {
  constructor(private readonly backups: UserBackupService) {}

  @Post('backups')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start a backup of one user (rows + original bytes) to S3 (admin-only)',
    description:
      'Returns 202 with a run id. The per-file ledger uploads one original per item and ' +
      'writes manifest.json LAST; GET backups/runs/:runId reports progress and the final ' +
      'counts. A failed file retries alone and a failed run never writes a manifest.',
  })
  @ApiResponse({ status: 202, description: 'Backup run id' })
  async backup(@Body() dto: EmailOrIdQueryDto): Promise<{ runId: string }> {
    return this.backups.startBackup(dto.emailOrId);
  }

  @Post('restores')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start a restore of one user from S3 and re-enqueue derivatives (admin-only)',
    description:
      'Returns 202 with a run id. Rows commit in one transaction, then one item per original ' +
      'is downloaded and retried independently; finalize re-enqueues derivatives. A restore ' +
      'that fails is resumable by starting it again (same manifest), not a 409.',
  })
  @ApiResponse({ status: 202, description: 'Restore run id' })
  async restore(@Body() dto: RestoreRequestDto): Promise<{ runId: string }> {
    return this.backups.startRestore(dto.emailOrId, dto.restoreEmail);
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
    return this.backups.mergeUserBackup(dto);
  }

  @Get('backups/overview')
  @ApiOperation({ summary: 'Aggregated backup overview, one row per user (admin-only)' })
  @ApiResponse({ status: 200, description: 'Live asset counts joined with manifest status' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async overview(): Promise<BackupOverviewRow[]> {
    return this.backups.backupOverview();
  }

  @Get('backups/status')
  @ApiOperation({ summary: 'Backup manifest status for one user (admin-only)' })
  @ApiResponse({ status: 200, description: 'Manifest presence and row counts' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async status(@Query() query: EmailOrIdQueryDto): Promise<BackupStatus> {
    return this.backups.backupStatus(query.emailOrId);
  }

  @Get('backups/progress')
  @ApiOperation({ summary: 'Live per-file backup progress for one user (admin-only)' })
  @ApiResponse({ status: 200, description: 'In-progress flag plus per-file counters' })
  @ApiResponse({ status: 404, description: 'No user for emailOrId' })
  async progress(@Query() query: EmailOrIdQueryDto): Promise<BackupProgress> {
    return this.backups.getBackupProgress(query.emailOrId);
  }

  @Get('backups/runs/:runId')
  @ApiOperation({ summary: 'One backup/restore run: state, counters and final result' })
  @ApiResponse({ status: 200, description: 'Run status' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  async runStatus(@Param('runId', new ParseUUIDPipe()) runId: string): Promise<BackupRunStatus> {
    return this.backups.getRunStatus(runId);
  }

  @Post('backups/runs/:runId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset a failed/paused/cancelled run and process it again' })
  @ApiResponse({ status: 200, description: 'Run status after the reset' })
  @ApiResponse({ status: 409, description: 'Run is not retryable' })
  async retryRun(@Param('runId', new ParseUUIDPipe()) runId: string): Promise<BackupRunStatus> {
    return this.backups.retryRun(runId);
  }

  @Post('backups/runs/:runId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a running/paused run (in-flight files finish)' })
  @ApiResponse({ status: 200, description: 'Run status after cancellation' })
  async cancelRun(@Param('runId', new ParseUUIDPipe()) runId: string): Promise<BackupRunStatus> {
    return this.backups.cancelRun(runId);
  }

  @Delete('backups')
  @ApiOperation({ summary: 'Delete one user backup from S3 (admin-only)' })
  @ApiResponse({ status: 200, description: 'Deleted backup prefix and object count' })
  @ApiResponse({ status: 404, description: 'No backup for emailOrId' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async deleteBackup(@Query() query: EmailOrIdQueryDto): Promise<DeleteBackupResult> {
    return this.backups.deleteBackup(query.emailOrId);
  }
}
