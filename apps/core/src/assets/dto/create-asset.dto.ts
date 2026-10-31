import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsIn, IsOptional, IsString, IsNumber, Min, IsDateString } from 'class-validator';
import { TitleDescriptionDto } from '../../common/title-description.dto';

export class CreateAssetDto extends TitleDescriptionDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  fileId!: string;

  @ApiProperty({ enum: ['photo', 'video'] })
  @IsIn(['photo', 'video'])
  kind!: 'photo' | 'video';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  takenAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeBytes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  originalName?: string;
}
