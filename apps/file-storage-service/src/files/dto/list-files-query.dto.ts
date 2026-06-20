import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import type { FileListResponse } from '@photox/shared-types'
import { FileSummaryDto } from './file-summary.dto'

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
  @ApiProperty({ required: false, description: 'MIME type prefix filter, e.g. image/*' })
  mimeType?: string
}

export class FileListResponseDto implements FileListResponse {
  @ApiProperty({ type: [FileSummaryDto] })
  items!: FileSummaryDto[]

  @ApiProperty()
  total!: number

  @ApiProperty()
  limit!: number

  @ApiProperty()
  offset!: number
}
