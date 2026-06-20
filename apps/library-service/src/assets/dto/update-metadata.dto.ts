import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, IsNumber, IsBoolean, Min } from 'class-validator'

export class UpdateMetadataDto {
  @ApiProperty({ enum: ['ready', 'failed'] })
  @IsIn(['ready', 'failed'])
  status!: 'ready' | 'failed'

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
  @IsNumber()
  orientation?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number
}
