import { ApiProperty } from '@nestjs/swagger'
import type { FileRecord } from '@photox/shared-types'

export class FileRecordDto implements FileRecord {
  @ApiProperty()
  id!: string

  @ApiProperty()
  userId!: string

  @ApiProperty()
  storageKey!: string

  @ApiProperty()
  originalName!: string

  @ApiProperty()
  mimeType!: string

  @ApiProperty()
  sizeBytes!: number

  @ApiProperty()
  checksumSha256!: string

  @ApiProperty()
  createdAt!: string
}
