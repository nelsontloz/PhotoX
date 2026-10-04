import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'

export class SearchQueryDto {
  @ApiProperty({ minLength: 1, maxLength: 200, description: 'Search text' })
  @IsString()
  @Length(1, 200)
  q!: string

  // caps mirror ListAssetsQueryDto
  @ApiProperty({ required: false, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number
}
