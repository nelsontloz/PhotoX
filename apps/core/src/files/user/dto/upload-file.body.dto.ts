import { ApiProperty } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional } from 'class-validator'
import { TitleDescriptionDto } from '../../../common/title-description.dto'

export class UploadFileBodyDto extends TitleDescriptionDto {
  @IsOptional()
  @IsIn(['photo', 'video'])
  @ApiProperty({ enum: ['photo', 'video'], required: false })
  kind?: 'photo' | 'video'

  @IsOptional()
  @IsDateString()
  @ApiProperty({ required: false })
  takenAt?: string
}
