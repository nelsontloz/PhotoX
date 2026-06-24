import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsDate,
  IsObject,
  Min,
} from 'class-validator'

export class UpdateMetadataDto {
  @ApiProperty({ enum: ['pending', 'ready', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'ready', 'failed'])
  status?: 'pending' | 'ready' | 'failed'

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  takenAt?: Date

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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  width?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  height?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  durationSeconds?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fps?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  codec?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  hasAudio?: boolean

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cameraMake?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cameraModel?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  lensModel?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  orientation?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  iso?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fNumber?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  exposureTime?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  focalLength?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  altitude?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  hlsMasterKey?: string | null

  @ApiProperty({ required: false, enum: ['pending', 'ready', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'ready', 'failed'])
  transcodeStatus?: 'pending' | 'ready' | 'failed'

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  transcodedAt?: Date
}
