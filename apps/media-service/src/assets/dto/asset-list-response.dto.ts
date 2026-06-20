import { ApiProperty } from '@nestjs/swagger'
import type { AssetListResponse } from '@photox/shared-types'
import { AssetDto } from './asset.dto'

export class AssetListResponseDto implements AssetListResponse {
  @ApiProperty({ type: [AssetDto] })
  items!: AssetDto[]

  @ApiProperty()
  total!: number

  @ApiProperty()
  limit!: number

  @ApiProperty()
  offset!: number
}
