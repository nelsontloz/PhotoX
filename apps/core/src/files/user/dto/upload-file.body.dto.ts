import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { TitleDescriptionDto } from '../../../common/title-description.dto';

export class UploadFileBodyDto extends TitleDescriptionDto {
  /**
   * @deprecated Accepted but ignored — kind is derived solely from the sniffed mime
   * (kindFromMime) so a mismatched client value can never route bytes down the wrong
   * pipeline. Kept so live web clients still sending `kind` don't 400 under
   * ValidationPipe(forbidNonWhitelisted); the web follow-up stops sending it.
   */
  @IsOptional()
  @IsIn(['photo', 'video'])
  @ApiProperty({ enum: ['photo', 'video'], required: false })
  kind?: 'photo' | 'video';

  @IsOptional()
  @IsDateString()
  @ApiProperty({ required: false })
  takenAt?: string;
}
