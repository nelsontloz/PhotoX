import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import type { TransferKind } from '@photox/shared-types';

/** The worker's 1-based BullMQ attempt is the only retry state core cannot derive itself. */
export class TransferClaimDto {
  @IsUUID()
  @ApiProperty()
  runId!: string;

  @IsUUID()
  @ApiProperty()
  itemId!: string;

  @IsIn(['backup', 'restore'])
  @ApiProperty({ enum: ['backup', 'restore'] })
  kind!: TransferKind;

  @IsInt()
  @Min(1)
  @ApiProperty()
  attempt!: number;
}

export class TransferCompleteDto {
  @IsUUID()
  @ApiProperty()
  runId!: string;

  @IsUUID()
  @ApiProperty()
  itemId!: string;
}

/** Failure facts from the worker process — no Error object crosses the wire. */
export class TransferFailDto {
  @IsUUID()
  @ApiProperty()
  runId!: string;

  @IsUUID()
  @ApiProperty()
  itemId!: string;

  @IsIn(['backup', 'restore'])
  @ApiProperty({ enum: ['backup', 'restore'] })
  kind!: TransferKind;

  @IsString()
  @MaxLength(512)
  @ApiProperty()
  message!: string;

  /** Node errno (ENOSPC/EACCES/ENOENT) — decides pause vs missing. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @ApiPropertyOptional()
  code?: string;

  /** S3 error name (NotFound/NoSuchKey) — decides a restore item is permanently missing. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiPropertyOptional()
  errorName?: string;

  @IsInt()
  @Min(1)
  @ApiProperty()
  attempt!: number;

  @IsInt()
  @Min(1)
  @ApiProperty()
  maxAttempts!: number;
}
