import { ApiProperty } from '@nestjs/swagger'
import {
  IsUUID,
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  MaxLength,
  IsDateString,
} from 'class-validator'

export class CreateAssetDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  userId!: string

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  fileId!: string

  @ApiProperty({ enum: ['photo', 'video'] })
  @IsIn(['photo', 'video'])
  kind!: 'photo' | 'video'

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
  @IsString()
  mimeType?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeBytes?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  originalName?: string
}
