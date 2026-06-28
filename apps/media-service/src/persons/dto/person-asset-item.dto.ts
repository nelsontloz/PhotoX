import { ApiProperty } from '@nestjs/swagger'
import type { PersonAssetItem } from '@photox/shared-types'

export class PersonAssetItemDto implements PersonAssetItem {
  @ApiProperty()
  assetId!: string

  @ApiProperty()
  faceId!: string

  @ApiProperty({ nullable: true })
  thumbnailUrl!: string | null

  @ApiProperty()
  uploadedAt!: string

  @ApiProperty()
  faceCount!: number
}
