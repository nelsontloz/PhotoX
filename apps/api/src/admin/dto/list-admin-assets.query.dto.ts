import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsOptional, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class ListAdminAssetsQueryDto {
  @ApiProperty({ enum: ['photo', 'video'], required: true })
  @IsIn(['photo', 'video'])
  kind!: 'photo' | 'video'

  @ApiProperty({ default: 200, required: false, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(500)
  limit?: number

  @ApiProperty({ default: 0, required: false })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  offset?: number
}
