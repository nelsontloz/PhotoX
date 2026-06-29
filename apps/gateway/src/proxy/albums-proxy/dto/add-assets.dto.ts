import { ApiProperty } from '@nestjs/swagger'
import { IsArray, ArrayMaxSize, IsUUID } from 'class-validator'
import type { AddAssetsToAlbumDto as IAddAssetsToAlbumDto } from '@photox/shared-types'

export class AddAssetsToAlbumDto implements IAddAssetsToAlbumDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  assetIds!: string[]
}
