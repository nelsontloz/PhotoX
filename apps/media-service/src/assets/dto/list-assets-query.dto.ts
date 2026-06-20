import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, Min, Max, IsIn, IsDateString, IsBoolean } from 'class-validator'
import { Type } from 'class-transformer'

export class ListAssetsQueryDto {
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
  @IsIn(['photo', 'video'])
  @ApiProperty({ enum: ['photo', 'video'], required: false })
  kind?: 'photo' | 'video'

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'MIME type prefix filter, e.g. image/*' })
  mimeType?: string

  @IsOptional()
  @Type(() => Boolean)
  @ApiProperty({ default: false, required: false })
  isTrashed?: boolean

  @IsOptional()
  @IsDateString()
  @ApiProperty({ required: false, description: 'Filter by takenAt (falls back to uploadedAt)' })
  fromDate?: string

  @IsOptional()
  @IsDateString()
  @ApiProperty({ required: false })
  toDate?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  @ApiProperty({ required: false })
  favorite?: boolean

  @IsOptional()
  @IsIn(['pending', 'ready', 'failed'])
  @ApiProperty({ enum: ['pending', 'ready', 'failed'], required: false })
  metadataStatus?: 'pending' | 'ready' | 'failed'
}
