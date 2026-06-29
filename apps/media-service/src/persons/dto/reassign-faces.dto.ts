import { ApiProperty } from '@nestjs/swagger'
import { IsArray, ArrayMinSize, IsUUID } from 'class-validator'
import type { ReassignFacesRequest, ReassignFacesResponse } from '@photox/shared-types'

export class ReassignFacesDto implements ReassignFacesRequest {
  @ApiProperty()
  @IsUUID()
  fromPersonId!: string | null

  @ApiProperty()
  @IsUUID()
  toPersonId!: string | null

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  faceIds!: string[]
}

export class ReassignFacesResponseDto implements ReassignFacesResponse {
  @ApiProperty()
  moved!: number
}
