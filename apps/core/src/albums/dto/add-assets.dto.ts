import { ApiProperty } from '@nestjs/swagger'
import { IsArray, ArrayMaxSize, IsUUID } from 'class-validator'
import type { AddAssetsToAlbumDto as IAddAssetsToAlbumDto } from '@photox/shared-types'

export class AddAssetsBodyDto implements IAddAssetsToAlbumDto {
  @ApiProperty({ type: [String], example: ['550e8400-e29b-41d4-a716-446655440000'] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  assetIds!: string[]
}
