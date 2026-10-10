import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

// ponytail: the albums + persons list endpoints share this exact limit/offset contract
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(1000)
  @ApiProperty({ default: 20, required: false, maximum: 1000 })
  limit?: number

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @ApiProperty({ default: 0, required: false })
  offset?: number
}
