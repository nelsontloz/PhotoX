import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsDateString, IsBoolean } from 'class-validator';
import { TitleDescriptionDto } from '../../common/title-description.dto';

export class UpdateAssetDto extends TitleDescriptionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  takenAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;
}
