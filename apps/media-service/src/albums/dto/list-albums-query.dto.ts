import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsUUID, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import type { ListAlbumsQueryDto as IListAlbumsQueryDto } from '@photox/shared-types'

export class ListAlbumsQueryDto implements IListAlbumsQueryDto {
  @IsUUID()
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  userId!: string

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @ApiProperty({ default: 20, required: false })
  limit?: number

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @ApiProperty({ default: 0, required: false })
  offset?: number
}
