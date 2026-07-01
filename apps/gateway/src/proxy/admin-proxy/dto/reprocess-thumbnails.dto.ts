import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'

export class ReprocessThumbnailsDto {
  @ApiProperty({ enum: ['photo', 'video'] })
  @IsIn(['photo', 'video'])
  kind!: 'photo' | 'video'

  @ApiPropertyOptional({ description: 'Reprocess a single asset by ID instead of all of kind' })
  @IsOptional()
  @IsString()
  assetId?: string
}
