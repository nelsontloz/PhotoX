import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class ListUserAssetsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @ApiProperty({ default: 100, required: false })
  limit?: number

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @ApiProperty({ default: 0, required: false })
  offset?: number
}
