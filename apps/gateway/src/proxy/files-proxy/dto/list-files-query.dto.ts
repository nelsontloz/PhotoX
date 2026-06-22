import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class ListFilesQueryDto {
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
  @IsString()
  @ApiProperty({ required: false, description: 'MIME type prefix filter' })
  mimeType?: string
}
