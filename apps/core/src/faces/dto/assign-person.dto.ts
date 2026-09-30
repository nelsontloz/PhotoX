import { ApiProperty } from '@nestjs/swagger'
import { IsUUID, IsOptional } from 'class-validator'

export class AssignPersonDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  personId!: string | null
}
