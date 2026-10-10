import { ApiProperty } from '@nestjs/swagger'
import {
  IsOptional,
  Min,
  Max,
  IsISO8601,
  IsBoolean,
  IsUUID,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator'
import { Transform, Type } from 'class-transformer'
import { isQueryTrue } from '../../common/query-params'

export class ListAssetsQueryDto {
  @IsOptional()
  @Transform(({ value }): string[] =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  @ApiProperty({
    required: false,
    type: String,
    example: 'uuid1,uuid2',
    description: 'Comma-separated asset IDs. Maximum 100.',
  })
  ids?: string[]

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

  @IsOptional()
  @Transform(({ value }) => isQueryTrue(value))
  @IsBoolean()
  @ApiProperty({ default: false, required: false })
  isTrashed?: boolean

  @IsOptional()
  @IsISO8601()
  @ApiProperty({
    required: false,
    example: '2026-06-01T00:00:00.000Z',
    description: 'Half-open range start (inclusive) on COALESCE(takenAt, uploadedAt)',
  })
  dateFrom?: string

  @IsOptional()
  @IsISO8601()
  @ApiProperty({
    required: false,
    example: '2026-07-01T00:00:00.000Z',
    description: 'Half-open range end (exclusive) on COALESCE(takenAt, uploadedAt)',
  })
  dateTo?: string

  @IsOptional()
  @Transform(({ value }) => isQueryTrue(value))
  @IsBoolean()
  @ApiProperty({ required: false })
  favorite?: boolean

  @IsOptional()
  @Transform(({ value }) => isQueryTrue(value))
  @IsBoolean()
  @ApiProperty({ required: false, description: 'Filter to only assets with GPS coordinates' })
  hasLocations?: boolean

  @IsOptional()
  @IsUUID('4')
  @ApiProperty({
    required: false,
    description: 'Filter to assets containing a face assigned to this person',
  })
  personId?: string

  @IsOptional()
  @IsUUID('4')
  @ApiProperty({ required: false, description: 'Filter to assets in this album' })
  albumId?: string
}
