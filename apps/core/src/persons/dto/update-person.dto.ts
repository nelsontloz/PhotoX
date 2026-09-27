import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength } from 'class-validator'
import type { UpdatePersonRequest } from '@photox/shared-types'

export class UpdatePersonDto implements UpdatePersonRequest {
  @ApiProperty({ required: true })
  @IsString()
  @MaxLength(80)
  name!: string | null
}
