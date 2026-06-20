import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsString } from 'class-validator'
import type { BatchFilesResponse } from '@photox/shared-types'
import { FileRecordDto } from './file-record.dto'

export class BatchFilesRequestDto {
  @IsArray()
  @IsString({ each: true })
  @ApiProperty({ type: [String] })
  fileIds!: string[]
}

export class BatchFilesResponseDto implements BatchFilesResponse {
  @ApiProperty({ type: [FileRecordDto] })
  items!: FileRecordDto[]

  @ApiProperty({ type: [String] })
  missing!: string[]
}
