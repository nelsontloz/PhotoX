import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { TitleDescriptionDto } from '../../common/title-description.dto'

// Extraction-produced fields (worker-only). A non-act caller sending any of these to the user
// metadata endpoint gets 403 in JwtAuthGuard — the whitelist would only 400 them, hiding a
// worker-contract violation. `transcodeFileId` stays user-reachable (viewer "use original"
// flows) with service-side ownership validation.
export const WORKER_ONLY_METADATA_KEYS = [
  'status',
  'takenAt',
  'mimeType',
  'sizeBytes',
  'originalName',
  'width',
  'height',
  'durationSeconds',
  'fps',
  'codec',
  'hasAudio',
  'cameraMake',
  'cameraModel',
  'lensModel',
  'orientation',
  'iso',
  'fNumber',
  'exposureTime',
  'focalLength',
  'latitude',
  'longitude',
  'altitude',
  'metadata',
  'transcodeStatus',
  'thumbnailStatus',
  'faceStatus',
  'embeddingStatus',
  'phash',
  'faceCount',
] as const

export class UpdateMetadataDto extends TitleDescriptionDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  transcodeFileId?: string | null
}
