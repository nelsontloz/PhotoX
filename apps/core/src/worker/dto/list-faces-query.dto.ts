import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { isQueryTrue } from '../../common/query-params'

// ponytail: cursor is the last seen face id (keyset over id ASC); nextCursor=null ends the walk.
// limit/cursor both absent keeps the deprecated unpaginated { items } fallback in the controller.
export class ListFacesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  @ApiProperty({ required: false, default: 500, maximum: 1000 })
  limit?: number

  @IsOptional()
  @IsUUID('4')
  @ApiProperty({ required: false, description: 'Last seen face id; page starts after it' })
  cursor?: string

  @IsOptional()
  @Transform(({ value }) => isQueryTrue(value))
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  includeEmbeddings?: boolean

  @IsOptional()
  @Transform(({ value }) => isQueryTrue(value))
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  excludeTrashed?: boolean
}
