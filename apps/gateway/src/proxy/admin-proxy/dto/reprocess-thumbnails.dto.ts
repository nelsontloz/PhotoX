import { ApiProperty } from '@nestjs/swagger'
import { IsIn } from 'class-validator'

export class ReprocessThumbnailsDto {
  @ApiProperty({ enum: ['photo', 'video'] })
  @IsIn(['photo', 'video'])
  kind!: 'photo' | 'video'
}
