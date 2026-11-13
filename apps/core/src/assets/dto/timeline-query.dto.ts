import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { isQueryTrue } from '../../common/query-params';

// The timeline is two resources (a month index and a window page), so it gets two DTOs:
// `forbidNonWhitelisted` is global, which makes a param from the other family a 400 instead of
// the silently-ignored parameter the old shared LayoutQueryDto accepted.
class TimelineFilterDto {
  @IsOptional()
  @IsUUID('4')
  @ApiProperty({ required: false, description: 'Filter to assets containing this person' })
  personId?: string;

  @IsOptional()
  @Transform(({ value }) => isQueryTrue(value))
  @IsBoolean()
  @ApiProperty({ required: false })
  favorite?: boolean;

  @IsOptional()
  @IsUUID('4')
  @ApiProperty({ required: false, description: 'Filter to assets in this album' })
  albumId?: string;
}

/** `GET /api/v1/timeline/index` — the revalidation call, local calendar months in `tz`. */
export class TimelineIndexQueryDto extends TimelineFilterDto {
  @IsOptional()
  @Matches(/^[A-Za-z0-9_+\-/]{1,64}$/)
  @ApiProperty({ required: false, example: 'Europe/Madrid', description: 'IANA timezone' })
  tz?: string;
}

/** `GET /api/v1/timeline/window` — one page of one window; `from`/`to` are echoed from the index. */
export class TimelineWindowQueryDto extends TimelineFilterDto {
  @IsISO8601()
  @ApiProperty({ example: '2024-03-01T00:00:00.000Z', description: 'Window start (inclusive)' })
  from!: string;

  @IsISO8601()
  @ApiProperty({ example: '2024-04-01T00:00:00.000Z', description: 'Window end (exclusive)' })
  to!: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @ApiProperty({ default: 0, required: false, description: 'Row index inside this window' })
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(5000)
  @ApiProperty({ default: 2000, required: false })
  limit?: number;
}
