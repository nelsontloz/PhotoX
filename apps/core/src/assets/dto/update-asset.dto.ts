import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength, IsDateString, IsBoolean } from 'class-validator'

export class UpdateAssetDto {
  @ApiProperty({ required: false, maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  takenAt?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean
}
