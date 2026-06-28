import { ApiProperty } from '@nestjs/swagger'
import { IsUUID, IsString, MaxLength } from 'class-validator'

export class CreatePersonDto {
  @ApiProperty()
  @IsUUID()
  userId!: string

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  clusterLabel!: string
}
