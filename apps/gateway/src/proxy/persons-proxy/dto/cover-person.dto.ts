import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class CoverPersonDto {
  @ApiProperty()
  @IsUUID()
  faceId!: string
}
