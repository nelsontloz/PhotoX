import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsDate,
  IsObject,
} from 'class-validator'
import { TitleDescriptionDto } from '../../common/title-description.dto'

// Worker-only extraction payload (act-required `PATCH worker/assets/:id/metadata`). Every field
// is optional; transcodeFileId keeps the same ownership rule as the in-app viewer flows.
export class WorkerMetadataDto extends TitleDescriptionDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  transcodeFileId?: string | null

  @ApiProperty({ enum: ['pending', 'ready', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'ready', 'failed'])
  status?: 'pending' | 'ready' | 'failed'

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  takenAt?: Date

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  mimeType?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  sizeBytes?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  originalName?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  width?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  height?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  durationSeconds?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  fps?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  codec?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  hasAudio?: boolean

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cameraMake?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cameraModel?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  lensModel?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  orientation?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  iso?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  fNumber?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  exposureTime?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  focalLength?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  // no @Min(0): GPS altitude is legitimately negative (below sea level)
  altitude?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>

  @ApiProperty({ required: false, enum: ['pending', 'ready', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'ready', 'failed'])
  transcodeStatus?: 'pending' | 'ready' | 'failed'

  @ApiProperty({ required: false, enum: ['pending', 'ready', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'ready', 'failed'])
  thumbnailStatus?: 'pending' | 'ready' | 'failed' | null

  @ApiProperty({ required: false, enum: ['pending', 'ready', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'ready', 'failed'])
  faceStatus?: 'pending' | 'ready' | 'failed' | null

  @ApiProperty({ required: false, enum: ['pending', 'ready', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'ready', 'failed'])
  embeddingStatus?: 'pending' | 'ready' | 'failed' | null

  @ApiProperty({
    required: false,
    nullable: true,
    description: '64-bit dHash as 16 lowercase hex chars (duplicate detection)',
  })
  @IsOptional()
  @IsString()
  phash?: string | null

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  faceCount?: number | null
}
