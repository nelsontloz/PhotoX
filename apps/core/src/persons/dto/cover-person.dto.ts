import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsUUID } from 'class-validator'

export class CoverPersonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  userId?: string

  @ApiProperty()
  @IsUUID()
  faceId!: string
}
