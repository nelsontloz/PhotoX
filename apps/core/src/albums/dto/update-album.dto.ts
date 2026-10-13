import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import type { UpdateAlbumDto as IUpdateAlbumDto } from '@photox/shared-types'
import { DescriptionDto } from '../../common/title-description.dto'

export class UpdateAlbumDto extends DescriptionDto implements IUpdateAlbumDto {
  @ApiProperty({ required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string
}
