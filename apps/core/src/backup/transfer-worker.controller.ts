import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TransferClaimResponse, TransferFailResponse } from '@photox/shared-types';
import { CurrentUserId } from '../auth/jwt-auth.guard';
import { TransferClaimDto, TransferCompleteDto, TransferFailDto } from './dto/transfer.dto';
import { UserBackupService } from './user-backup.service';

/**
 * Worker half of the backup/restore executor. The worker owns the bytes (it holds STORAGE_DIR
 * and the backup S3 store); these routes own the ledger — claim one item, then report success
 * or failure. Same act + X-Job-Signature binding as every /worker route, and every target is
 * pinned to the token's own user by the service (a foreign run is a 403, never a silent no-op).
 */
@ApiTags('worker')
@Controller('worker/backups/transfers')
export class TransferWorkerController {
  constructor(private readonly backups: UserBackupService) {}

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim one backup/restore ledger item for a worker job' })
  async claim(
    @CurrentUserId() userId: string,
    @Body() dto: TransferClaimDto,
  ): Promise<TransferClaimResponse> {
    const claimed = await this.backups.claimTransfer(
      dto.kind,
      dto.runId,
      dto.itemId,
      dto.attempt,
      userId,
    );
    if (!claimed) return { claimed: false };
    return {
      claimed: true,
      fileId: claimed.item.fileId,
      storageKey: claimed.item.storageKey,
      s3Key: claimed.item.s3Key,
      mimeType: claimed.item.mimeType,
      checksumSha256: claimed.item.checksumSha256,
    };
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a finished backup/restore item (idempotent)' })
  async complete(
    @CurrentUserId() userId: string,
    @Body() dto: TransferCompleteDto,
  ): Promise<{ ok: true }> {
    await this.backups.completeTransfer(dto.runId, dto.itemId, userId);
    return { ok: true };
  }

  @Post('fail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a failed backup/restore attempt; retry=true means throw' })
  async fail(
    @CurrentUserId() userId: string,
    @Body() dto: TransferFailDto,
  ): Promise<TransferFailResponse> {
    return { retry: await this.backups.failTransfer(dto.kind, dto.runId, dto.itemId, dto, userId) };
  }
}
