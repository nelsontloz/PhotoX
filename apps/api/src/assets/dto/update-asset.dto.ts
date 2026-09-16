import { ApiProperty } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength, IsDateString, IsBoolean, IsUUID } from 'class-validator'

export class UpdateAssetDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  userId!: string

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
