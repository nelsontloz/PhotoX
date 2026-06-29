import { ApiProperty } from '@nestjs/swagger'
import { IsArray, ArrayMinSize, IsUUID } from 'class-validator'
import type { ReassignFacesRequest } from '@photox/shared-types'

export class ReassignFacesDto implements Omit<ReassignFacesRequest, 'fromPersonId'> {
  @ApiProperty()
  @IsUUID()
  toPersonId!: string | null

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  faceIds!: string[]
}
