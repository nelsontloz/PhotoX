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
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import type { Page } from '@photox/shared-types';
import { PaginationQueryDto } from '../common/pagination-query.dto';
import { setResourceLocation } from '../common/resource-headers';
import {
  UserBackupService,
  type BackupOverviewRow,
  type BackupProgress,
  type BackupRunStatus,
  type BackupStatus,
  type DeleteBackupResult,
  type MergeBackupResult,
} from './user-backup.service';
import {
  BackupOverviewPageModel,
  BackupProgressModel,
  BackupRunStatusModel,
  BackupStatusModel,
  DeleteBackupResultModel,
  MergeBackupResultModel,
  RunIdResponseModel,
} from '../swagger/response-models';

class EmailOrIdQueryDto {
  @IsString()
  @IsNotEmpty()
  emailOrId!: string;
}

class ListBackupOverviewQueryDto extends PaginationQueryDto {
  // cap stays 200 (base allows 1000): one row per user, each backed by an S3 manifest probe
  @ApiProperty({ type: 'integer', required: false, default: 50, maximum: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  override limit = 50;
}

class RestoreByKeyDto {
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
  @ApiResponse({ status: 202, description: 'Backup run id', type: RunIdResponseModel })
  async backup(
    @Body() dto: EmailOrIdQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ runId: string }> {
    const { runId } = await this.backups.startBackup(dto.emailOrId);
    setResourceLocation(res, `/api/v1/admin/backups/runs/${runId}`, 2);
    return { runId };
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
  @ApiResponse({
    status: 200,
    description: 'Merge counts, dedupe/skip totals and jobs enqueued',
    type: MergeBackupResultModel,
  })
  @ApiResponse({ status: 404, description: 'Target user or source backup not found' })
  @ApiResponse({
    status: 409,
    description: 'Email mismatch, live source, already merged or id conflict',
  })
  @ApiResponse({ status: 413, description: 'Storage quota exceeded (retry with force)' })
  @ApiResponse({ status: 422, description: 'Backup manifest corrupt' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async merge(@Body() dto: MergeRestoreRequestDto): Promise<MergeBackupResult> {
    return this.backups.mergeUserBackup(dto);
  }

  @Get('backups/overview')
  @ApiOperation({ summary: 'Aggregated backup overview, one row per user (admin-only)' })
  @ApiResponse({
    status: 200,
    description: 'Live asset counts joined with manifest status',
    type: BackupOverviewPageModel,
  })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async overview(@Query() q: ListBackupOverviewQueryDto): Promise<Page<BackupOverviewRow>> {
    // ponytail: the page slices the assembled view, so every request still probes every manifest.
    // `total` stays exact; page the user query + orphan dirs only if the account count outgrows
    // the client's 30s timeout.
    const all = await this.backups.backupOverview();
    return { items: all.slice(q.offset, q.offset + q.limit), total: all.length };
  }

  @Get('backups/runs/:runId')
  @ApiOperation({ summary: 'One backup/restore run: state, counters and final result' })
  @ApiResponse({ status: 200, description: 'Run status', type: BackupRunStatusModel })
  @ApiResponse({ status: 404, description: 'Run not found' })
  async runStatus(@Param('runId', new ParseUUIDPipe()) runId: string): Promise<BackupRunStatus> {
    return this.backups.getRunStatus(runId);
  }

  // --- keyed backup resource -------------------------------------------------------------
  // A backup outlives its account, so the key is a user id or (for a deleted account) its
  // email — the manifest prefix is `backups/<email>__<userId>/`. Keyed routes are declared
  // after the literals above so `overview`/`status`/`progress`/`runs` are never read as a key.

  @Get('backups/:key')
  @ApiOperation({ summary: 'Backup manifest status for one account (admin-only)' })
  @ApiResponse({
    status: 200,
    description: 'Manifest presence and row counts',
    type: BackupStatusModel,
  })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async statusByKey(@Param('key') key: string): Promise<BackupStatus> {
    return this.backups.backupStatus(key);
  }

  @Get('backups/:key/progress')
  @ApiOperation({ summary: 'Live per-file backup progress for one account (admin-only)' })
  @ApiResponse({
    status: 200,
    description: 'In-progress flag plus per-file counters',
    type: BackupProgressModel,
  })
  @ApiResponse({ status: 404, description: 'No account for key' })
  async progressByKey(@Param('key') key: string): Promise<BackupProgress> {
    return this.backups.getBackupProgress(key);
  }

  @Post('backups/:key/restores')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Restore one account backup into a live account (admin-only)',
    description:
      'Same durable run as the rest of the backup surface, addressed by the backup it restores: ' +
      '`restoreEmail` re-homes the snapshot into that new account when the original is gone.',
  })
  @ApiResponse({ status: 202, description: 'Restore run id', type: RunIdResponseModel })
  async restoreByKey(
    @Param('key') key: string,
    @Body() dto: RestoreByKeyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ runId: string }> {
    const { runId } = await this.backups.startRestore(key, dto.restoreEmail);
    setResourceLocation(res, `/api/v1/admin/backups/runs/${runId}`, 2);
    return { runId };
  }

  @Delete('backups/:key')
  @ApiOperation({ summary: 'Delete one account backup from S3 (admin-only)' })
  @ApiResponse({
    status: 200,
    description: 'Deleted backup prefix and object count',
    type: DeleteBackupResultModel,
  })
  @ApiResponse({ status: 404, description: 'No backup for key' })
  @ApiResponse({ status: 503, description: 'Backup storage (S3) unreachable' })
  async deleteByKey(@Param('key') key: string): Promise<DeleteBackupResult> {
    return this.backups.deleteBackup(key);
  }
}
