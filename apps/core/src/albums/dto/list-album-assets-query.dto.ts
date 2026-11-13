import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/pagination-query.dto';

export class ListAlbumAssetsQueryDto extends PaginationQueryDto {
  // cap stays 100 (base allows 1000) — same Asset payload as GET /api/v1/assets, so the same cap
  @ApiProperty({ type: Number, required: false, default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  override limit = 20;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiProperty({
    required: false,
    description:
      'Opaque cursor from a previous page (nextCursor). Replaces offset so an add mid-scroll ' +
      'cannot repeat or skip rows.',
  })
  cursor?: string;
}
