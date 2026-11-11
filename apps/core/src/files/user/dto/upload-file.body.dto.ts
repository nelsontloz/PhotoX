import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { TitleDescriptionDto } from '../../../common/title-description.dto';

export class UploadFileBodyDto extends TitleDescriptionDto {
  @IsOptional()
  @IsDateString()
  @ApiProperty({ required: false })
  takenAt?: string;
}
