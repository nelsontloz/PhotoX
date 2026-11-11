import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Terminal report from the worker's storage sweep. `filesFailed > 0` makes the run `partial`
 * (rows gone, bytes left); `error` means the rows half never finished, so the run is `failed`.
 */
export class PurgeUserFinishDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @ApiProperty()
  backupPrefix!: string;

  @IsInt()
  @Min(0)
  @ApiProperty()
  filesDeleted!: number;

  @IsInt()
  @Min(0)
  @ApiProperty()
  filesFailed!: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @ApiPropertyOptional()
  firstError?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @ApiPropertyOptional()
  error?: string;
}
