import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /api/v1/admin/backups/overview — the whole table by default, capped at 1000 rows. */
export class ListBackupOverviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @ApiProperty({ type: Number, default: 1000, required: false, maximum: 1000 })
  limit = 1000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @ApiProperty({ type: Number, default: 0, required: false })
  offset = 0;
}
