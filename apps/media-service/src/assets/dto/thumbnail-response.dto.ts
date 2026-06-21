import { ApiProperty } from '@nestjs/swagger'
import type { AssetThumbnail } from '@photox/shared-types'

export class ThumbnailResponseDto implements AssetThumbnail {
  @ApiProperty({ example: 'sm' })
  size!: string

  @ApiProperty()
  fileId!: string

  @ApiProperty()
  width!: number

  @ApiProperty()
  height!: number

  @ApiProperty()
  bytes!: number

  @ApiProperty()
  createdAt!: string
}
