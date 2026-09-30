import { ApiProperty } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export class UploadFileBodyDto {
  @IsOptional()
  @IsIn(['photo', 'video'])
  @ApiProperty({ enum: ['photo', 'video'], required: false })
  kind?: 'photo' | 'video'

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiProperty({ required: false })
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @ApiProperty({ required: false })
  description?: string

  @IsOptional()
  @IsDateString()
  @ApiProperty({ required: false })
  takenAt?: string
}
