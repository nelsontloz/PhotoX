import { ApiProperty } from '@nestjs/swagger'
import type { PersonAssetsResponse } from '@photox/shared-types'
import { PersonAssetItemDto } from './person-asset-item.dto'

export class PersonAssetsResponseDto implements PersonAssetsResponse {
  @ApiProperty()
  personId!: string

  @ApiProperty({ type: [PersonAssetItemDto] })
  items!: PersonAssetItemDto[]

  @ApiProperty()
  total!: number

  @ApiProperty()
  limit!: number

  @ApiProperty()
  offset!: number
}
