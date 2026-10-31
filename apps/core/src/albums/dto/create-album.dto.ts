import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import type { CreateAlbumDto as ICreateAlbumDto } from '@photox/shared-types';
import { DescriptionDto } from '../../common/title-description.dto';

export class CreateAlbumDto extends DescriptionDto implements ICreateAlbumDto {
  @ApiProperty({ example: 'Summer 2026', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}
