import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** GET /api/v1/shares — keyset page over (createdAt, id) DESC; nextCursor=null ends the walk. */
export class ListSharesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @ApiProperty({ type: Number, required: false, default: 20, maximum: 200 })
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiProperty({ required: false, description: 'Opaque cursor from a previous page (nextCursor)' })
  cursor?: string;
}

/** GET /api/share/:token/assets — keyset page over (addedAt, assetId) DESC. */
export class ListPublicAlbumAssetsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @ApiProperty({ type: Number, required: false, default: 100, maximum: 500 })
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiProperty({ required: false, description: 'Opaque cursor from a previous page (nextCursor)' })
  cursor?: string;
}
