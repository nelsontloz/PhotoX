import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { TitleDescriptionDto } from '../../common/title-description.dto'

// User-editable asset metadata. The worker's extraction fields live in WorkerMetadataDto,
// which extends this class; `transcodeFileId` stays user-reachable (viewer "use original"
// flows) with service-side ownership validation.
export class UpdateMetadataDto extends TitleDescriptionDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  transcodeFileId?: string | null
}
