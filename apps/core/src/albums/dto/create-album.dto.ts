import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import type { CreateAlbumDto as ICreateAlbumDto } from '@photox/shared-types';
import { DescriptionDto } from '../../common/title-description.dto';

export class CreateAlbumDto extends DescriptionDto implements ICreateAlbumDto {
  @ApiProperty({ example: 'Summer 2026', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ required: false, description: 'Hide this album from the timeline' })
  @IsOptional()
  @IsBoolean()
  hiddenFromTimeline?: boolean;
}
