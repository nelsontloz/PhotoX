import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength, IsOptional } from 'class-validator'
import type { UpdateAlbumDto as IUpdateAlbumDto } from '@photox/shared-types'

export class UpdateAlbumDto implements IUpdateAlbumDto {
  @ApiProperty({ required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string
}
