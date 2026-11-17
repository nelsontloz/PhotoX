import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class FinishTransferDto {
  // 1-based BullMQ attempt number; core settles permanent vs transient from it
  @IsInt()
  @Min(1)
  @ApiProperty({ minimum: 1 })
  attempt!: number;

  @IsBoolean()
  @ApiProperty()
  ok!: boolean;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  errorMessage?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Node errno code (ENOENT, ENOSPC) or S3 error name' })
  errorCode?: string;
}
