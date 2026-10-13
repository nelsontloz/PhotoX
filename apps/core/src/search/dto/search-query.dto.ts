import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsString, Length, Max, Min } from 'class-validator'
import { PaginationQueryDto } from '../../common/pagination-query.dto'

export class SearchQueryDto extends PaginationQueryDto {
  @ApiProperty({ minLength: 1, maxLength: 200, description: 'Search text' })
  @IsString()
  @Length(1, 200)
  q!: string

  // cap stays 100 (base allows 1000) — base validators merge with these, stricter wins
  @ApiProperty({ required: false, default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  override limit = 20
}
