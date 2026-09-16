import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class CoverPersonDto {
  @ApiProperty()
  @IsUUID()
  userId!: string

  @ApiProperty()
  @IsUUID()
  faceId!: string
}
