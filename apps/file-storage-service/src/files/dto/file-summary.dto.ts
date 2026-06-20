import { ApiProperty } from '@nestjs/swagger'
import type { FileSummary } from '@photox/shared-types'

export class FileSummaryDto implements FileSummary {
  @ApiProperty()
  id!: string

  @ApiProperty()
  userId!: string

  @ApiProperty()
  originalName!: string

  @ApiProperty()
  mimeType!: string

  @ApiProperty()
  sizeBytes!: number

  @ApiProperty()
  createdAt!: string
}
