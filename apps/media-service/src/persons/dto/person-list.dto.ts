import { ApiProperty } from '@nestjs/swagger'
import type { PersonDto, PersonListResponse } from '@photox/shared-types'

export class PersonListItemDto implements PersonDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  userId!: string

  @ApiProperty({ nullable: true })
  name!: string | null

  @ApiProperty({ nullable: true })
  coverFaceId!: string | null

  @ApiProperty({ nullable: true })
  // ponytail: coverFaceUrl is derived from coverFaceId at gateway level, not computed here
  coverFaceUrl!: string | null

  @ApiProperty({ nullable: true })
  clusterLabel!: string | null

  @ApiProperty()
  faceCount!: number

  @ApiProperty()
  createdAt!: string

  @ApiProperty()
  updatedAt!: string
}

export class PersonListResponseDto implements PersonListResponse {
  @ApiProperty({ type: [PersonListItemDto] })
  items!: PersonListItemDto[]

  @ApiProperty()
  total!: number

  @ApiProperty()
  limit!: number

  @ApiProperty()
  offset!: number
}
