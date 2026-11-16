import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { parseQueryBooleanParam } from '../../common/query-params';

/** `GET /api/v1/assets/:id/content` — the variant decision is the server's, `v` is a cache-buster. */
export class AssetContentQueryDto {
  @IsOptional()
  @IsIn(['display', 'original'])
  @ApiProperty({
    required: false,
    enum: ['display', 'original'],
    default: 'display',
    description:
      'display: the bytes to show/play (the webm transcode once the worker produced one); ' +
      'original: the uploaded bytes.',
  })
  variant?: 'display' | 'original';

  @IsOptional()
  @Transform(parseQueryBooleanParam)
  @IsBoolean()
  @ApiProperty({
    required: false,
    default: false,
    description: 'Send Content-Disposition: attachment (the download action, not playback).',
  })
  download?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiProperty({
    required: false,
    description:
      'Cache token from Asset.contentVersion. Only a browser cache key — the route resolves bytes ' +
      'from the path and ignores this value, so a stale token can never select different bytes.',
  })
  v?: string;
}
