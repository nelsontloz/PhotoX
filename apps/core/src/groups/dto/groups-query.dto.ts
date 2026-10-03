import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

export class DuplicatesQueryDto {
  @ApiProperty({ required: false, default: 10, maximum: 64, description: 'Max Hamming distance' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(64)
  threshold?: number
}

export class SimilarQueryDto {
  @ApiProperty({ required: false, default: 12, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}

export class EventsQueryDto {
  @ApiProperty({ required: false, default: 3, description: 'Max days between photos in a group' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  gapDays?: number

  @ApiProperty({ required: false, default: 50, maximum: 100, description: 'Max groups' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
