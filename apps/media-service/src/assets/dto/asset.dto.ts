import { ApiProperty } from '@nestjs/swagger'
import type { Asset } from '@photox/shared-types'

export class AssetDto implements Asset {
  @ApiProperty()
  id!: string

  @ApiProperty()
  userId!: string

  @ApiProperty({ enum: ['photo', 'video'] })
  kind!: 'photo' | 'video'

  @ApiProperty()
  fileId!: string

  @ApiProperty()
  uploadedAt!: string

  @ApiProperty()
  isTrashed!: boolean

  @ApiProperty({ required: false, nullable: true })
  trashedAt!: string | null

  @ApiProperty({ required: false, nullable: true })
  title!: string | null

  @ApiProperty({ required: false, nullable: true })
  description!: string | null

  @ApiProperty({ required: false, nullable: true })
  takenAt!: string | null

  @ApiProperty()
  favorite!: boolean

  @ApiProperty({ required: false, nullable: true })
  mimeType!: string | null

  @ApiProperty({ required: false, nullable: true })
  sizeBytes!: number | null

  @ApiProperty({ required: false, nullable: true })
  originalName!: string | null

  @ApiProperty({ required: false, nullable: true })
  width!: number | null

  @ApiProperty({ required: false, nullable: true })
  height!: number | null

  @ApiProperty({ required: false, nullable: true })
  durationSeconds!: number | null

  @ApiProperty({ required: false, nullable: true })
  cameraMake!: string | null

  @ApiProperty({ required: false, nullable: true })
  cameraModel!: string | null

  @ApiProperty({ required: false, nullable: true })
  orientation!: number | null

  @ApiProperty({ required: false, nullable: true })
  latitude!: number | null

  @ApiProperty({ required: false, nullable: true })
  longitude!: number | null

  @ApiProperty({ required: false, nullable: true })
  fps!: number | null

  @ApiProperty({ required: false, nullable: true })
  codec!: string | null

  @ApiProperty({ required: false, nullable: true })
  hasAudio!: boolean | null

  @ApiProperty({ enum: ['pending', 'ready', 'failed'] })
  metadataStatus!: 'pending' | 'ready' | 'failed'

  @ApiProperty({ required: false, nullable: true })
  metadataExtractedAt!: string | null
}
