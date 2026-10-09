import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import type { UpdatePersonRequest } from '@photox/shared-types'

export class UpdatePersonDto implements UpdatePersonRequest {
  @ApiProperty({ required: true, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name!: string | null
}
