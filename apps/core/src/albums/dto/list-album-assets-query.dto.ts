import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination-query.dto';

export class ListAlbumAssetsQueryDto extends PaginationQueryDto {
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
