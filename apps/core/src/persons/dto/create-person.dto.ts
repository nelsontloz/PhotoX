import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsUUID, IsString, MaxLength } from 'class-validator'

export class CreatePersonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  userId?: string

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  clusterLabel!: string
}
