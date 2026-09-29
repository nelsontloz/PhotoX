import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import type { ListAlbumsQueryDto as IListAlbumsQueryDto } from '@photox/shared-types'

export class ListAlbumsQueryDto implements IListAlbumsQueryDto {
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
