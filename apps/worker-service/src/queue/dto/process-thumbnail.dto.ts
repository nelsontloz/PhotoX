import { IsString, IsNotEmpty } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class ProcessThumbnailDto {
  @ApiProperty({ description: 'Asset UUID' })
  @IsString()
  @IsNotEmpty()
  assetId!: string

  @ApiProperty({ description: 'Original file UUID in file-storage' })
  @IsString()
  @IsNotEmpty()
  fileId!: string

  @ApiProperty({ description: 'Thumbnail size identifier (e.g. 150x150, 300x300)' })
  @IsString()
  @IsNotEmpty()
  size!: string
}

export class JobResponseDto {
  @ApiProperty({ description: 'PG Boss job ID' })
  jobId!: string

  @ApiProperty({ description: 'Job status', default: 'queued' })
  status!: string
}
